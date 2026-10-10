// ─────────────────────────────── HANDOVER ───────────────────────────────
// 用途 : 走真实链路做一次端到端评估验证：OTLP 写入 -> trace 落 Doris -> eval-create ->
//        worker 执行 -> LLM judge 调用 -> score 落 Doris，并打印每一步的可见性。
// 用法 : LF_PROBE_PASSWORD=... node probe-v2-live-eval.cjs
// 计费 : 是 —— judge 会发起真实 deepseek-flash 请求，**消耗真实额度**（禁止随意重跑）。
// 依赖 : web(3000) + worker + Doris(9030) + Postgres(docker exec) 全都在跑。
// ────────────────────────────────────────────────────────────────────────
/**
 * LIVE end-to-end evaluation in the Jev demo project, using the real trigger
 * path (no hand-made queue jobs):
 *
 *   OTLP ingestion -> trace in Doris -> eval-create -> worker execution
 *   -> LLM judge call -> score -> Doris `scores`
 *
 * The API key is minted temporarily through the UI's own tRPC and deleted again
 * on every exit path. The judge call spends one small `deepseek-flash` request.
 *
 *   node probe-v2-live-eval.cjs
 */
const { execFileSync } = require("child_process");
const crypto = require("crypto");
const path = require("path");
const { login, trpc } = require("./_lf_session.cjs");

// Repo root: defaults to three levels up from this file
// (<repo>/docs/handover/scripts -> <repo>), override with LF_REPO on any machine.
const REPO = process.env.LF_REPO ?? path.resolve(__dirname, "..", "..", "..");

const WEB = process.env.LF_BASE ?? "http://localhost:3000";
const DORIS_FE = process.env.DORIS_FE_URL ?? "http://localhost:8030";
const PROJECT_ID = process.env.LF_PROJECT ?? "jevdemoproject01";
const EMAIL = process.env.LF_PROBE_EMAIL ?? "jev-demo@litefuse.local";
// Never store the demo password in this (public) repo — read it from the env.
const PASSWORD = process.env.LF_PROBE_PASSWORD;
// Docker container name is env-overridable so the same script works elsewhere.
const PG_CONTAINER = process.env.LF_PG_CONTAINER ?? "litefuse-postgres";
const RUN_TAG = process.env.RUN_TAG ?? String(Date.now()).slice(-6);
// This fork's /api/public/ingestion only accepts score-create / sdk-log events;
// traces must arrive over OTLP, where a trace id is 16 random bytes as hex.
const TRACE_ID = crypto.randomBytes(16).toString("hex");
const SPAN_ID = crypto.randomBytes(8).toString("hex");
const MAX_WAIT_MS = Number(process.env.MAX_WAIT_MS ?? 240000);

function psql(sql, database = "postgres") {
  return execFileSync("docker", [
    "exec",
    PG_CONTAINER,
    "psql",
    "-U",
    process.env.LF_PG_USER ?? "postgres",
    "-d",
    database,
    "-t",
    "-A",
    "-F",
    "|",
    "-c",
    sql,
  ])
    .toString()
    .trim();
}

/**
 * Read-only SQL against Doris over the MySQL protocol.
 *
 * The FE's HTTP query endpoint (`/api/query/<db>`) answers 405 on this Doris
 * build, and polling it silently produced false negatives ("trace not visible",
 * "no score") while the rows were actually there.
 */
const mysql = require(
  path.join(REPO, "packages", "shared", "node_modules", "mysql2", "promise"),
);

async function withDoris(fn) {
  const connection = await mysql.createConnection({
    host: process.env.DORIS_MYSQL_HOST ?? "127.0.0.1",
    port: Number(process.env.DORIS_QUERY_PORT ?? 9030),
    user: process.env.DORIS_USER ?? "root",
    password: process.env.DORIS_PASSWORD ?? "",
    database: process.env.DORIS_DB ?? "litefuse",
  });
  try {
    return await fn(connection);
  } finally {
    await connection.end();
  }
}

async function dorisQuery(stmt) {
  return withDoris(async (connection) => {
    const [rows] = await connection.query(stmt);
    return rows;
  });
}

async function ingestOtlp(publicKey, secretKey, resourceSpans) {
  const res = await fetch(`${WEB}/api/public/otel/v1/traces`, {
    method: "POST",
    headers: {
      authorization:
        "Basic " + Buffer.from(`${publicKey}:${secretKey}`).toString("base64"),
      "content-type": "application/json",
      // The master fork is OTel-only for traces and hard-rejects clients that
      // don't look new enough; this header is the documented explicit opt-in.
      "x-langfuse-ingestion-version": "4",
      "x-langfuse-sdk-name": "litefuse-probe",
      "x-langfuse-sdk-version": "5.0.0",
    },
    body: JSON.stringify({ resourceSpans }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 400);
  }
  return { status: res.status, body };
}

/** One root span carrying both trace-level and observation-level IO. */
function buildOtlpPayload() {
  const startMs = Date.now();
  const nano = (ms) => String(BigInt(ms) * 1000000n);
  const attr = (key, value) => ({ key, value: { stringValue: value } });
  const input = "My refund has not arrived after 10 days. What should I do?";
  const output =
    "I am sorry about the delay. I escalated your case and refunded the shipping fee; the refund will land within 3 business days.";

  return [
    {
      resource: {
        attributes: [
          attr("service.name", "zz-v2-live-eval"),
          attr("langfuse.environment", "production"),
          attr("langfuse.release", `probe-${RUN_TAG}`),
        ],
      },
      scopeSpans: [
        {
          scope: { name: "zz-v2-live-eval" },
          spans: [
            {
              traceId: TRACE_ID,
              spanId: SPAN_ID,
              name: "support-reply",
              kind: 1,
              startTimeUnixNano: nano(startMs),
              endTimeUnixNano: nano(startMs + 1200),
              attributes: [
                attr("langfuse.trace.name", "ZZ v2 live eval"),
                attr("langfuse.trace.input", input),
                attr("langfuse.trace.output", output),
                attr("langfuse.trace.metadata", JSON.stringify({ probe: "v2-live-eval", run: RUN_TAG })),
                attr("langfuse.observation.type", "span"),
                attr("langfuse.observation.input", input),
                attr("langfuse.observation.output", output),
              ],
            },
          ],
        },
      ],
    },
  ];
}

// Filled during the run so the temporary key can be removed on every exit path.
const session = { cookie: null, keyId: null };

async function removeTemporaryKey() {
  if (!session.keyId || !session.cookie) return;
  try {
    await trpc("projectApiKeys.delete", {
      input: { projectId: PROJECT_ID, id: session.keyId },
      cookie: session.cookie,
    });
    console.log("temporary project key deleted");
  } catch (error) {
    console.log(`could not delete temporary key ${session.keyId}: ${error.message}`);
  }
}

(async () => {
  if (!PASSWORD) {
    throw new Error(
      "LF_PROBE_PASSWORD is not set (the demo account password is never stored in this repo)",
    );
  }
  // The demo keys in the manual no longer match the stored hash (verified:
  // sha256(secret) != api_keys.fast_hashed_secret_key), so mint a temporary
  // project key through the UI's own tRPC and delete it again at the end.
  const cookie = await login({ email: EMAIL, password: PASSWORD });
  session.cookie = cookie;
  console.log("logged in as " + EMAIL);
  const createdKey = await trpc("projectApiKeys.create", {
    input: { projectId: PROJECT_ID, note: "zz v2 live eval probe (temporary)" },
    cookie,
  });
  const { publicKey, secretKey } = createdKey;
  const keyId = createdKey.id;
  session.keyId = keyId;
  if (!publicKey || !secretKey) throw new Error("api key creation returned no secret");
  console.log(`temporary project key ${publicKey.slice(0, 14)}... (secret hidden)`);

  console.log(`\n== ingest via OTLP (trace ${TRACE_ID}) ==`);
  const ingested = await ingestOtlp(publicKey, secretKey, buildOtlpPayload());
  console.log(`status ${ingested.status}: ${JSON.stringify(ingested.body).slice(0, 300)}`);
  if (ingested.status >= 300) {
    throw new Error("OTLP ingestion rejected the payload");
  }

  console.log("\n== wait for the trace to land in Doris ==");
  const traceStarted = Date.now();
  let traceSeen = false;
  while (Date.now() - traceStarted < 60000) {
    const rows = await dorisQuery(
      `select id, name from traces_scalar_${PROJECT_ID} where id = '${TRACE_ID}' limit 1`,
    );
    if (rows.length) {
      traceSeen = true;
      console.log(`trace visible after ${Math.round((Date.now() - traceStarted) / 1000)}s`);
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  if (!traceSeen) console.log("WARNING: trace not visible in Doris within 60s (continuing)");

  console.log("\n== wait for evaluation + score ==");
  const started = Date.now();
  let lastReport = 0;
  let scoreRow = null;
  while (Date.now() - started < MAX_WAIT_MS) {
    const jobRows = psql(
      `select status, count(*) from job_executions where project_id = '${PROJECT_ID}' group by status order by status;`,
    );
    const rows = await dorisQuery(
      `select id, name, value, data_type, comment, source, timestamp from scores where trace_id = '${TRACE_ID}' limit 5`,
    );
    if (rows.length) {
      scoreRow = rows;
      break;
    }
    if (Date.now() - lastReport > 15000) {
      lastReport = Date.now();
      const elapsed = Math.round((Date.now() - started) / 1000);
      console.log(`[${elapsed}s] job executions: ${jobRows.replace(/\n/g, " ") || "(none)"}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  console.log("\n== result ==");
  if (scoreRow) {
    console.log("SCORE ROWS IN DORIS:");
    console.log(JSON.stringify(scoreRow, null, 2));
  } else {
    console.log("NO SCORE after the wait window");
  }

  console.log("\njob executions (all statuses):");
  console.log(
    psql(
      `select status, count(*) from job_executions where project_id = '${PROJECT_ID}' group by status order by status;`,
    ) || "(none)",
  );
  console.log("\nlatest job executions:");
  console.log(
    psql(
      `select id, status, left(coalesce(error,''), 300) from job_executions where project_id = '${PROJECT_ID}' order by created_at desc limit 5;`,
    ),
  );
  console.log(`\nTRACE_ID=${TRACE_ID}`);
  await removeTemporaryKey();
  if (!scoreRow) process.exitCode = 2;
})().catch(async (error) => {
  console.error("\nLIVE EVAL FAILED:", error.message);
  await removeTemporaryKey();
  process.exitCode = 1;
});

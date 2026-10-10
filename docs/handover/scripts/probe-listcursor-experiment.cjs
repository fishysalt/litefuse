// ─────────────────────────────── HANDOVER ───────────────────────────────
// 用途 : 用 "Experiments" 示例过滤器（isExperimentItemRootSpan = true）再打一次
//        events.listCursor，对比 HTTP 状态与返回行数，判断布尔过滤器是否被丢弃。
// 用法 : LF_PROBE_PASSWORD=... node probe-listcursor-experiment.cjs [列名|none]
// 计费 : 否 —— 只读 tRPC 查询，不调用任何 LLM/Jev 接口。
// 依赖 : Litefuse web 服务在跑（默认 http://localhost:3000）。
// ────────────────────────────────────────────────────────────────────────
/**
 * Replays the evaluator sample selector's `events.listCursor` call for the
 * "Experiments" example filter (`isExperimentItemRootSpan = true`) and prints
 * the HTTP status plus the number of returned rows.
 *
 *   node probe-listcursor-experiment.cjs
 */
const BASE = process.env.LF_BASE ?? "http://localhost:3000";
const PROJECT = process.env.LF_PROJECT ?? "jevdemoproject01";
const EMAIL = process.env.LF_PROBE_EMAIL ?? "jev-demo@litefuse.local";
// Never store the demo password in this (public) repo — read it from the env.
const PASSWORD = process.env.LF_PROBE_PASSWORD;
const COLUMN = process.argv[2] ?? "isExperimentItemRootSpan";
// `none` = control run: same time range, no boolean filter (must return rows).
const WITH_BOOLEAN_FILTER = COLUMN !== "none";

const INPUT = {
  json: {
    projectId: PROJECT,
    filter: [
      ...(WITH_BOOLEAN_FILTER
        ? [
            {
              column: COLUMN,
              type: "boolean",
              operator: "=",
              value: true,
            },
          ]
        : []),
      {
        column: "startTime",
        type: "datetime",
        operator: ">=",
        value: "2026-09-01T00:00:00.000Z",
      },
      {
        column: "startTime",
        type: "datetime",
        operator: "<",
        value: "2026-11-01T00:00:00.000Z",
      },
    ],
    searchQuery: null,
    searchType: [],
    limit: 25,
    direction: "forward",
  },
  meta: {
    values: WITH_BOOLEAN_FILTER
      ? { "filter.1.value": ["Date"], "filter.2.value": ["Date"] }
      : { "filter.0.value": ["Date"], "filter.1.value": ["Date"] },
  },
};

(async () => {
  if (!PASSWORD) {
    throw new Error(
      "LF_PROBE_PASSWORD is not set (the demo account password is never stored in this repo)",
    );
  }
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  const csrfCookies = csrfRes.headers.getSetCookie?.() ?? [];
  const { csrfToken } = await csrfRes.json();
  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: csrfCookies.map((c) => c.split(";")[0]).join("; "),
    },
    body: new URLSearchParams({
      csrfToken,
      email: EMAIL,
      password: PASSWORD,
      callbackUrl: `${BASE}/`,
      json: "true",
    }),
    redirect: "manual",
  });
  const jar = (loginRes.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(";")[0])
    .join("; ");

  const url = `${BASE}/api/trpc/events.listCursor?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: INPUT }))}`;
  const res = await fetch(url, { headers: { cookie: jar } });
  const text = await res.text();
  console.log(`column=${COLUMN} HTTP ${res.status}`);
  let rows = null;
  try {
    const parsed = JSON.parse(text);
    const payload = parsed?.[0]?.result?.data?.json;
    rows = payload?.observations?.length ?? null;
    console.log(`rows=${rows}`);
    if (rows === null) console.log(text.slice(0, 3000));
  } catch {
    console.log(text.slice(0, 3000));
  }
})().catch((e) => {
  console.error("FATAL", e.message);
  process.exitCode = 1;
});

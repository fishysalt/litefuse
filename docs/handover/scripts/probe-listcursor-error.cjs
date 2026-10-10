// ─────────────────────────────── HANDOVER ───────────────────────────────
// 用途 : 复现评估器样本选择器的 events.listCursor 报错，打印原始 tRPC 错误体
//        （页面会把错误吞成空表格，只能这样看到真实原因）。
// 用法 : LF_PROBE_PASSWORD=... node probe-listcursor-error.cjs
// 计费 : 否 —— 只读 tRPC 查询，不调用任何 LLM/Jev 接口。
// 依赖 : Litefuse web 服务在跑（默认 http://localhost:3000）。
// ────────────────────────────────────────────────────────────────────────
/**
 * Replays the evaluator sample selector's `events.listCursor` call and prints the
 * raw tRPC error, which is the only way to see why the cursor path fails at
 * runtime (the page swallows it into an empty table).
 *
 *   node probe-listcursor-error.cjs
 */
const BASE = process.env.LF_BASE ?? "http://localhost:3000";
const PROJECT = process.env.LF_PROJECT ?? "jevdemoproject01";
const EMAIL = process.env.LF_PROBE_EMAIL ?? "jev-demo@litefuse.local";
// Never store the demo password in this (public) repo — read it from the env.
const PASSWORD = process.env.LF_PROBE_PASSWORD;

const INPUT = {
  json: {
    projectId: PROJECT,
    filter: [
      // The RuleSetup dialog's default filter (upstream v4 spelling of "root
      // spans"). Reported to make listCursor answer HTTP 500.
      {
        column: "isRootObservation",
        type: "boolean",
        operator: "=",
        value: true,
      },
      {
        column: "startTime",
        type: "datetime",
        operator: ">=",
        value: "2026-10-07T00:00:00.000Z",
      },
      {
        column: "startTime",
        type: "datetime",
        operator: "<",
        value: "2026-10-10T00:00:00.000Z",
      },
    ],
    searchQuery: null,
    searchType: [],
    limit: 25,
    direction: "forward",
  },
  meta: { values: { "filter.1.value": ["Date"], "filter.2.value": ["Date"] } },
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
  console.log(`HTTP ${res.status}`);
  console.log(text.slice(0, 4000));
})().catch((e) => {
  console.error("FATAL", e.message);
  process.exitCode = 1;
});

// ─────────────────────────────── HANDOVER ───────────────────────────────
// 用途 : 抓新建评估器页面实际向 events cursor 端点发的请求与收到的响应，用来区分
//        "时间范围内真的没有行" 和 "过滤器被静默丢掉了"。
// 用法 : LF_PROBE_PASSWORD=... node ui-sample-query.cjs
// 计费 : 否 —— 纯浏览器读取，不调用任何 LLM/Jev 接口。
// 依赖 : web(3000) + 本机 Chrome + 仓库 web 里已装 @playwright/test。
// ────────────────────────────────────────────────────────────────────────
/**
 * Captures what the new-evaluator page actually asks the events cursor endpoint
 * for, and what it gets back — the fastest way to tell "no rows in range" apart
 * from "the filter was silently dropped".
 *
 *   node ui-sample-query.cjs
 */
const path = require("path");

// Repo root: defaults to three levels up from this file
// (<repo>/docs/handover/scripts -> <repo>), override with LF_REPO on any machine.
const REPO = process.env.LF_REPO ?? path.resolve(__dirname, "..", "..", "..");
const WEB = path.join(REPO, "web");
const { chromium } = require(path.join(WEB, "node_modules", "@playwright", "test"));

const BASE = process.env.LF_BASE ?? "http://localhost:3000";
const PROJECT = process.env.LF_PROJECT ?? "jevdemoproject01";
const EMAIL = process.env.LF_PROBE_EMAIL ?? "jev-demo@litefuse.local";
// Never store the demo password in this (public) repo — read it from the env.
const PASSWORD = process.env.LF_PROBE_PASSWORD;

(async () => {
  if (!PASSWORD) {
    throw new Error(
      "LF_PROBE_PASSWORD is not set (the demo account password is never stored in this repo)",
    );
  }
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 950 } });

  const { csrfToken } = await (
    await ctx.request.get(`${BASE}/api/auth/csrf`)
  ).json();
  await ctx.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: {
      csrfToken,
      email: EMAIL,
      password: PASSWORD,
      json: "true",
    },
  });

  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR: " + e.message.slice(0, 300)));
  page.on("console", (m) => {
    if (m.type() === "error") console.log("CONSOLE: " + m.text().slice(0, 300));
  });

  page.on("request", (request) => {
    const url = request.url();
    if (!url.includes("/api/trpc/") || !/listCursor|filterOptions/.test(url)) return;
    const procedure = url.split("/api/trpc/")[1]?.split("?")[0];
    console.log(`\n<<< REQUEST ${procedure}`);
    const input = new URL(url).searchParams.get("input");
    console.log(input ? decodeURIComponent(input).slice(0, 1500) : "(no input param)");
  });

  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("/api/trpc/")) return;
    if (!/listCursor|filterOptions|batchIO|experimentBatchIO/.test(url)) return;
    const procedure = url.split("/api/trpc/")[1]?.split("?")[0];
    let body = "";
    try {
      body = (await response.text()).slice(0, 700);
    } catch {
      body = "(unreadable)";
    }
    console.log(`\n>>> ${procedure} -> HTTP ${response.status()}`);
    console.log(body);
  });

  await page.goto(`${BASE}/project/${PROJECT}/evals/v2/new`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForTimeout(25000);

  const rows = await page.locator("table tbody tr").allInnerTexts();
  console.log(`\n--- sample table rows: ${rows.length} ---`);
  for (const r of rows.slice(0, 5)) console.log("   " + r.replace(/\s+/g, " ").slice(0, 200));

  await browser.close();
})().catch((e) => {
  console.error("FATAL", e);
  process.exitCode = 1;
});

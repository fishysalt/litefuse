// ─────────────────────────────── HANDOVER ───────────────────────────────
// 用途 : 迁移后评估器 v2 页面的文本级验收：登录后 dump 可见文字，检查该出现的控件/列/分区。
// 用法 : LF_PROBE_PASSWORD=... node ui-text.cjs [路径 ...]   （默认 /evals/v2 与 /evals/v2/rules）
// 计费 : 否 —— 纯浏览器读取页面，不调用任何 LLM/Jev 接口。
// 依赖 : web(3000) + 本机 Chrome + 仓库 web 里已装 @playwright/test。
// ────────────────────────────────────────────────────────────────────────
/**
 * Text-based UI verification for the migrated evaluators v2 pages: signs in the
 * same way the browser does, then dumps the visible text and checks for the
 * specific controls/columns/sections the migration is supposed to deliver.
 *
 *   node ui-text.cjs
 */
const path = require("path");

// Repo root: defaults to three levels up from this file
// (<repo>/docs/handover/scripts -> <repo>), override with LF_REPO on any machine.
const REPO = process.env.LF_REPO ?? path.resolve(__dirname, "..", "..", "..");
const WEB = path.join(REPO, "web");
const { chromium } = require(path.join(WEB, "node_modules", "@playwright", "test"));

const BASE = process.env.LF_BASE ?? "http://localhost:3000";
// Overridable so the same text check can run against the Jev demo project
// (which has traces, a connection and evaluators) instead of the empty seed one.
const PROJECT = process.env.LF_PROJECT ?? "7a88fb47-b4e2-43b8-a06c-a5ce950dc53a";
const EMAIL = process.env.LF_PROBE_EMAIL ?? "demo@litefuse.ai";
// Never store the demo password in this (public) repo — read it from the env.
const PASSWORD = process.env.LF_PROBE_PASSWORD;

const EXPECT = {
  "/evals/v2": [
    "Evaluators",
    "Rules",
    "New evaluator",
    "Hide filters",
    "Columns",
    "Name",
    "Type",
  ],
  "/evals/v2/rules": ["Rules", "New rule", "Enabled", "Target", "Sampling"],
};

// Routes to check; the seeded smoke-test evaluator id is appended when given.
const PATHS = process.argv.slice(2);

(async () => {
  if (!PASSWORD) {
    throw new Error(
      "LF_PROBE_PASSWORD is not set (the demo account password is never stored in this repo)",
    );
  }
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 950 } });
  const { csrfToken } = await (await ctx.request.get(`${BASE}/api/auth/csrf`)).json();
  await ctx.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: { csrfToken, email: EMAIL, password: PASSWORD, json: "true" },
  });

  for (const route of PATHS.length
    ? PATHS
    : ["/evals/v2", "/evals/v2/rules"]) {
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200));
    });
    await page.goto(BASE + `/project/${PROJECT}` + route, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await page.waitForTimeout(9000);

    const text = (await page.locator("body").innerText()).replace(/\n{2,}/g, "\n").trim();
    // Table content only, so data rows are easy to read.
    const rows = await page.locator("table tbody tr").allInnerTexts();
    const buttons = await page.locator("button").allInnerTexts();
    const empties = await page
      .locator("[role='row'], td")
      .allInnerTexts()
      .catch(() => []);

    console.log(`\n================ ${route} ================`);
    console.log("--- headings/controls ---");
    console.log(
      buttons
        .map((b) => b.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 30)
        .join(" | "),
    );
    console.log("--- table rows (" + rows.length + ") ---");
    for (const r of rows.slice(0, 8)) console.log("   " + r.replace(/\s+/g, " ").slice(0, 220));
    if (!rows.length) {
      console.log("   (no rows; first cells: " + empties.slice(0, 6).map((e) => e.replace(/\s+/g, " ").slice(0, 60)).join(" / ") + ")");
    }
    console.log("--- full text (1800 chars) ---");
    console.log(text.slice(0, 1800));
    const missing = (EXPECT[route] || []).filter((k) => !text.includes(k));
    console.log(`--- expectation check: ${missing.length ? "MISSING " + missing.join(", ") : "all present"}`);
    if (errors.length) {
      console.log("--- errors ---");
      for (const e of [...new Set(errors)].slice(0, 8)) console.log("   " + e);
    }
    await page.close();
  }
  await browser.close();
})().catch((e) => {
  console.error("FATAL", e);
  process.exitCode = 1;
});

// ─────────────────────────────── HANDOVER ───────────────────────────────
// 用途 : 验证 peek（侧边预览）在移植上游三处改动（reader 方言、peek:* 埋点、peekView
//        参数）后仍然可用：点行加 peek=、关闭移除 peek=、且没有报错。
// 用法 : LF_PROBE_PASSWORD=... node ui-peek-check.cjs [路径]   （默认 /traces）
// 计费 : 否 —— 纯浏览器操作，不调用任何 LLM/Jev 接口。
// 依赖 : web(3000) + 本机 Chrome + 仓库 web 里已装 @playwright/test。
// ────────────────────────────────────────────────────────────────────────
/**
 * Verifies the peek (side preview) still works after porting upstream's three
 * additions (reader dialect handling, `peek:*` analytics, the `peekView` param).
 *
 * Checks, by TEXT and URL only:
 *   1. clicking a row adds `peek=<id>` to the URL and opens the side panel,
 *   2. closing it removes the param again,
 *   3. no pageerror/console errors are produced.
 *
 *   node ui-peek-check.cjs [path]
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
const PATH = process.argv[2] ?? "/traces";

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
    form: { csrfToken, email: EMAIL, password: PASSWORD, json: "true" },
  });

  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200));
  });

  const url = `${BASE}/project/${PROJECT}${PATH}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(10000);

  const rows = page.locator("table tbody tr");
  const rowCount = await rows.count();
  console.log(`rows on ${PATH}: ${rowCount}`);
  if (rowCount === 0) {
    console.log("NO ROWS — cannot exercise peek on this table");
    console.log((await page.locator("body").innerText()).slice(0, 800));
    await browser.close();
    process.exitCode = 1;
    return;
  }

  await rows.first().click();
  await page.waitForTimeout(4000);

  const afterOpen = page.url();
  const openedPeek = new URL(afterOpen).searchParams.get("peek");
  console.log(`after row click: peek=${openedPeek ?? "(none)"}`);
  if (!openedPeek) {
    console.log("--- first row content ---");
    console.log((await rows.first().innerText()).replace(/\s+/g, " ").slice(0, 300));
    console.log("--- body text head ---");
    console.log(
      (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 700),
    );
  }

  const panelText = await page
    .locator("[role='dialog'], aside, .border-l")
    .first()
    .innerText()
    .catch(() => "");
  console.log(`side panel first 300 chars: ${panelText.replace(/\s+/g, " ").slice(0, 300)}`);

  // Close it: the panel renders a close button; fall back to Escape.
  const closed = await page
    .locator("button[aria-label*='lose' i], button:has-text('Close')")
    .first()
    .click({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!closed) await page.keyboard.press("Escape");
  await page.waitForTimeout(3000);

  const afterClose = new URL(page.url()).searchParams.get("peek");
  console.log(`after close (${closed ? "close button" : "Escape"}): peek=${afterClose ?? "(none)"}`);

  console.log("\n=== verdict ===");
  console.log(`open added peek param: ${openedPeek ? "YES" : "NO"}`);
  console.log(`close removed peek param: ${afterClose === null ? "YES" : "NO"}`);
  if (errors.length) {
    console.log("errors:");
    for (const e of [...new Set(errors)].slice(0, 8)) console.log("   " + e);
  } else {
    console.log("no pageerror/console errors");
  }

  await browser.close();
  if (!openedPeek || afterClose !== null) process.exitCode = 1;
})().catch((e) => {
  console.error("FATAL", e);
  process.exitCode = 1;
});

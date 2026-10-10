// ─────────────────────────────── HANDOVER ───────────────────────────────
// 用途 : 验收侧边栏入口：必须显示 "Evaluators"（不是 "LLM-as-a-Judge"）并跳进迁移后的
//        /evals/v2 界面；只看文本和 URL，不截图。
// 用法 : LF_PROBE_PASSWORD=... node ui-nav-check.cjs
// 计费 : 否 —— 纯浏览器操作，不调用任何 LLM/Jev 接口。
// 依赖 : web(3000) + 本机 Chrome + 仓库 web 里已装 @playwright/test。
// ────────────────────────────────────────────────────────────────────────
/**
 * Verifies the sidebar entry the user asked for: it must read "Evaluators"
 * (not "LLM-as-a-Judge") and lead to the migrated /evals/v2 UI.
 *
 * Text/URL based only (no screenshots).
 *
 *   node ui-nav-check.cjs
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
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 200)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200));
  });

  // Start anywhere inside the project so the sidebar is rendered.
  await page.goto(`${BASE}/project/${PROJECT}/traces`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForTimeout(12000);

  const links = await page.locator("a[href*='/evals']").all();
  console.log(`--- sidebar links containing /evals (${links.length}) ---`);
  for (const link of links) {
    const text = (await link.innerText()).replace(/\s+/g, " ").trim();
    const href = await link.getAttribute("href");
    console.log(`   "${text}"  ->  ${href}`);
  }

  const navText = await page.locator("nav, aside").first().innerText();
  console.log(`\nside nav mentions "LLM-as-a-Judge": ${navText.includes("LLM-as-a-Judge")}`);
  console.log(`side nav mentions "Evaluators": ${navText.includes("Evaluators")}`);

  // Click the Evaluators entry and confirm it lands on the v2 UI.
  const evaluators = page.locator("a[href*='/evals']", { hasText: "Evaluators" }).first();
  if ((await evaluators.count()) === 0) {
    console.log("\nNO 'Evaluators' NAV ENTRY FOUND");
    await browser.close();
    process.exitCode = 1;
    return;
  }
  await evaluators.click();
  await page.waitForTimeout(12000);
  const url = page.url();
  const body = await page.locator("body").innerText();
  console.log(`\nafter clicking: ${url}`);
  console.log(`  landed on /evals/v2: ${url.includes("/evals/v2")}`);
  console.log(`  shows "New evaluator": ${body.includes("New evaluator")}`);
  console.log(`  shows v2 tabs (Rules): ${body.includes("Rules")}`);
  if (errors.length) {
    console.log("errors:");
    for (const e of [...new Set(errors)].slice(0, 6)) console.log("   " + e);
  } else {
    console.log("no console/page errors");
  }

  await browser.close();
})().catch((e) => {
  console.error("FATAL", e.message);
  process.exitCode = 1;
});

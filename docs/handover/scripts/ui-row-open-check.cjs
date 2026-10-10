// ─────────────────────────────── HANDOVER ───────────────────────────────
// 用途 : 检查评估器列表里点一行是否真的打开该评估器（URL 变成 /evals/<id> 的新详情页），
//        并打印行内链接结构，用来区分"这行根本不是链接"和"导航坏了"。
// 用法 : LF_PROBE_PASSWORD=... node ui-row-open-check.cjs
// 计费 : 否 —— 纯浏览器操作，不调用任何 LLM/Jev 接口。
// 依赖 : web(3000) + 本机 Chrome + 仓库 web 里已装 @playwright/test。
// ────────────────────────────────────────────────────────────────────────
/**
 * Focused check: does clicking an evaluator row in the new list actually open
 * that evaluator (URL /evals/<id>, new detail page)?
 *
 * Prints the row's link structure so "the row is not a link" can be told apart
 * from "navigation is broken".
 *
 *   node ui-row-open-check.cjs
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

  await page.goto(`${BASE}/project/${PROJECT}/evals`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForTimeout(12000);

  const rows = page.locator("table tbody tr");
  console.log(`rows: ${await rows.count()}`);
  const first = rows.first();
  const links = await first.locator("a").all();
  console.log(`links inside first row: ${links.length}`);
  for (const a of links) {
    console.log(`   href=${await a.getAttribute("href")} text="${(await a.innerText()).replace(/\s+/g, " ").trim().slice(0, 60)}"`);
  }
  console.log(`row text: ${(await first.innerText()).replace(/\s+/g, " ").slice(0, 160)}`);

  // Prefer the row's own link; fall back to a plain row click.
  const target = links.length ? links[0] : first;
  await target.click();
  await page.waitForFunction(
    () => /\/evals\/[^/]+$/.test(new URL(location.href).pathname),
    undefined,
    { timeout: 30000 },
  ).then(() => console.log("navigation: OK")).catch(() => console.log("navigation: TIMEOUT (30s)"));
  await page.waitForTimeout(6000);

  const url = page.url();
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  console.log(`\nfinal URL: ${url}`);
  console.log(`  matches /evals/<id>: ${/\/evals\/[^/]+$/.test(new URL(url).pathname)}`);
  console.log(`  "Configure evaluator": ${body.includes("Configure evaluator")}`);
  console.log(`  "Version history": ${body.includes("Version history")}`);
  console.log(`  legacy marker "Running Evaluators": ${body.includes("Running Evaluators")}`);
  console.log(`  stuck on Loading: ${/Loading\s*\.\.\./i.test(body)}`);
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

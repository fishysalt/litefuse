// ─────────────────────────────── HANDOVER ───────────────────────────────
// 用途 : 诊断"页面卡在 Loading..."：打印可见文字、每个 tRPC 响应的状态与短响应体、
//        以及所有 console/page 错误。
// 用法 : LF_PROBE_PASSWORD=... node ui-stuck-check.cjs [/evals/v2/rules]
// 计费 : 否 —— 纯浏览器读取，不调用任何 LLM/Jev 接口。
// 依赖 : web(3000) + 本机 Chrome + 仓库 web 里已装 @playwright/test。
// ────────────────────────────────────────────────────────────────────────
/**
 * Diagnoses a "stuck on Loading..." page: dumps the visible text, every tRPC
 * response (status + short body) and any console/page errors for the given path.
 *
 *   node ui-stuck-check.cjs /evals/v2/rules
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
const PATH = process.argv[2] ?? "/evals/v2/rules";

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
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 300)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text().slice(0, 300));
  });
  page.on("requestfailed", (r) =>
    errors.push(`requestfailed: ${r.url().split("/api/")[1]?.slice(0, 80)} ${r.failure()?.errorText}`),
  );
  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("/api/trpc/")) return;
    const procedure = url.split("/api/trpc/")[1]?.split("?")[0];
    let body = "";
    try {
      body = (await response.text()).slice(0, 220);
    } catch {
      body = "(unreadable)";
    }
    console.log(`>>> ${procedure} -> HTTP ${response.status()}  ${body.replace(/\s+/g, " ")}`);
  });

  const target = `${BASE}/project/${PROJECT}${PATH}`;
  console.log(`GOTO ${target}`);
  const started = Date.now();
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 120000 });
  console.log(`domcontentloaded after ${Date.now() - started}ms`);

  for (const waitMs of [10000, 15000, 20000]) {
    await page.waitForTimeout(waitMs);
    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
    const hasLoading = /Loading\s*\.\.\./i.test(body);
    console.log(`\n--- after ${Math.round((Date.now() - started) / 1000)}s: bodyLen=${body.length} stillLoading=${hasLoading}`);
    if (!hasLoading && body.length > 200) break;
  }

  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  console.log("\n=== visible text (700 chars) ===");
  console.log(body.slice(0, 700));

  if (errors.length) {
    console.log("\n=== errors ===");
    for (const e of [...new Set(errors)].slice(0, 10)) console.log("   " + e);
  } else {
    console.log("\nno console/page/request errors");
  }

  await browser.close();
})().catch((e) => {
  console.error("FATAL", e.message);
  process.exitCode = 1;
});

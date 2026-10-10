// ─────────────────────────────── HANDOVER ───────────────────────────────
// 用途 : 走应用自己的路径做 Jev/TypeSafe 连通性探测：创建 decision-model 连接，
//        让 web 服务执行一次 testDecisionModelConnection。
// 用法 : JEV_KEY=... LF_PROBE_PASSWORD=... node probe-jev-connect.cjs [--delete]
// 计费 : 是 —— 创建连接会发起 1 次真实 Jev API 调用，**消耗真实额度**。
// 依赖 : Litefuse web 服务在跑（默认 http://localhost:3000）；--delete 不需要 JEV_KEY。
// ────────────────────────────────────────────────────────────────────────
/**
 * One-shot TypeSafe/Jev connectivity probe through the app's own path:
 * creates the decision-model connection, which makes the web server run
 * `testDecisionModelConnection` (exactly ONE real Jev API call).
 *
 * The API key is read from an env var so it never lands in a file:
 *   export JEV_KEY="<your TypeSafe/Jev key>"
 *
 *   node probe-jev-connect.cjs [--delete]
 */
const { login, trpc } = require("./_lf_session.cjs");

const PROJECT = process.env.LF_PROJECT ?? "jevdemoproject01";
const EMAIL = process.env.LF_PROBE_EMAIL ?? "jev-demo@litefuse.local";
// Never store the demo password in this (public) repo — read it from the env.
const PASSWORD = process.env.LF_PROBE_PASSWORD;
const KEY = process.env.JEV_KEY;
const NOTE = "Jev real connection (probe)";
const BASE_URL = process.env.JEV_BASE_URL ?? null; // null = direct TypeSafe
const UPSTREAM = process.env.JEV_UPSTREAM ?? "typesafe";

(async () => {
  if (!PASSWORD) {
    throw new Error(
      "LF_PROBE_PASSWORD is not set (the demo account password is never stored in this repo)",
    );
  }
  if (!KEY && !process.argv.includes("--delete")) {
    throw new Error("set JEV_KEY first (the TypeSafe key)");
  }
  const cookie = await login({ email: EMAIL, password: PASSWORD });
  console.log("logged in");

  if (process.argv.includes("--delete")) {
    const list = await trpc("llmApiKey.all", {
      method: "GET",
      input: { projectId: PROJECT, includeDecisionModels: true },
      cookie,
    });
    const mine = (list?.data ?? []).filter((k) => k.note === NOTE);
    for (const k of mine) {
      await trpc("llmApiKey.delete", {
        input: { projectId: PROJECT, id: k.id },
        cookie,
      });
      console.log(`deleted ${k.id}`);
    }
    return;
  }

  const input = {
    projectId: PROJECT,
    provider: "TypeSafe",
    adapter: "typesafe",
    secretKey: KEY,
    baseURL: BASE_URL,
    customModels: ["jev-latest"],
    typeSafeUpstream: UPSTREAM,
    note: NOTE,
  };

  console.log(`calling llmApiKey.create (upstream=${UPSTREAM}, baseURL=${BASE_URL ?? "direct"})`);
  try {
    const created = await trpc("llmApiKey.create", { input, cookie });
    console.log("CREATE OK — Jev connectivity probe passed (1 real API call)");
    console.log(JSON.stringify({ id: created?.id, provider: created?.provider }, null, 2));
  } catch (error) {
    console.log("CREATE FAILED — the probe did not pass:");
    console.log(error.message);
  }
})().catch((e) => {
  console.error("FATAL", e.message);
  process.exitCode = 1;
});

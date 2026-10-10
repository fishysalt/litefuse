// ─────────────────────────────── HANDOVER ───────────────────────────────
// 用途 : 复现用户遇到的 llmApiKey.create 500：先跑一次"假 key 的 OpenAI 连接"看错误是否
//        被正常处理，再（可选）用真 key 跑 TypeSafe 连接并打印原始 tRPC 响应。
// 用法 : LF_PROBE_PASSWORD=... node probe-apikey-create-500.cjs
//        加 REPRO_JEV=1 JEV_KEY=... 才跑第二步。
// 计费 : 默认否；REPRO_JEV=1 时发起 1 次真实 Jev 调用，**消耗真实额度**（DeepSeek 不涉及）。
// 依赖 : Litefuse web 服务在跑（默认 http://localhost:3000）。
// ────────────────────────────────────────────────────────────────────────
/**
 * Reproduces the `llmApiKey.create` internal-server-error the user hit.
 *
 * Two probes:
 *  1. a plain OpenAI connection with a bogus key — reaches the provider and should
 *     fail as a *handled* error (proves whether the 500 is generic or specific);
 *  2. the TypeSafe decision-model connection with the real key — this one makes a
 *     real Jev call, so it is only attempted when REPRO_JEV=1.
 *
 * Prints the RAW tRPC response (dev mode includes the stack).
 *
 *   node probe-apikey-create-500.cjs
 */
const { login, trpc } = require("./_lf_session.cjs");

const PROJECT = process.env.LF_PROJECT ?? "jevdemoproject01";
const EMAIL = process.env.LF_PROBE_EMAIL ?? "jev-demo@litefuse.local";
// Never store the demo password in this (public) repo — read it from the env.
const PASSWORD = process.env.LF_PROBE_PASSWORD;

async function probe(label, path, input, cookie) {
  console.log(`\n=== ${label} (${path}) ===`);
  try {
    const created = await trpc(path, { input, cookie });
    console.log("OK:", JSON.stringify(created)?.slice(0, 400));
  } catch (error) {
    console.log("ERROR:");
    console.log(error.message.slice(0, 3000));
  }
}

(async () => {
  if (!PASSWORD) {
    throw new Error(
      "LF_PROBE_PASSWORD is not set (the demo account password is never stored in this repo)",
    );
  }
  const cookie = await login({ email: EMAIL, password: PASSWORD });
  console.log("logged in");

  // 1. Plain connection with a bogus key: exercises the generic create+test path.
  //    The value below is deliberately NOT a real key — it only has to look like
  //    one so the provider rejects it.
  await probe(
    "plain OpenAI, bogus key",
    "llmApiKey.create",
    {
      projectId: PROJECT,
      provider: "ZZ probe openai",
      adapter: "openai",
      secretKey: process.env.PROBE_BOGUS_OPENAI_KEY ?? "sk-zz-probe-not-a-real-key",
      baseURL: process.env.PROBE_BOGUS_OPENAI_BASE ?? "http://127.0.0.1:9/v1",
      customModels: ["gpt-4o-mini"],
    },
    cookie,
  );

  // 2. Decision-model connection (real Jev call) — opt-in.
  if (process.env.REPRO_JEV === "1") {
    if (!process.env.JEV_KEY) throw new Error("REPRO_JEV=1 also needs JEV_KEY");
    await probe(
      "TypeSafe decision model (real Jev call)",
      "llmApiKey.create",
      {
        projectId: PROJECT,
        provider: "ZZ probe typesafe",
        adapter: "typesafe",
        secretKey: process.env.JEV_KEY,
        baseURL: null,
        customModels: ["jev-latest"],
        typeSafeUpstream: "typesafe",
      },
      cookie,
    );
  } else {
    console.log("\n(skipping the TypeSafe probe; set REPRO_JEV=1 to run it)");
  }
})().catch((e) => {
  console.error("FATAL", e.message);
  process.exitCode = 1;
});

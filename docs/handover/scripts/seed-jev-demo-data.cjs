#!/usr/bin/env node
// ─────────────────────────────── HANDOVER ───────────────────────────────
// 用途 : 给 Jev demo 项目灌一批真实的客服支持 trace（走 OTLP），让真实评估器跑起来，
//        并汇报产生的 score / verdict，用于端到端验收。
// 用法 : LF_PROBE_PASSWORD=... node seed-jev-demo-data.cjs [--pilot] [--count=N] [--max-calls=N]
// 计费 : 是 —— 每条 trace 会触发多次真实 LLM judge 调用（默认 12 条场景约 36 次以上），
//        **消耗真实额度**；脚本自带 --max-calls 预算保护，超预算会拒绝灌数据。
// 依赖 : web(3000) + worker + Doris(查询端口 9030) + Postgres（docker exec 进容器）都要在跑。
// ────────────────────────────────────────────────────────────────────────
/**
 * seed-jev-demo-data.cjs
 * ══════════════════════════════════════════════════════════════════════════
 * Seeds the Jev demo project (`jevdemoproject01`) with a realistic batch of
 * customer-support traces over OTLP, lets the REAL evaluators run on them, and
 * reports the resulting scores/verdicts.
 *
 *   node seed-jev-demo-data.cjs
 *   node seed-jev-demo-data.cjs --pilot      (1 trace)
 *   node seed-jev-demo-data.cjs --count=14
 *
 * Everything is done through the product's own surfaces:
 *   * a temporary project API key minted with tRPC `projectApiKeys.create`
 *     (deleted again on every exit path, verified against Postgres `api_keys`),
 *   * traces pushed to `POST /api/public/otel/v1/traces` (the fork is OTel-only),
 *   * evaluators/rules created with the v2 tRPC surface (`evalsV2.*`),
 *   * reads from Doris over the MySQL protocol (127.0.0.1:9030).
 *
 * ── ORDERING NOTE (deliberate deviation from a naive reading of the task) ──
 * Observation-level rules (`targetObject: "event"`) are scheduled by the worker
 * *at ingestion time* (`otelIngestionQueue` -> `scheduleObservationEvals`), and
 * there is no backfill: a rule created after a trace arrived never sees it.
 * So the evaluators/rules are created (or reused) BEFORE the traces are
 * ingested, otherwise the whole point of the run — the judge really executing
 * on the new data — could not happen. The script is idempotent: on a re-run the
 * evaluators/rules are looked up by name and reused, and only new traces are
 * pushed.
 *
 * Cost: every scheduled job for an LLM judge is one provider call. Measured on
 * this project (see the pilot/probe logs), one seeded trace (root SPAN + child
 * GENERATION) schedules
 *   2 calls for the existing NUMERIC rule   (empty filter -> root AND child)
 *   1 call  for the new BOOLEAN root rule   (isRootObservation = true)
 *   1 call  for the project's pre-existing legacy "User Disagreement" rule
 *           (filter `type any of [GENERATION]` -> the child)
 * so the default 12 scenarios cost 36 calls for the two evaluators this script
 * owns, plus ~12 from the pre-existing legacy rule. The script prints both and
 * refuses to ingest when ITS OWN projection exceeds `--max-calls`; it never
 * mutates the pre-existing rules to save money.
 *
 * ── KNOWN TRAP (hit and confirmed while building this) ─────────────────────
 * `langfuse.observation.level` must be a STRING. Sending it as an OTLP
 * `intValue` stores fine and is visible in Doris, but
 * `observationForEvalSchema.parse` (level: z.string()) then throws inside
 * `scheduleObservationEvals`, and that throw is swallowed per observation — the
 * span is silently never evaluated. An earlier revision of this script sent
 * `level: 1` as intValue and the child spans produced ZERO job executions while
 * their rows looked perfectly normal in the UI/Doris.
 */
const crypto = require("crypto");
const path = require("path");
const { execFileSync } = require("child_process");
const { login, trpc } = require("./_lf_session.cjs");

// Repo root: defaults to three levels up from this file
// (<repo>/docs/handover/scripts -> <repo>), override with LF_REPO on any machine.
const REPO = process.env.LF_REPO ?? path.resolve(__dirname, "..", "..", "..");
const mysql = require(
  path.join(REPO, "packages", "shared", "node_modules", "mysql2", "promise"),
);

const WEB = process.env.LF_BASE ?? "http://localhost:3000";
const PROJECT_ID = process.env.LF_PROJECT ?? "jevdemoproject01";
const EMAIL = process.env.LF_PROBE_EMAIL ?? "jev-demo@litefuse.local";
// The demo password is deliberately NOT stored in this (public) repo.
const PASSWORD = process.env.LF_PROBE_PASSWORD;
// Docker container name / postgres user, env-overridable for other machines.
const PG_CONTAINER = process.env.LF_PG_CONTAINER ?? "litefuse-postgres";
const PG_USER = process.env.LF_PG_USER ?? "postgres";
const JUDGE_MODEL = process.env.LF_JUDGE_MODEL ?? "deepseek-flash";

if (!PASSWORD) {
  console.error(
    "LF_PROBE_PASSWORD is not set — the demo account password is never stored in this repo.\n" +
      "  export LF_PROBE_PASSWORD='...'   # then re-run",
  );
  process.exit(1);
}

const BOOLEAN_EVALUATOR_NAME = "ZZ demo judge — boolean verdict";
const BOOLEAN_RULE_NAME = "ZZ demo rule — root spans only";
const NUMERIC_EVALUATOR_NAME = "ZZ v2 e2e judge (jev project)";
const NUMERIC_RULE_NAME = "ZZ v2 e2e rule (jev project)";
const TEMP_KEY_NOTE = "zz seed jev demo data (temporary)";

// ── CLI ────────────────────────────────────────────────────────────────────
// Accepts both `--flag` / `--flag=value` / `--flag value`.
function argValue(name, fallback) {
  const argv = process.argv.slice(2);
  const index = argv.findIndex(
    (a) => a === `--${name}` || a.startsWith(`--${name}=`),
  );
  if (index === -1) return fallback;
  const hit = argv[index];
  if (hit.includes("=")) return hit.split("=").slice(1).join("=");
  const next = argv[index + 1];
  if (next !== undefined && !next.startsWith("--")) return next;
  return true;
}

const args = {
  pilot: argValue("pilot", false) === true,
  count: Number(argValue("count", 0)) || 0,
  batch: Number(argValue("batch", 0)) || 4,
  maxCalls: Number(argValue("max-calls", 0)) || 40,
  waitMs: Number(argValue("wait-ms", 0)) || 12 * 60 * 1000,
  traceWaitMs: Number(argValue("trace-wait-ms", 0)) || 120 * 1000,
  help: argValue("help", false) === true,
};

if (args.help) {
  console.log(
    [
      "usage: node seed-jev-demo-data.cjs [--pilot] [--count=N] [--batch=N]",
      "                                    [--max-calls=N] [--wait-ms=MS]",
      "  --pilot    ingest a single trace (pilot) instead of the full batch",
      "  --count=N  number of scenarios to ingest (default 12, spec range 12-16)",
      "  --batch=N  traces per OTLP request (default 4)",
      "  --max-calls=N  abort before ingesting if the projected judge-call",
      "                 count exceeds N (default 40)",
    ].join("\n"),
  );
  process.exit(0);
}

const RUN_TAG = String(Date.now()).slice(-6);
const SCENARIO_COUNT = args.pilot ? 1 : args.count || 12;

// ── logging ────────────────────────────────────────────────────────────────
const t0 = Date.now();
function log(message) {
  const s = ((Date.now() - t0) / 1000).toFixed(1).padStart(6, " ");
  console.log(`[${s}s] ${message}`);
}
function section(title) {
  console.log(`\n${"═".repeat(72)}\n== ${title}\n${"═".repeat(72)}`);
}

// ── scenario catalogue ─────────────────────────────────────────────────────
// Answer quality is spread on purpose (good / vague / wrong-or-pushy) so the
// LLM judge has something to disagree about and the score distribution is real.
const SCENARIOS = [
  {
    key: "refund-delay",
    traceName: "support-refund-delay-001",
    environment: "production",
    quality: "good",
    tags: ["refund", "email", "vip"],
    meta: { ticketId: "TCK-40121", channel: "email", priority: "high", region: "DE" },
    customer:
      "My refund of 89.90 EUR has not arrived after 10 days. The order was returned on the 3rd. What should I do?",
    agent:
      "I am sorry the refund is taking this long — that is not the 3-5 business day window we promise. I checked order #88213: the return was received on the 3rd but the refund was stuck in a manual review. I have released it now, so 89.90 EUR will land back on your card within 2 business days, and I emailed you the confirmation reference RF-88213. If it has not arrived by Friday, reply here and I will chase it with the payment team directly.",
    generationInput: "Customer asks where a 89.90 EUR refund is after 10 days.",
    generationOutput:
      "Refund released manually, arrives within 2 business days, reference RF-88213 emailed.",
    modelParams: { temperature: 0.2, max_tokens: 512 },
    usage: { input: 412, output: 168, total: 580 },
  },
  {
    key: "refund-double-charge",
    traceName: "support-refund-double-charge-002",
    environment: "production",
    quality: "vague",
    tags: ["refund", "billing", "chat"],
    meta: { ticketId: "TCK-40144", channel: "chat", priority: "normal", region: "US" },
    customer:
      "I was charged twice for order #91120 — 42.00 USD on the 12th and again on the 13th. Please refund the duplicate.",
    agent:
      "Thanks for reaching out. Charges can sometimes appear twice while they are still pending, so this may resolve on its own. Please keep an eye on your statement and get back to us if the second charge is still there.",
    generationInput: "Customer reports a duplicate 42.00 USD charge.",
    generationOutput:
      "Suggested waiting for the pending charge to clear; no investigation of the duplicate.",
    modelParams: { temperature: 0.7, max_tokens: 256 },
    usage: { input: 388, output: 96, total: 484 },
  },
  {
    key: "refund-policy-wrong",
    traceName: "support-refund-policy-003",
    environment: "production",
    quality: "wrong",
    tags: ["refund", "policy", "email"],
    meta: { ticketId: "TCK-40158", channel: "email", priority: "normal", region: "FR" },
    customer:
      "I bought running shoes 45 days ago and they do not fit. Your website says 60-day returns. Can I send them back?",
    agent:
      "Unfortunately our return window is 14 days and it has passed, so a return is not possible. You could try selling the shoes online. Also, please consider that many customers find our sizing chart accurate, so you may want to order the same size again in a different colour.",
    generationInput: "Customer asks about returning shoes bought 45 days ago (60-day policy).",
    generationOutput:
      "Claimed a 14-day return window and refused the return, contradicting the stated 60-day policy.",
    modelParams: { temperature: 0.9, max_tokens: 384 },
    usage: { input: 402, output: 142, total: 544 },
  },
  {
    key: "shipping-lost",
    traceName: "support-shipping-lost-004",
    environment: "production",
    quality: "good",
    tags: ["shipping", "logistics", "email"],
    meta: { ticketId: "TCK-40173", channel: "email", priority: "high", region: "NL" },
    customer:
      "Tracking for order #77420 has not moved for 6 days and the courier says the parcel is missing. I need it for a birthday on Saturday.",
    agent:
      "That is frustrating, and I am sorry the parcel stalled. I opened a lost-parcel claim with the courier (case LP-77420) and shipped a free replacement today with Saturday delivery — the new tracking number is 3SDNL88213004. The claim result is not needed from your side; if the original parcel turns up later you can keep it. You will get an SMS with the delivery window tomorrow morning.",
    generationInput: "Customer reports a stalled parcel needed for Saturday.",
    generationOutput:
      "Free replacement shipped with Saturday delivery, lost-parcel claim opened, tracking shared.",
    modelParams: { temperature: 0.3, max_tokens: 512 },
    usage: { input: 418, output: 176, total: 594 },
  },
  {
    key: "shipping-address",
    traceName: "support-shipping-address-005",
    environment: "production",
    quality: "vague",
    tags: ["shipping", "address", "chat"],
    meta: { ticketId: "TCK-40190", channel: "chat", priority: "normal", region: "UK" },
    customer:
      "I typed the wrong house number on order #65231 and it is out for delivery today. Can you fix it?",
    agent:
      "Address changes are generally handled by the carrier once a parcel is out for delivery. Please contact the carrier and ask them to redirect the parcel.",
    generationInput: "Customer wants a wrong house number corrected on a parcel out for delivery.",
    generationOutput: "Told the customer to contact the carrier; no action taken on our side.",
    modelParams: { temperature: 0.6, max_tokens: 192 },
    usage: { input: 361, output: 84, total: 445 },
  },
  {
    key: "shipping-express-fee",
    traceName: "support-shipping-express-fee-006",
    environment: "production",
    quality: "wrong",
    tags: ["shipping", "billing", "email"],
    meta: { ticketId: "TCK-40204", channel: "email", priority: "normal", region: "US" },
    customer:
      "I paid 24.99 USD for express delivery and the parcel arrived 4 days late. I would like the express fee refunded.",
    agent:
      "Express delivery is a premium service, so the fee is non-refundable once the parcel has been handed to the courier. Delays are outside our control. As a gesture I can offer you a 5% discount code on your next order of at least 100 USD.",
    generationInput: "Customer asks for a 24.99 USD express fee refund after a 4-day delay.",
    generationOutput:
      "Refused the refund citing a non-refundable fee and offered a conditional 5% discount.",
    modelParams: { temperature: 0.8, max_tokens: 288 },
    usage: { input: 372, output: 118, total: 490 },
  },
  {
    key: "login-locked",
    traceName: "support-login-locked-007",
    environment: "production",
    quality: "good",
    tags: ["account", "login", "chat"],
    meta: { ticketId: "TCK-40219", channel: "chat", priority: "urgent", region: "CN" },
    customer:
      "我的账号登录不了了,提示“账号已锁定”。里面有我下周要用的订单数据,麻烦尽快帮我处理!",
    agent:
      "非常抱歉给您带来不便。我查询到您的账号因为连续 5 次密码错误被自动锁定,锁定期本是 30 分钟。为了保证是您本人在操作,我已经向您注册邮箱发送了验证链接,点击后即可立即解锁并重设密码。链接 24 小时内有效;如果没收到,请告诉我,我会用短信验证作为备用方式。",
    generationInput: "客户账号被锁定,急需恢复访问。",
    generationOutput: "通过邮箱验证链接立即解锁并提供短信备用验证方式。",
    modelParams: { temperature: 0.2, max_tokens: 448 },
    usage: { input: 340, output: 196, total: 536 },
  },
  {
    key: "login-2fa",
    traceName: "support-login-2fa-008",
    environment: "production",
    quality: "vague",
    tags: ["account", "security", "email"],
    meta: { ticketId: "TCK-40231", channel: "email", priority: "normal", region: "SG" },
    customer:
      "I replaced my phone and lost access to the authenticator app, so I cannot pass 2FA to log in.",
    agent:
      "Two-factor authentication exists to protect your account, so we cannot simply switch it off. Please try the recovery options available in the login flow. If those do not work, our security team may be able to help at some point.",
    generationInput: "Customer lost their 2FA authenticator after changing phones.",
    generationOutput:
      "Explained that 2FA cannot be disabled and pointed vaguely at recovery options.",
    modelParams: { temperature: 0.6, max_tokens: 256 },
    usage: { input: 302, output: 92, total: 394 },
  },
  {
    key: "billing-vat",
    traceName: "support-billing-vat-009",
    environment: "production",
    quality: "wrong",
    tags: ["billing", "invoice", "email"],
    meta: { ticketId: "TCK-40247", channel: "email", priority: "high", region: "IT" },
    customer:
      "Invoice INV-2291 shows 22% VAT but my company is registered in Ireland with a valid VAT ID, so the reverse-charge rule should apply. Please correct the invoice.",
    agent:
      "Our system applies Italian VAT based on the delivery address, and invoices cannot be changed after they are issued. The 22% VAT therefore stays as charged. For the next order you may add a note in the checkout comment field, although the outcome will most likely be the same.",
    generationInput: "B2B customer disputes 22% VAT and requests reverse-charge invoicing.",
    generationOutput:
      "Refused the correction and claimed invoices cannot be amended; deferred to a checkout comment.",
    modelParams: { temperature: 0.9, max_tokens: 320 },
    usage: { input: 396, output: 128, total: 524 },
  },
  {
    key: "product-stock",
    traceName: "support-product-stock-010",
    environment: "production",
    quality: "good",
    tags: ["product", "stock", "chat"],
    meta: { ticketId: "TCK-40262", channel: "chat", priority: "normal", region: "AU" },
    customer:
      "Is the AeroPress Go in matte black coming back in stock? I want to buy two for a café.",
    agent:
      "Good news: the matte black AeroPress Go is already on its way and is scheduled to be back in stock on 21 March. I reserved 2 units to your account for 72 hours so you do not miss the restock — you will get an email when they are live, and the reservation is free to cancel. If you need them earlier, the polished steel version is in stock today and ships same day.",
    generationInput: "Customer asks about restock timing for the matte black AeroPress Go.",
    generationOutput:
      "Restock date 21 March confirmed, 2 units reserved for 72 hours, alternative offered.",
    modelParams: { temperature: 0.3, max_tokens: 384 },
    usage: { input: 356, output: 152, total: 508 },
  },
  {
    key: "cancellation-pushy",
    traceName: "support-cancellation-retention-011",
    environment: "production",
    quality: "wrong",
    tags: ["subscription", "cancellation", "chat"],
    meta: { ticketId: "TCK-40278", channel: "chat", priority: "normal", region: "CA" },
    customer:
      "Please cancel my Pro subscription. I do not use it any more and I want it to stop before the next billing date.",
    agent:
      "Cancelling would be a real loss — Pro users save an average of 12 hours a month, and the price goes up next quarter, so locking in now is the smart move. I have kept your subscription active and added a 10% loyalty discount instead. If you still want to cancel, you will need to call our retention line during office hours and explain the reason.",
    generationInput: "Customer asks to cancel the Pro subscription before the next billing date.",
    generationOutput:
      "Kept the subscription active and made cancellation conditional on a phone call.",
    modelParams: { temperature: 1.0, max_tokens: 352 },
    usage: { input: 344, output: 140, total: 484 },
  },
  {
    key: "warranty-claim",
    traceName: "support-warranty-claim-012",
    environment: "production",
    quality: "vague",
    tags: ["warranty", "rma", "email"],
    meta: { ticketId: "TCK-40291", channel: "email", priority: "normal", region: "ES" },
    customer:
      "My blender stopped working after 7 months. It has a 2-year warranty — how do I get it replaced?",
    agent:
      "Warranty claims are handled by our service department. Please send us everything you think might be relevant and we will look into it. Note that wear-and-tear damage is not covered, so the outcome depends on the assessment.",
    generationInput: "Customer asks how to start a warranty claim for a 7-month-old blender.",
    generationOutput: "Asked for unspecified information; did not start a claim or give steps.",
    modelParams: { temperature: 0.7, max_tokens: 224 },
    usage: { input: 318, output: 88, total: 406 },
  },
  {
    key: "api-ratelimit",
    traceName: "support-api-ratelimit-013",
    environment: "staging",
    quality: "good",
    tags: ["api", "developer", "email"],
    meta: { ticketId: "TCK-40305", channel: "email", priority: "high", region: "JP" },
    customer:
      "Our integration started returning 429s at around 40 requests per second even though our plan says 100 rps. What is going on?",
    agent:
      "Thanks for the detail — that points at the burst bucket rather than the sustained limit: your plan allows 100 rps sustained but only 20 rps in a burst window, and a 40 rps burst trips it. I raised your burst bucket to 60 rps for the next 30 days so your nightly job stops failing, and I added the change to your account notes. The full limits table is at docs.example.com/limits; if you can send one request-id that got a 429 I will confirm it is the same bucket.",
    generationInput: "Developer reports 429s at 40 rps despite a 100 rps plan.",
    generationOutput:
      "Explained the burst bucket (20 rps) and raised it to 60 rps for 30 days; asked for a request-id.",
    modelParams: { temperature: 0.3, max_tokens: 448 },
    usage: { input: 386, output: 164, total: 550 },
  },
  {
    key: "subscription-refund-zh",
    traceName: "support-subscription-refund-zh-014",
    environment: "production",
    quality: "wrong",
    tags: ["退款", "订阅", "微信"],
    meta: { ticketId: "TCK-40318", channel: "wechat", priority: "normal", region: "CN" },
    customer:
      "我上个月续费了年度会员 699 元,但只用了三天就不想用了,可以退我剩下的钱吗?你们页面上写的是可以退款的。",
    agent:
      "年度会员属于特价商品,按照我们的规定是不支持退款的。您可以在二手平台上转让账号,或者等会员到期后不要续费。另外提醒一下,继续使用我们的服务其实比退款更划算,很多用户续费后都觉得物有所值。",
    generationInput: "客户要求退还未使用的年度会员费用。",
    generationOutput: "以“特价商品”为由拒绝退款,并建议转卖账号。",
    modelParams: { temperature: 0.9, max_tokens: 320 },
    usage: { input: 330, output: 126, total: 456 },
  },
];

// ── tiny helpers ───────────────────────────────────────────────────────────
const hex = (bytes) => crypto.randomBytes(bytes).toString("hex");
const attr = (key, stringValue) => ({ key, value: { stringValue } });
const attrArray = (key, values) => ({
  key,
  value: { arrayValue: { values: values.map((v) => ({ stringValue: v })) } },
});
// NOTE: no integer-valued attributes here on purpose. `langfuse.observation.level`
// in particular must be a string (see the KNOWN TRAP note in the header).

/** One OTLP resourceSpans entry per scenario: a root span + one child GENERATION. */
function buildScenarioPayload(scenario, index) {
  const traceId = hex(16);
  const rootSpanId = hex(8);
  const childSpanId = hex(8);
  const startMs = Date.now() - (SCENARIO_COUNT - index) * 45_000;
  const rootEndMs = startMs + 1_400 + index * 37;
  const childStartMs = startMs + 120;
  const childEndMs = startMs + 1_050 + index * 29;
  const nano = (ms) => (BigInt(Math.round(ms)) * 1_000_000n).toString();

  return {
    traceId,
    rootSpanId,
    childSpanId,
    scenario,
    resourceSpans: {
      resource: {
        attributes: [
          attr("service.name", "jev-demo-support-bot"),
          attr("langfuse.environment", scenario.environment),
          attr("langfuse.release", `seed-${RUN_TAG}`),
          attr("deployment.environment", scenario.environment),
        ],
      },
      scopeSpans: [
        {
          scope: { name: "jev-demo-support-bot", version: "1.4.0" },
          spans: [
            {
              traceId,
              spanId: rootSpanId,
              name: scenario.traceName,
              kind: 1,
              startTimeUnixNano: nano(startMs),
              endTimeUnixNano: nano(rootEndMs),
              attributes: [
                attr("langfuse.trace.name", scenario.traceName),
                attr("langfuse.trace.input", scenario.customer),
                attr("langfuse.trace.output", scenario.agent),
                attr(
                  "langfuse.trace.metadata",
                  JSON.stringify({
                    ...scenario.meta,
                    scenario: scenario.key,
                    expectedQuality: scenario.quality,
                    seedRun: RUN_TAG,
                  }),
                ),
                attrArray("langfuse.trace.tags", scenario.tags),
                attr("langfuse.user.id", `cust-${scenario.meta.ticketId.toLowerCase()}`),
                attr("langfuse.session.id", `sess-${scenario.key}-${RUN_TAG}`),
                attr("langfuse.observation.type", "span"),
                attr("langfuse.observation.input", scenario.customer),
                attr("langfuse.observation.output", scenario.agent),
                attr(
                  "langfuse.observation.metadata",
                  JSON.stringify({ stage: "agent-reply", scenario: scenario.key }),
                ),
              ],
            },
            {
              traceId,
              spanId: childSpanId,
              parentSpanId: rootSpanId,
              name: "llm-completion",
              kind: 3,
              startTimeUnixNano: nano(childStartMs),
              endTimeUnixNano: nano(childEndMs),
              attributes: [
                attr("langfuse.observation.type", "generation"),
                attr("langfuse.observation.model.name", JUDGE_MODEL),
                attr(
                  "langfuse.observation.model.parameters",
                  JSON.stringify(scenario.modelParams ?? {}),
                ),
                attr(
                  "langfuse.observation.usage_details",
                  JSON.stringify(scenario.usage ?? {}),
                ),
                attr("langfuse.observation.input", scenario.generationInput),
                attr("langfuse.observation.output", scenario.generationOutput),
                attr(
                  "langfuse.observation.metadata",
                  JSON.stringify({ scenario: scenario.key, quality: scenario.quality }),
                ),
                attr(
                  "langfuse.observation.level",
                  scenario.quality === "wrong" ? "WARNING" : "DEFAULT",
                ),
              ],
            },
          ],
        },
      ],
    },
  };
}

// ── infrastructure helpers ─────────────────────────────────────────────────
function psql(sql, database = "postgres") {
  try {
    return execFileSync("docker", [
      "exec",
      PG_CONTAINER,
      "psql",
      "-U",
      PG_USER,
      "-d",
      database,
      "-t",
      "-A",
      "-F",
      "|",
      "-c",
      sql,
    ])
      .toString()
      .trim();
  } catch (error) {
    return `PSQL_ERROR: ${String(error.message).slice(0, 300)}`;
  }
}

async function withDoris(fn) {
  const connection = await mysql.createConnection({
    host: process.env.DORIS_MYSQL_HOST ?? "127.0.0.1",
    port: Number(process.env.DORIS_QUERY_PORT ?? 9030),
    user: process.env.DORIS_USER ?? "root",
    password: process.env.DORIS_PASSWORD ?? "",
    database: process.env.DORIS_DB ?? "litefuse",
  });
  try {
    return await fn(connection);
  } finally {
    await connection.end();
  }
}

async function dorisQuery(sql) {
  return withDoris(async (connection) => {
    const [rows] = await connection.query(sql);
    return rows;
  });
}

async function ingestOtlp(publicKey, secretKey, resourceSpans) {
  const res = await fetch(`${WEB}/api/public/otel/v1/traces`, {
    method: "POST",
    headers: {
      authorization:
        "Basic " + Buffer.from(`${publicKey}:${secretKey}`).toString("base64"),
      "content-type": "application/json",
      // Required by this fork: traces are OTel-only and older-looking clients
      // are rejected with "Master spans ingestion requires Python SDK >= 4.0.0".
      "x-langfuse-ingestion-version": "4",
      "x-langfuse-sdk-name": "litefuse-seed",
      "x-langfuse-sdk-version": "5.0.0",
    },
    body: JSON.stringify({ resourceSpans }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 400);
  }
  return { status: res.status, body };
}

const sqlList = (ids) => ids.map((id) => `'${id}'`).join(",");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── session bookkeeping (temp key must never survive) ──────────────────────
const session = { cookie: null, keyId: null, publicKey: null, cleaned: false };

async function removeTemporaryKey() {
  if (session.cleaned) return;
  session.cleaned = true;
  if (!session.keyId || !session.cookie) return;
  try {
    await trpc("projectApiKeys.delete", {
      input: { projectId: PROJECT_ID, id: session.keyId },
      cookie: session.cookie,
    });
    log(`temporary API key ${session.publicKey?.slice(0, 16)}… deleted via tRPC`);
  } catch (error) {
    console.log(
      `!! could not delete temporary key ${session.keyId}: ${error.message}`,
    );
  }
}

process.on("SIGINT", async () => {
  await removeTemporaryKey();
  process.exit(130);
});

// ── evaluator / rule bootstrap (idempotent) ────────────────────────────────
async function findEvaluatorByName(cookie, name) {
  const result = await trpc("evalsV2.list", {
    method: "GET",
    input: { projectId: PROJECT_ID, limit: 100 },
    cookie,
  });
  const list = result?.evaluators ?? result?.items ?? (Array.isArray(result) ? result : []);
  return list.find((e) => e.name === name) ?? null;
}

async function findRuleByName(cookie, name) {
  const result = await trpc("evalsV2.rules.list", {
    method: "GET",
    input: { projectId: PROJECT_ID, limit: 100 },
    cookie,
  });
  const list = result?.rules ?? (Array.isArray(result) ? result : []);
  return list.find((r) => r.name === name) ?? null;
}

function defaultVariableMapping() {
  return [
    { templateVariable: "input", selectedColumnId: "input" },
    { templateVariable: "output", selectedColumnId: "output" },
  ];
}

async function ensureBooleanEvaluator(cookie, provider) {
  const existing = await findEvaluatorByName(cookie, BOOLEAN_EVALUATOR_NAME);
  if (existing) {
    log(`evaluator reused: "${BOOLEAN_EVALUATOR_NAME}" (${existing.id})`);
    const detail = await trpc("evalsV2.get", {
      method: "GET",
      input: { projectId: PROJECT_ID, evaluatorId: existing.id },
      cookie,
    });
    const version = detail?.versions?.[0];
    log(
      `  type=${detail?.type} model=${version?.provider}/${version?.model} ` +
        `output=${version?.outputDefinition?.dataType} vars=${JSON.stringify(version?.vars)}`,
    );
    return { id: existing.id, created: false, dataType: version?.outputDefinition?.dataType };
  }

  const created = await trpc("evalsV2.create", {
    input: {
      projectId: PROJECT_ID,
      name: BOOLEAN_EVALUATOR_NAME,
      description:
        "Second demo evaluator: a boolean verdict on whether the support reply is acceptable to send.",
      definition: {
        type: "LLM_AS_JUDGE",
        promptMessages: [
          {
            role: "system",
            content:
              "You review customer-support replies for a webshop. Decide whether the agent reply is ACCEPTABLE to send to the customer: it must be accurate, complete enough to act on, and not refuse or upsell where the customer is entitled to help. Do not reward politeness alone.",
          },
          {
            role: "user",
            content:
              "Customer message:\n{{input}}\n\nAgent reply:\n{{output}}\n\nIs this reply acceptable to send to the customer? Give the boolean verdict and a one-sentence reason.",
          },
        ],
        modelConfig: { provider, model: JUDGE_MODEL },
        outputDefinition: {
          dataType: "BOOLEAN",
          reasoning: {
            description:
              "One sentence explaining why the reply is or is not acceptable.",
          },
          score: {
            description:
              "true when the reply is acceptable to send to the customer, false otherwise.",
          },
        },
        variableMapping: defaultVariableMapping(),
      },
    },
    cookie,
  });
  const id = created?.evaluator?.id ?? created?.id;
  if (!id) throw new Error("boolean evaluator creation returned no id");
  log(`evaluator created: "${BOOLEAN_EVALUATOR_NAME}" (${id})`);
  return { id, created: true, dataType: "BOOLEAN" };
}

async function ensureRootSpanRule(cookie, evaluatorId) {
  const existing = await findRuleByName(cookie, BOOLEAN_RULE_NAME);
  if (existing) {
    const detail = await trpc("evalsV2.rules.get", {
      method: "GET",
      input: { projectId: PROJECT_ID, ruleId: existing.id },
      cookie,
    });
    log(
      `rule reused: "${BOOLEAN_RULE_NAME}" (${existing.id}) enabled=${detail?.enabled} ` +
        `sampling=${detail?.sampling} filter=${JSON.stringify(detail?.filter)}`,
    );
    return { id: existing.id, created: false };
  }

  const rule = await trpc("evalsV2.rules.create", {
    input: {
      projectId: PROJECT_ID,
      name: BOOLEAN_RULE_NAME,
      // Deliberate: this is the upstream spelling of "root spans only" and it
      // also exercises the newly wired `isRootObservation` filter mapping.
      filter: [
        { column: "isRootObservation", type: "boolean", operator: "=", value: true },
      ],
      sampling: 1,
      enabled: true,
      targetObject: "event",
      evaluatorAssignments: [
        { evaluatorId, variableMapping: defaultVariableMapping() },
      ],
    },
    cookie,
  });
  const id = rule?.rule?.id ?? rule?.id;
  if (!id) throw new Error("root-span rule creation returned no id");
  log(`rule created: "${BOOLEAN_RULE_NAME}" (${id}) filter=isRootObservation=true`);
  return { id, created: true };
}

async function loadNumericSetup(cookie) {
  const evaluator = await findEvaluatorByName(cookie, NUMERIC_EVALUATOR_NAME);
  const rule = await findRuleByName(cookie, NUMERIC_RULE_NAME);
  return { evaluator, rule };
}

// ── main ───────────────────────────────────────────────────────────────────
(async () => {
  section("0. preflight: session, temp API key, LLM connection");
  session.cookie = await login({ email: EMAIL, password: PASSWORD });
  log(`logged in as ${EMAIL} (project ${PROJECT_ID})`);

  const connections = await trpc("llmApiKey.all", {
    method: "GET",
    input: { projectId: PROJECT_ID },
    cookie: session.cookie,
  });
  const options = (connections?.data ?? []).map((c) => ({
    provider: c.provider,
    adapter: c.adapter,
    models: c.customModels ?? [],
  }));
  log(`LLM connections: ${JSON.stringify(options)}`);
  const provider =
    options.find((o) => o.models.includes(JUDGE_MODEL))?.provider ??
    options[0]?.provider;
  if (!provider) throw new Error("no LLM connection in the Jev project");
  if (!options.some((o) => o.models.includes(JUDGE_MODEL))) {
    throw new Error(`no LLM connection serves model ${JUDGE_MODEL}`);
  }
  log(`judge target: provider=${provider} model=${JUDGE_MODEL}`);

  const createdKey = await trpc("projectApiKeys.create", {
    input: { projectId: PROJECT_ID, note: TEMP_KEY_NOTE },
    cookie: session.cookie,
  });
  const { publicKey, secretKey } = createdKey;
  session.keyId = createdKey.id;
  session.publicKey = publicKey;
  if (!publicKey || !secretKey) throw new Error("api key creation returned no secret");
  log(`temporary project key ${publicKey} (id ${createdKey.id}) — deleted at the end`);

  const baselineJobs = psql(
    `select count(*) from job_executions where project_id = '${PROJECT_ID}';`,
  );
  const baselineScores = await dorisQuery(
    `select count(*) as c from scores where project_id = '${PROJECT_ID}'`,
  );
  const baselineTraces = await dorisQuery(
    `select count(*) as c from traces_scalar_${PROJECT_ID}`,
  );
  const baselineSpans = await dorisQuery(
    `select count(*) as c from spans_${PROJECT_ID}`,
  );
  log(
    `baseline: traces=${baselineTraces[0].c} spans=${baselineSpans[0].c} ` +
      `scores=${baselineScores[0].c} job_executions=${baselineJobs || "?"}`,
  );

  // ── rules must exist BEFORE ingestion (see header note) ──────────────────
  section("1. ensure evaluators + rules (idempotent, before ingestion)");
  const numeric = await loadNumericSetup(session.cookie);
  log(
    numeric.evaluator
      ? `numeric evaluator present: "${NUMERIC_EVALUATOR_NAME}" (${numeric.evaluator.id})`
      : `WARNING: numeric evaluator "${NUMERIC_EVALUATOR_NAME}" not found`,
  );
  log(
    numeric.rule
      ? `numeric rule present: "${NUMERIC_RULE_NAME}" (${numeric.rule.id})`
      : `WARNING: numeric rule "${NUMERIC_RULE_NAME}" not found`,
  );

  const booleanEvaluator = await ensureBooleanEvaluator(session.cookie, provider);
  const booleanRule = await ensureRootSpanRule(session.cookie, booleanEvaluator.id);

  const activeRules = psql(
    `select id, target_object, status, sampling, filter::text from evaluation_rules ` +
      `where project_id = '${PROJECT_ID}' and status = 'ACTIVE';`,
  );
  log(`active v2 rules:\n${activeRules}`);
  const legacyEventRules = psql(
    `select count(*) from job_configurations where project_id = '${PROJECT_ID}' ` +
      `and status = 'ACTIVE' and blocked_at is null and target_object = 'event';`,
  );
  log(
    `pre-existing legacy event rules that will also be scheduled: ${legacyEventRules}`,
  );

  // ── cost projection ─────────────────────────────────────────────────────
  const projectedOwnCalls = SCENARIO_COUNT * 3; // numeric (root+child) + boolean (root)
  const projectedLegacyCalls = Number(legacyEventRules.trim() || "0") * SCENARIO_COUNT;
  section("2. cost projection");
  log(
    `projected judge calls, this script's two evaluators: ${SCENARIO_COUNT} x 3 = ${projectedOwnCalls} ` +
      `(numeric root+child = 2, boolean root = 1; limit ${args.maxCalls})`,
  );
  log(
    `projected judge calls, pre-existing legacy event rules: ~${projectedLegacyCalls} ` +
      `(${legacyEventRules.trim()} rule(s) x ${SCENARIO_COUNT}; not modified by this script)`,
  );
  if (projectedOwnCalls > args.maxCalls) {
    throw new Error(
      `projected ${projectedOwnCalls} judge calls for this script's evaluators exceeds ` +
        `--max-calls=${args.maxCalls}; not ingesting`,
    );
  }

  // ── filter semantics of the root-only rule (zero LLM calls) ─────────────
  section("2b. isRootObservation filter resolution (activationCostEstimates, no LLM call)");
  const filterVariants = {
    "empty filter": [],
    "isRootObservation = true  (the root-only rule)": [
      { column: "isRootObservation", type: "boolean", operator: "=", value: true },
    ],
    "isRootObservation = false": [
      { column: "isRootObservation", type: "boolean", operator: "=", value: false },
    ],
  };
  for (const [label, filter] of Object.entries(filterVariants)) {
    try {
      const estimate = await trpc("evalsV2.activationCostEstimates", {
        input: {
          projectId: PROJECT_ID,
          evaluatorIds: [booleanEvaluator.id],
          filter,
          sampling: 1,
          // A single evaluator id plus a known cost suppresses the automatic
          // test evaluation, so this check spends nothing.
          knownTestRunCostUsd: 0,
          shouldRunMissingTest: false,
        },
        cookie: session.cookie,
      });
      log(
        `  ${label.padEnd(46)} -> matchingObservations=${JSON.stringify(estimate?.[0]?.matchingObservations)}`,
      );
    } catch (error) {
      log(`  ${label.padEnd(46)} -> ERROR: ${error.message}`);
    }
  }

  // ── ingest ──────────────────────────────────────────────────────────────
  section("3. ingest support-ticket traces over OTLP");
  const picked = args.pilot
    ? SCENARIOS.slice(0, 1)
    : SCENARIOS.slice(0, Math.min(SCENARIO_COUNT, SCENARIOS.length));
  if (args.pilot) picked[0] = { ...picked[0], traceName: `zz-pilot-${picked[0].traceName}` };
  if (picked.length < 12 && !args.pilot) {
    log(`WARNING: only ${picked.length} scenarios available (spec asks for 12-16)`);
  }

  const built = picked.map((scenario, index) => buildScenarioPayload(scenario, index));
  let ingestedOk = 0;
  for (let i = 0; i < built.length; i += args.batch) {
    const chunk = built.slice(i, i + args.batch);
    const res = await ingestOtlp(
      publicKey,
      secretKey,
      chunk.map((b) => b.resourceSpans),
    );
    const partial = res.body?.partialSuccess;
    log(
      `batch ${i / args.batch + 1} (${chunk.length} traces): HTTP ${res.status}` +
        (partial ? ` partialSuccess=${JSON.stringify(partial)}` : "") +
        (res.status >= 300 ? ` body=${JSON.stringify(res.body).slice(0, 300)}` : ""),
    );
    if (res.status >= 300) {
      throw new Error(`OTLP ingestion failed with HTTP ${res.status}`);
    }
    ingestedOk += chunk.length;
  }
  const traceIds = built.map((b) => b.traceId);
  const childSpanIds = built.map((b) => b.childSpanId);
  log(`ingested ${ingestedOk}/${built.length} traces (${built.length * 2} spans)`);
  for (const b of built) {
    log(`  ${b.traceId}  ${b.scenario.traceName}  [${b.scenario.quality}] env=${b.scenario.environment}`);
  }

  // ── wait for Doris ──────────────────────────────────────────────────────
  section("4. wait for Doris visibility");
  const traceWaitStart = Date.now();
  let tracesSeen = 0;
  let spansSeen = 0;
  while (Date.now() - traceWaitStart < args.traceWaitMs) {
    const t = await dorisQuery(
      `select count(*) as c from traces_scalar_${PROJECT_ID} where id in (${sqlList(traceIds)})`,
    );
    const s = await dorisQuery(
      `select count(*) as c from spans_${PROJECT_ID} where trace_id in (${sqlList(traceIds)})`,
    );
    tracesSeen = Number(t[0].c);
    spansSeen = Number(s[0].c);
    if (tracesSeen === traceIds.length && spansSeen === traceIds.length * 2) break;
    await sleep(3000);
  }
  const traceWaitSec = ((Date.now() - traceWaitStart) / 1000).toFixed(1);
  log(
    `visible after ${traceWaitSec}s: traces ${tracesSeen}/${traceIds.length}, ` +
      `spans ${spansSeen}/${traceIds.length * 2} (root + child GENERATION)`,
  );
  if (tracesSeen < traceIds.length) log("WARNING: some traces are not visible yet");

  // ── wait for evaluations ────────────────────────────────────────────────
  section("5. wait for evaluations (real LLM judge calls)");
  const evalStart = Date.now();
  let lastReport = 0;
  let lastScoreCount = -1;
  let stableSince = Date.now();
  let scoreRows = [];
  const expectedScores = SCENARIO_COUNT * 4; // numeric on 2 spans + boolean + legacy
  while (Date.now() - evalStart < args.waitMs) {
    scoreRows = await dorisQuery(
      `select name, data_type, trace_id, observation_id, value, comment, timestamp ` +
        `from scores where project_id = '${PROJECT_ID}' ` +
        `and trace_id in (${sqlList(traceIds)}) order by timestamp desc`,
    );
    // Jobs are the ground truth for "how many judge calls did this cost":
    // one terminal (COMPLETED/ERROR) job == one provider call attempt.
    const jobStatuses = psql(
      `select status, count(*) from job_executions where project_id = '${PROJECT_ID}' ` +
        `and job_input_trace_id in (${sqlList(traceIds)}) group by status order by status;`,
    ).replace(/\n/g, " ");
    const pending = Number(
      (jobStatuses.match(/PENDING\|(\d+)/) ?? [])[1] ??
        (jobStatuses.match(/DELAYED\|(\d+)/) ?? [])[1] ??
        0,
    );
    if (scoreRows.length !== lastScoreCount) {
      lastScoreCount = scoreRows.length;
      stableSince = Date.now();
    }
    const settled = pending === 0 && scoreRows.length > 0;
    const quiet = Date.now() - stableSince > 45_000;
    if (settled && (scoreRows.length >= expectedScores || quiet)) {
      log(
        `settled: ${scoreRows.length} score rows, no PENDING jobs ` +
          `(projected ${expectedScores}); stopping the wait`,
      );
      break;
    }
    if (Date.now() - lastReport > 20_000) {
      lastReport = Date.now();
      const elapsed = Math.round((Date.now() - evalStart) / 1000);
      log(
        `[${elapsed}s] scores=${scoreRows.length}/${expectedScores} | ` +
          `jobs for seeded traces: ${jobStatuses || "(none yet)"}`,
      );
    }
    await sleep(5000);
  }

  // Grace poll: a short --wait-ms must not produce an empty report while the
  // judge calls are still in flight.
  if (scoreRows.length === 0) {
    const graceStart = Date.now();
    while (Date.now() - graceStart < 90_000) {
      await sleep(5000);
      scoreRows = await dorisQuery(
        `select name, data_type, trace_id, observation_id, value, comment, timestamp ` +
          `from scores where project_id = '${PROJECT_ID}' ` +
          `and trace_id in (${sqlList(traceIds)}) order by timestamp desc`,
      );
      if (scoreRows.length > 0) {
        log(`grace poll: first ${scoreRows.length} score row(s) after ${Math.round((Date.now() - graceStart) / 1000)}s`);
        break;
      }
    }
  }

  // ── report ──────────────────────────────────────────────────────────────
  section("6. results");
  const finalTraces = await dorisQuery(
    `select count(*) as c from traces_scalar_${PROJECT_ID} where id in (${sqlList(traceIds)})`,
  );
  const finalSpans = await dorisQuery(
    `select count(*) as c from spans_${PROJECT_ID} where trace_id in (${sqlList(traceIds)})`,
  );
  const finalRoots = await dorisQuery(
    `select count(*) as c from spans_${PROJECT_ID} where trace_id in (${sqlList(traceIds)}) and is_root = 1`,
  );
  const finalChildren = await dorisQuery(
    `select count(*) as c from spans_${PROJECT_ID} where trace_id in (${sqlList(traceIds)}) and is_root = 0`,
  );
  const projectTracesUser = await dorisQuery(
    `select count(*) as c from traces_scalar_${PROJECT_ID} where environment not like 'langfuse-%'`,
  );
  const projectTracesAll = await dorisQuery(
    `select count(*) as c from traces_scalar_${PROJECT_ID}`,
  );
  const projectSpansAll = await dorisQuery(
    `select count(*) as c from spans_${PROJECT_ID}`,
  );
  console.log(
    `seeded traces in Doris           : ${finalTraces[0].c}/${traceIds.length}\n` +
      `seeded spans in Doris            : ${finalSpans[0].c} (roots ${finalRoots[0].c}, children ${finalChildren[0].c})\n` +
      `project traces (user environments): ${projectTracesUser[0].c}\n` +
      `project traces (all environments) : ${projectTracesAll[0].c} (difference = internal langfuse-* judge-execution traces, one per LLM call)\n` +
      `project spans (all)               : ${projectSpansAll[0].c}`,
  );

  console.log("\njob_executions by status (whole project):");
  console.log(
    psql(
      `select status, count(*) from job_executions where project_id = '${PROJECT_ID}' group by status order by status;`,
    ) || "(none)",
  );
  console.log("\njob_executions for the seeded traces, per evaluator/rule:");
  console.log(
    psql(
      `select coalesce(jc.score_name, je.job_configuration_id) as rule, je.status, count(*) ` +
        `from job_executions je left join job_configurations jc on jc.id = je.job_configuration_id ` +
        `where je.project_id = '${PROJECT_ID}' and je.job_input_trace_id in (${sqlList(traceIds)}) ` +
        `group by 1, 2 order by 1, 2;`,
    ) || "(none)",
  );
  console.log("\nnewest job_executions:");
  console.log(
    psql(
      `select id, status, job_configuration_id, job_input_observation_id, left(coalesce(error,''), 200) ` +
        `from job_executions where project_id = '${PROJECT_ID}' order by created_at desc limit 12;`,
    ),
  );
  console.log("\njudge-call accounting (one terminal job == one provider call attempt):");
  const callAccounting = await dorisQuery(
    `select name, data_type, count(*) as c from scores where project_id = '${PROJECT_ID}' ` +
      `and trace_id in (${sqlList(traceIds)}) group by name, data_type order by c desc`,
  );
  const ownCalls = callAccounting
    .filter((r) => r.name === BOOLEAN_EVALUATOR_NAME || r.name === NUMERIC_EVALUATOR_NAME)
    .reduce((sum, r) => sum + Number(r.c), 0);
  const otherCalls = callAccounting
    .filter((r) => r.name !== BOOLEAN_EVALUATOR_NAME && r.name !== NUMERIC_EVALUATOR_NAME)
    .reduce((sum, r) => sum + Number(r.c), 0);
  console.log(
    `  this script's two evaluators : ${ownCalls} scores (${SCENARIO_COUNT} traces x 3)\n` +
      `  other (pre-existing) rules   : ${otherCalls} scores\n` +
      `  total judge calls for the batch: ${ownCalls + otherCalls}`,
  );
  console.log("\nscores by evaluator name + data_type (whole project):");
  console.log(
    (
      await dorisQuery(
        `select name, data_type, count(*) as c from scores where project_id = '${PROJECT_ID}' ` +
          `group by name, data_type order by c desc`,
      )
    )
      .map((r) => `  ${r.name} | ${r.data_type} | ${r.c}`)
      .join("\n") || "  (none)",
  );
  console.log("\nscores for the seeded traces:");
  console.log(
    (
      await dorisQuery(
        `select name, data_type, count(*) as c, min(value) as min_v, max(value) as max_v, ` +
          `avg(value) as avg_v from scores where project_id = '${PROJECT_ID}' ` +
          `and trace_id in (${sqlList(traceIds)}) group by name, data_type order by c desc`,
      )
    )
      .map(
        (r) =>
          `  ${r.name} | ${r.data_type} | n=${r.c} | min=${r.min_v} max=${r.max_v} avg=${Number(r.avg_v).toFixed(2)}`,
      )
      .join("\n") || "  (none)",
  );

  console.log("\nvalue distribution per evaluator (seeded traces):");
  const dist = await dorisQuery(
    `select name, cast(value as string) as v, count(*) as c from scores where project_id = '${PROJECT_ID}' ` +
      `and trace_id in (${sqlList(traceIds)}) group by name, cast(value as string) order by name, v`,
  );
  console.log(
    dist.map((r) => `  ${r.name} → value ${r.v}: ${r.c}`).join("\n") || "  (none)",
  );

  console.log("\ntrace → scores (seeded traces):");
  const byTrace = new Map(traceIds.map((id) => [id, {}]));
  for (const row of scoreRows) {
    const entry = byTrace.get(row.trace_id);
    if (entry) entry[row.name] = row.value;
  }
  for (const b of built) {
    const entry = byTrace.get(b.traceId) ?? {};
    const cells = Object.entries(entry)
      .map(([k, v]) => `${k}=${v}`)
      .join("  ");
    console.log(
      `  ${b.scenario.traceName.padEnd(38)} [${b.scenario.quality.padEnd(5)}] ` +
        (cells || "— NO SCORES (span was never scheduled?)"),
    );
  }

  // Per-span job coverage: catches the silent-skip failure mode where a span
  // is visible in Doris but never reaches the evaluator.
  console.log("\nspan → job executions (seeded traces):");
  const spanJobs = psql(
    `select job_input_observation_id, count(*), string_agg(distinct status::text, ',') ` +
      `from job_executions where project_id = '${PROJECT_ID}' ` +
      `and job_input_trace_id in (${sqlList(traceIds)}) group by 1;`,
  );
  const spanJobMap = new Map(
    (spanJobs || "")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [spanId, count, statuses] = line.split("|");
        return [spanId, { count, statuses }];
      }),
  );
  let unscheduled = 0;
  for (const b of built) {
    for (const [label, spanId] of [
      ["root ", b.rootSpanId],
      ["child", b.childSpanId],
    ]) {
      const hit = spanJobMap.get(spanId);
      if (!hit) unscheduled += 1;
      console.log(
        `  ${b.scenario.traceName.padEnd(38)} ${label} ${spanId} -> ` +
          (hit ? `${hit.count} job(s) [${hit.statuses}]` : "0 jobs  <-- NOT SCHEDULED"),
      );
    }
  }
  console.log(
    `  spans with no job execution at all: ${unscheduled} / ${built.length * 2}`,
  );

  console.log("\nexample judge comments (verbatim):");
  for (const name of [BOOLEAN_EVALUATOR_NAME, NUMERIC_EVALUATOR_NAME]) {
    const rows = scoreRows.filter((r) => r.name === name && r.comment);
    console.log(`\n  ── ${name} (${rows.length} comments) ──`);
    for (const row of rows.slice(0, 2)) {
      const scenario = built.find((b) => b.traceId === row.trace_id);
      console.log(
        `  [${scenario?.scenario.traceName ?? row.trace_id}] value=${row.value}\n    "${row.comment}"`,
      );
    }
    if (!rows.length) console.log("  (no comments)");
  }

  // ── cleanup + evidence ──────────────────────────────────────────────────
  section("7. cleanup");
  await removeTemporaryKey();
  const leftover = psql(
    `select count(*) from api_keys where project_id = '${PROJECT_ID}' and note = '${TEMP_KEY_NOTE}';`,
  );
  log(`api_keys rows with note "${TEMP_KEY_NOTE}": ${leftover} (expected 0)`);
  log(
    `keys left in the project: ${psql(
      `select string_agg(coalesce(note,'(no note)'), ', ') from api_keys where project_id = '${PROJECT_ID}';`,
    )}`,
  );

  section("8. summary");
  console.log(
    JSON.stringify(
      {
        runTag: RUN_TAG,
        pilot: args.pilot,
        tracesIngested: built.length,
        spansIngested: built.length * 2,
        tracesInDoris: Number(finalTraces[0].c),
        rootSpansInDoris: Number(finalRoots[0].c),
        childSpansInDoris: Number(finalChildren[0].c),
        booleanEvaluator: {
          id: booleanEvaluator.id,
          name: BOOLEAN_EVALUATOR_NAME,
          dataType: booleanEvaluator.dataType,
          createdNow: booleanEvaluator.created,
        },
        booleanRule: {
          id: booleanRule.id,
          name: BOOLEAN_RULE_NAME,
          filter: "isRootObservation = true",
          createdNow: booleanRule.created,
        },
        numericEvaluator: { id: numeric.evaluator?.id ?? null, name: NUMERIC_EVALUATOR_NAME },
        numericRule: { id: numeric.rule?.id ?? null, name: NUMERIC_RULE_NAME },
        scoreRowsForSeededTraces: scoreRows.length,
        judgeCalls: {
          ownEvaluators: ownCalls,
          preExistingRules: otherCalls,
          totalForBatch: ownCalls + otherCalls,
          projectedOwnCalls,
        },
        spansWithoutAnyJobExecution: unscheduled,
        temporaryKeyDeleted: true,
      },
      null,
      2,
    ),
  );

  const tempKeyGone = leftover === "0";
  if (!tempKeyGone || scoreRows.length === 0) {
    console.log(
      `\nWARNING: ${!tempKeyGone ? "temporary key row still present; " : ""}` +
        `${scoreRows.length === 0 ? "no scores were produced for the seeded traces" : ""}`,
    );
    process.exitCode = 2;
  }
})().catch(async (error) => {
  console.error(`\nSEED FAILED: ${error.message}`);
  console.error(error.stack?.split("\n").slice(1, 4).join("\n"));
  await removeTemporaryKey();
  process.exitCode = 1;
});

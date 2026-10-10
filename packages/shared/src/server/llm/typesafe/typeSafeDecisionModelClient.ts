// ── LITEFUSE NOTE (authored; wire-compatible replacement) ───────────────────
// Upstream builds this client on `@ai-sdk/typesafe-ai` + `experimental_evaluate`
// from `ai@7`. Decision U1 does not adopt the AI SDK, so this hand-writes the same
// call.
//
// It is wire-compatible on purpose: the request path, headers, body and response
// shape were read from the installed `@ai-sdk/typesafe-ai@3.0.16` dist
// (`dist/index.js`, `DecisionTypeSafeAiModel.doDecide`), so a Jev endpoint that
// upstream can talk to works unchanged:
//
//   POST {baseURL}/systemone
//   Authorization: Bearer <apiKey>
//   { model, state, questions }            // boolean questions are sent as "noul"
//   → { model, answers: { id: answer }, usage: { input_tokens, output_tokens } }
//
// Upstream's 95-line client only delegates one call (`evaluate`) to the SDK; the
// rest of it — answer translation, confidence clean-up — is written out here too,
// because that part has to exist either way.
//
// Proxy support (LITEFUSE ADDITION): a raw `fetch` ignores the HTTP(S)_PROXY
// environment variables, so a Jev endpoint that is only reachable through a proxy
// (e.g. a region-restricted provider behind a VPN, or a corporate gateway) would
// otherwise be unreachable. This mirrors what `fetchLLMCompletion` already does for
// the LLM-judge path: build an undici `ProxyAgent` from `HTTPS_PROXY` and hand it to
// fetch as the dispatcher. Note undici's ProxyAgent speaks HTTP(S) proxies only —
// a SOCKS5-only proxy needs a bridge or a SOCKS-capable agent.
//
// Deviation: upstream wraps fetch in `createSecureLlmFetch` (SSRF hardening for a
// user-supplied base URL). We do not have that module, and no other LLM call in
// this project validates the connection's base URL either, so this uses plain
// `fetch` and stays consistent. Hardening suggestion: reuse the guards in
// `server/webhooks/ipBlocking.ts` for both this and `fetchLLMCompletion`.
// ────────────────────────────────────────────────────────────────────────────

import { z } from "zod/v4";
import { ProxyAgent, type Dispatcher } from "undici";

import { env } from "../../../env";
import type {
  DecisionModelAnswer,
  DecisionModelClient,
  DecisionModelEvaluation,
  DecisionModelRequest,
  DecisionModelRequestQuestion,
} from "../../evals/decisionModelEvaluatorExecution";

const DEFAULT_BASE_URL = "https://api.typesafe.ai/v1";
const DECISION_PATH = "/systemone";
const USER_AGENT = "litefuse-evaluator/1";

/** Mirrors the provider's response schema (see the file header). */
const decisionResponseSchema = z.object({
  model: z.string().nullish(),
  answers: z.record(
    z.string(),
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("choice"),
        choice: z.string(),
        probabilities: z.record(z.string(), z.number()),
        confidence: z.number().nullish(),
      }),
      z.object({
        type: z.literal("score"),
        score: z.number(),
        probabilities: z.record(z.string(), z.number()),
        confidence: z.number().nullish(),
      }),
      z.object({
        type: z.literal("noul"),
        noul: z.number(),
      }),
    ]),
  ),
  usage: z
    .object({
      input_tokens: z.number().nullish(),
      output_tokens: z.number().nullish(),
    })
    .nullish(),
});

function withoutTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/** Boolean questions are sent as `noul`; everything else passes through. */
function toWireQuestion(question: DecisionModelRequestQuestion) {
  return question.type === "boolean"
    ? { ...question, type: "noul" as const }
    : question;
}

function toAnswer(
  answer: z.infer<typeof decisionResponseSchema>["answers"][string],
): DecisionModelAnswer {
  switch (answer.type) {
    case "noul":
      return { type: "boolean", probability: answer.noul };
    case "choice":
      return {
        type: "choice",
        choice: answer.choice,
        probabilities: answer.probabilities,
        confidence: answer.confidence ?? null,
      };
    case "score":
      return {
        type: "score",
        score: answer.score,
        probabilities: answer.probabilities,
        confidence: answer.confidence ?? null,
      };
  }
}

export function createTypeSafeDecisionModelClient(params: {
  apiKey: string;
  model: string;
  baseURL?: string | null;
  fetchImpl?: typeof fetch;
}): DecisionModelClient {
  const baseURL = withoutTrailingSlash(params.baseURL ?? DEFAULT_BASE_URL);
  const doFetch = params.fetchImpl ?? fetch;
  // HTTPS_PROXY is the same variable the LLM-judge path honours, so one setting
  // covers every outbound LLM call in the worker. Read per client (not at module
  // load) so a test or a one-off script can set it before constructing the client.
  const proxyUrl = env.HTTPS_PROXY;
  const proxyDispatcher: Dispatcher | undefined = proxyUrl
    ? new ProxyAgent(proxyUrl)
    : undefined;

  return {
    evaluate: async (
      request: DecisionModelRequest,
    ): Promise<DecisionModelEvaluation> => {
      // `dispatcher` is undici's fetch extension and is not part of RequestInit.
      const init: RequestInit & { dispatcher?: Dispatcher } = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${params.apiKey}`,
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify({
          model: params.model,
          // The provider expects the state object itself (upstream's SDK wraps a
          // lone json part back into the same object before sending it).
          state: request.state,
          questions: Object.fromEntries(
            Object.entries(request.questions).map(([id, question]) => [
              id,
              toWireQuestion(question),
            ]),
          ),
        }),
        ...(proxyDispatcher ? { dispatcher: proxyDispatcher } : {}),
      };
      const response = await doFetch(`${baseURL}${DECISION_PATH}`, init);

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `TypeSafe decision model request failed (${response.status})${
            detail ? `: ${detail.slice(0, 500)}` : ""
          }`,
        );
      }

      const parsed = decisionResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error(
          `TypeSafe decision model returned an unexpected response: ${parsed.error.message}`,
        );
      }

      return {
        model: parsed.data.model ?? params.model,
        answers: Object.fromEntries(
          Object.entries(parsed.data.answers).map(([id, answer]) => [
            id,
            toAnswer(answer),
          ]),
        ),
        usage: parsed.data.usage
          ? {
              inputTokens: parsed.data.usage.input_tokens ?? null,
              outputTokens: parsed.data.usage.output_tokens ?? null,
            }
          : null,
      };
    },
  };
}

import { EvaluatorBlockReason } from "@prisma/client";

const LLMCompletionErrorName = "LLMCompletionError";

const BLOCK_REASON_PATTERNS = [
  {
    pattern: "Model use case details have not been submitted for this account",
    blockReason: EvaluatorBlockReason.PROVIDER_ACCOUNT_NOT_READY,
  },
] as const;

export function inferLLMCompletionBlockReason(params: {
  responseStatusCode: number;
  message: string;
}): EvaluatorBlockReason | null {
  if (params.responseStatusCode === 401) {
    return EvaluatorBlockReason.LLM_CONNECTION_AUTH_INVALID;
  }

  if (params.responseStatusCode === 404) {
    return EvaluatorBlockReason.EVAL_MODEL_UNAVAILABLE;
  }

  const reasonByMessage = BLOCK_REASON_PATTERNS.find((entry) =>
    params.message.includes(entry.pattern),
  );

  return reasonByMessage?.blockReason ?? null;
}

export class LLMCompletionError extends Error {
  responseStatusCode: number;
  isRetryable: boolean;
  blockReason: EvaluatorBlockReason | null;

  constructor(params: {
    message: string;
    responseStatusCode?: number;
    isRetryable?: boolean;
  }) {
    super(params.message);

    this.name = LLMCompletionErrorName;
    this.responseStatusCode = params.responseStatusCode ?? 500;
    this.isRetryable = params.isRetryable ?? false; // Default to false - be explicit about retryability
    this.blockReason = inferLLMCompletionBlockReason({
      responseStatusCode: this.responseStatusCode,
      message: this.message,
    });

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this);
    }
  }

  shouldBlockConfig(): boolean {
    return this.blockReason !== null;
  }

  getEvaluatorBlockReason(): EvaluatorBlockReason | null {
    return this.blockReason;
  }
}

export function isLLMCompletionError(e: any): e is LLMCompletionError {
  return e instanceof Error && e.name === LLMCompletionErrorName;
}

// --- Copied from upstream server/llm/errors.ts ---
const LLM_VALIDATION_ERROR_MARKER = Symbol.for(
  "litefuse.error.LLMValidationError",
);

export type LLMValidationErrorCode =
  | "invalid-connection"
  | "invalid-request"
  | "endpoint-unreachable";

/**
 * A deterministic validation failure owned by Litefuse, before or around the
 * provider call. Provider failures remain native AI SDK errors.
 */
export class LLMValidationError extends Error {
  private readonly [LLM_VALIDATION_ERROR_MARKER] = true;

  readonly code: LLMValidationErrorCode;
  readonly statusCode = 400;

  constructor(params: {
    code: LLMValidationErrorCode;
    message: string;
    cause?: unknown;
  }) {
    super(params.message, { cause: params.cause });
    this.name = "LLMValidationError";
    this.code = params.code;
  }

  static isInstance(error: unknown): error is LLMValidationError {
    return (
      error !== null &&
      typeof error === "object" &&
      LLM_VALIDATION_ERROR_MARKER in error &&
      (error as Record<symbol, unknown>)[LLM_VALIDATION_ERROR_MARKER] === true
    );
  }
}

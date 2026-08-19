/**
 * The provider boundary (spec 11.3, K-5).
 *
 * "CopilotPatch sözleşmesi ve lib/ai/adapter.ts sağlayıcıdan bağımsız yazılır."
 * Nothing above this line knows which company answers the call, and nothing
 * below it knows what a Song is.
 *
 * The ceilings of spec 11.3 are enforced *here*, on the request object, not in
 * the prompt. Asking a model politely to be brief is not a limit; refusing to
 * send an oversized request and naming a hard `maxOutputTokens` on the wire is.
 *
 * `usage` is nullable on purpose and the nullability carries meaning: `null`
 * means the call may have been billed but the real token counts could not be
 * read back. Spec 12.3 treats that case as fully spent, so it must never be
 * quietly coerced to zero.
 */

export type AdapterUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type AdapterRequest = {
  /** Model identity, chosen by the router, never by the adapter. */
  model: string;
  /** Fixed, cacheable blocks, in prefix order (spec 11.5). */
  system: readonly string[];
  /** The variable block; always last. */
  userMessage: string;
  /**
   * Hard ceiling sent to the provider as a request parameter. Required: an
   * adapter call without one is a programming error, not a default.
   */
  maxOutputTokens: number;
  /** What the caller measured before the call, for the input ceiling. */
  estimatedInputTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
};

export type AdapterFailureKind =
  | "timeout"
  | "network"
  | "aborted"
  | "provider_error";

export type AdapterResult =
  | {
      ok: true;
      /** Raw text. Nothing may use it before it has been parsed. */
      raw: string;
      /** null when the provider gave no verifiable usage (spec 12.3). */
      usage: AdapterUsage | null;
      /** Why usage is missing, for metering. Server-side only. */
      usageUnverifiedReason?: string;
    }
  | {
      ok: false;
      kind: AdapterFailureKind;
      /** Provider wording. Server-side only; never sent to a client. */
      diagnostic?: string;
    };

export type Adapter = {
  /** Stable name for metering; not a model id. */
  readonly id: string;
  call(request: AdapterRequest): Promise<AdapterResult>;
};

export type TokenCeilings = {
  maxInputTokens: number;
  maxOutputTokens: number;
};

export type CeilingViolation =
  | { kind: "input_too_large"; estimated: number; ceiling: number }
  | { kind: "output_ceiling_missing" }
  | { kind: "output_ceiling_too_high"; requested: number; ceiling: number };

/**
 * The check spec 11.3 demands, expressed once so both the adapter wrapper and
 * the pipeline's preflight can use the same answer.
 */
export function checkCeilings(
  request: AdapterRequest,
  ceilings: TokenCeilings,
): CeilingViolation | null {
  if (request.estimatedInputTokens > ceilings.maxInputTokens) {
    return {
      kind: "input_too_large",
      estimated: request.estimatedInputTokens,
      ceiling: ceilings.maxInputTokens,
    };
  }
  if (
    !Number.isFinite(request.maxOutputTokens) ||
    request.maxOutputTokens <= 0
  ) {
    return { kind: "output_ceiling_missing" };
  }
  if (request.maxOutputTokens > ceilings.maxOutputTokens) {
    return {
      kind: "output_ceiling_too_high",
      requested: request.maxOutputTokens,
      ceiling: ceilings.maxOutputTokens,
    };
  }
  return null;
}

export class CeilingError extends Error {
  constructor(readonly violation: CeilingViolation) {
    super(`adapter ceiling violated: ${violation.kind}`);
    this.name = "CeilingError";
  }
}

/**
 * Wraps any adapter so the ceilings are enforced before the provider is
 * reached. An oversized input never becomes a request, and a call without a
 * declared output ceiling never leaves the process.
 */
export function withCeilings(
  adapter: Adapter,
  ceilings: TokenCeilings,
): Adapter {
  return {
    id: adapter.id,
    async call(request) {
      const violation = checkCeilings(request, ceilings);
      if (violation) throw new CeilingError(violation);
      return adapter.call(request);
    },
  };
}

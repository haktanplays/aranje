/**
 * Stable machine-readable failure codes for /api/copilot.
 *
 * Two separate things travel under one name here, and keeping them apart is
 * the point of this file:
 *
 * - the **safe message**, which the client is allowed to see and which is
 *   written for a musician, and
 * - the **diagnostic**, which stays on the server and may quote the provider,
 *   a stack, a key name or a counter value.
 *
 * `toResponseFailure` is the only way a failure crosses to the client, and it
 * drops the diagnostic on the way out. Nothing else may serialise a failure.
 */

export const COPILOT_ERROR_CODES = [
  /** The request body did not match the contract. */
  "invalid_request",
  /** The song in the request is not a valid Song (spec 5). */
  "song_invalid",
  /** Estimated prompt size is over ARANJE_MAX_INPUT_TOKENS (spec 11.3). */
  "input_too_large",
  /** Server configuration is missing or unusable; nothing is attempted. */
  "config_missing",
  /** worstCaseReservation > daily budget (spec 12.3): every request fails. */
  "budget_invariant_violated",
  /** The counter store could not be reached; fail closed (spec 12.3). */
  "kv_unavailable",
  /** This subject used its free patches for the day (spec 12.1). */
  "quota_exhausted",
  /** The daily or monthly budget cannot cover another reservation. */
  "budget_exhausted",
  /** One AI patch per subject at a time (spec 12.4). */
  "concurrent_request",
  /** Same idempotency key, different payload. */
  "idempotency_conflict",
  /** No provider adapter is wired in this build. */
  "provider_unavailable",
  /** The provider did not answer in time. */
  "provider_timeout",
  /** The provider answered with an error. */
  "provider_error",
  /** The caller went away before the answer was ready. */
  "request_aborted",
  /** The provider's answer was not a valid patch. */
  "provider_output_invalid",
  /** The patch changes more bars than one patch may (spec 10.1). */
  "patch_too_large",
  /** The patch still fails validation after the correction rounds. */
  "patch_invalid",
  /** Anything unforeseen. The client is told nothing else. */
  "internal_error",
] as const;

export type CopilotErrorCode = (typeof COPILOT_ERROR_CODES)[number];

/** What the client may read. Written once, per code, in the reader's language. */
const SAFE_MESSAGES: Readonly<Record<CopilotErrorCode, string>> = {
  invalid_request: "İstek biçimi tanınmadı.",
  song_invalid: "Gönderilen şarkı geçerli değil.",
  input_too_large: "Gönderilen bağlam bu istek için fazla büyük.",
  config_missing: "AI şu anda yapılandırılmadığı için kapalı.",
  budget_invariant_violated: "AI güvenlik ayarı nedeniyle kapalı.",
  kv_unavailable: "AI şu anda kullanılamıyor, lütfen sonra deneyin.",
  quota_exhausted: "Bugünlük AI hakkın doldu. Çalma ve düzenleme açık.",
  budget_exhausted: "AI bütçesi bugünlük doldu. Çalma ve düzenleme açık.",
  concurrent_request: "Önceki AI isteğin hâlâ sürüyor.",
  idempotency_conflict: "Aynı istek anahtarı farklı bir içerikle kullanıldı.",
  provider_unavailable: "AI sağlayıcısı bu sürümde bağlı değil.",
  provider_timeout: "AI zamanında cevap vermedi.",
  provider_error: "AI isteği tamamlanamadı.",
  request_aborted: "İstek iptal edildi.",
  provider_output_invalid: "AI beklenen biçimde bir öneri üretemedi.",
  patch_too_large: "Öneri tek seferde değiştirilebilecekten fazla bar içeriyor.",
  patch_invalid: "Öneri kontrollerden geçmedi.",
  internal_error: "Beklenmeyen bir hata oluştu.",
} as const;

export type CopilotFailure = {
  code: CopilotErrorCode;
  /** Server-side only. Never serialised to the client. */
  diagnostic?: string;
};

export type ResponseFailure = {
  code: CopilotErrorCode;
  message: string;
};

export function failure(
  code: CopilotErrorCode,
  diagnostic?: string,
): CopilotFailure {
  return diagnostic === undefined ? { code } : { code, diagnostic };
}

export function safeMessage(code: CopilotErrorCode): string {
  return SAFE_MESSAGES[code];
}

/** The only door a failure may leave the server through. */
export function toResponseFailure(value: CopilotFailure): ResponseFailure {
  return { code: value.code, message: safeMessage(value.code) };
}

/** HTTP status for a code. Kept beside the codes so the two cannot drift. */
export function httpStatusFor(code: CopilotErrorCode): number {
  switch (code) {
    case "invalid_request":
    case "song_invalid":
    case "input_too_large":
      return 400;
    case "idempotency_conflict":
      return 409;
    case "quota_exhausted":
    case "budget_exhausted":
    case "concurrent_request":
      return 429;
    case "request_aborted":
      return 499;
    case "provider_timeout":
      return 504;
    case "config_missing":
    case "budget_invariant_violated":
    case "kv_unavailable":
    case "provider_unavailable":
      return 503;
    case "provider_error":
    case "provider_output_invalid":
    case "patch_too_large":
    case "patch_invalid":
    case "internal_error":
      return 502;
  }
}

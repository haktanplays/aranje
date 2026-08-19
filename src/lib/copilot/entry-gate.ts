/**
 * The phase 2 entry gate (spec 14.5, K-16).
 *
 * Spec 14.5 lists the two conditions that must hold before phase 2 may start:
 * concrete adapter token ceilings, and `worstCaseReservation <= daily budget`
 * proven by a unit test. Spec 12.3 adds that the invariant is checked at
 * backend start-up as well, and that the test may not be switched off.
 *
 * This module is that check, and it is written to be run twice: once by the
 * unit test, and once by the request path, so a deployment whose environment
 * drifts after the test was written still fails closed rather than quietly
 * spending. A gate that only ran in CI would be a decoration.
 *
 * Failing closed here means: no request is accepted, the reason is a stable
 * code, and the fix is named. It never means "carry on without the limit".
 */
import { checkStartupInvariant, type InvariantResult } from "@/lib/budget/cost";
import { priceFor } from "@/lib/budget/pricing";
import type { CopilotConfig } from "@/lib/config/copilot";
import type { CopilotErrorCode } from "@/lib/copilot/errors";
import { SONG_VALIDATORS } from "@/lib/validators";
import { validateRange } from "@/lib/validators/range";
import { validateStringCollision } from "@/lib/validators/stringCollision";

export type GateFailure = {
  code: CopilotErrorCode;
  /** Server-side reasons, one per unmet condition. */
  reasons: string[];
};

export type GateResult =
  | { ok: true; invariant: Extract<InvariantResult, { ok: true }> }
  | ({ ok: false } & GateFailure);

/** The two playability validators phase 2 may not start without. */
export function playabilityValidatorsPresent(): boolean {
  return (
    SONG_VALIDATORS.includes(validateRange) &&
    SONG_VALIDATORS.includes(validateStringCollision)
  );
}

export function checkPhase2EntryGate(config: CopilotConfig): GateResult {
  const reasons: string[] = [];

  if (!playabilityValidatorsPresent()) {
    reasons.push(
      "range ve stringCollision validator'lari merkezi zincirde degil (spec 10.1)",
    );
  }

  if (
    !Number.isInteger(config.maxInputTokens) ||
    config.maxInputTokens <= 0 ||
    !Number.isInteger(config.maxOutputTokens) ||
    config.maxOutputTokens <= 0
  ) {
    reasons.push(
      "ARANJE_MAX_INPUT_TOKENS / ARANJE_MAX_OUTPUT_TOKENS somut degil (spec 11.3)",
    );
  }

  // Spec 11.2/4: the dated cheap id has to be verified before the flag counts.
  if (config.enableCheapRouting && !config.cheapModelVerifiedAt) {
    reasons.push(
      "ARANJE_ENABLE_CHEAP_ROUTING acik ama ucuz model id'si dogrulanmamis (spec 11.2/4)",
    );
  }

  const price = priceFor(config.priceTable, config.modelDefault);
  if (!price) {
    reasons.push(
      `fiyat tablosunda "${config.modelDefault}" icin kayit yok (spec 12.4)`,
    );
    return { ok: false, code: "config_missing", reasons };
  }

  if (reasons.length > 0) {
    return { ok: false, code: "config_missing", reasons };
  }

  const invariant = checkStartupInvariant(
    { maxInputTokens: config.maxInputTokens, maxOutputTokens: config.maxOutputTokens },
    price,
    config.dailyBudgetUsd,
  );

  if (!invariant.ok) {
    return {
      ok: false,
      code: "budget_invariant_violated",
      reasons: [
        `worstCaseReservation ${invariant.worstCaseMicros} mikro-USD > ` +
          `gunluk butce ${invariant.dailyBudgetMicros} mikro-USD. ` +
          invariant.remedy,
      ],
    };
  }

  return { ok: true, invariant };
}

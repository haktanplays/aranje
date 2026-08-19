/**
 * The single cost model (spec 18 and spec 12.3).
 *
 * Everything that needs a number in dollars comes through this file: the
 * pre-reservation ceiling, the reconciliation after a call, and the metering
 * row. One formula, one place, so the reservation and the bill cannot be
 * computed two different ways.
 *
 * Spec 18 is explicit that a patch costs the **sum of its rounds**, not the
 * round count times an average. Correction rounds carry different input and
 * different cache hits, so `patchCostMicros` takes a list and adds it up.
 *
 * Money is carried as whole micro-dollars. Reservation counters are read,
 * compared and written many times a day; integers keep that exact.
 */
import type { AdapterUsage } from "@/lib/ai/adapter";
import type { ModelPrice } from "@/lib/budget/pricing";

/** 1 USD = 1_000_000 micro-dollars. */
export const MICROS_PER_USD = 1_000_000;

export function usdToMicros(usd: number): number {
  return Math.round(usd * MICROS_PER_USD);
}

export function microsToUsd(micros: number): number {
  return micros / MICROS_PER_USD;
}

function perMillionToMicros(tokens: number, pricePerMTokUsd: number): number {
  return (tokens * pricePerMTokUsd * MICROS_PER_USD) / 1_000_000;
}

/** Spec 18's four-term request cost, in micro-dollars, rounded up. */
export function requestCostMicros(
  usage: AdapterUsage,
  price: ModelPrice,
): number {
  const total =
    perMillionToMicros(usage.inputTokens, price.inputPerMTokUsd) +
    perMillionToMicros(usage.cacheReadTokens, price.cacheReadPerMTokUsd) +
    perMillionToMicros(usage.cacheWriteTokens, price.cacheWritePerMTokUsd) +
    perMillionToMicros(usage.outputTokens, price.outputPerMTokUsd);
  // Rounded up so a rounding error can never favour spending.
  return Math.ceil(total);
}

/** Spec 18: the sum of the rounds actually made, never rounds x average. */
export function patchCostMicros(
  rounds: readonly { usage: AdapterUsage; price: ModelPrice }[],
): number {
  return rounds.reduce(
    (total, round) => total + requestCostMicros(round.usage, round.price),
    0,
  );
}

/**
 * The maximum number of model calls one patch may make: the first attempt plus
 * the two correction rounds spec 11.4 allows.
 */
export const MAX_ROUNDS = 3;

export type TokenCeilings = {
  maxInputTokens: number;
  maxOutputTokens: number;
};

/**
 * Spec 12.3, verbatim:
 *
 *   worstCaseReservation =
 *     3 x ( ARANJE_MAX_INPUT_TOKENS  x input price
 *         + ARANJE_MAX_OUTPUT_TOKENS x output price )
 *
 * Three rounds, no cache hit, the adapter's maximum tokens. Cache read and
 * write are deliberately absent: assuming a cache hit would lower the ceiling,
 * and the ceiling is a worst case.
 */
export function worstCaseReservationMicros(
  ceilings: TokenCeilings,
  price: ModelPrice,
): number {
  const perRound =
    perMillionToMicros(ceilings.maxInputTokens, price.inputPerMTokUsd) +
    perMillionToMicros(ceilings.maxOutputTokens, price.outputPerMTokUsd);
  return Math.ceil(MAX_ROUNDS * perRound);
}

export type InvariantResult =
  | { ok: true; worstCaseMicros: number; dailyBudgetMicros: number }
  | {
      ok: false;
      worstCaseMicros: number;
      dailyBudgetMicros: number;
      /** Said in the terms spec 12.3 offers as the only two fixes. */
      remedy: string;
    };

/**
 * Spec 12.3's starting invariant: `worstCaseReservation <= daily budget`.
 *
 * If it does not hold, the very first reservation of the day cannot fit, so
 * every request is refused and the system looks broken from outside rather
 * than merely expensive. Spec 12.3 allows exactly two fixes — lower
 * `ARANJE_MAX_OUTPUT_TOKENS` or raise the daily budget — and says the test may
 * not be switched off.
 */
export function checkStartupInvariant(
  ceilings: TokenCeilings,
  price: ModelPrice,
  dailyBudgetUsd: number,
): InvariantResult {
  const worstCaseMicros = worstCaseReservationMicros(ceilings, price);
  const dailyBudgetMicros = usdToMicros(dailyBudgetUsd);

  if (worstCaseMicros <= dailyBudgetMicros) {
    return { ok: true, worstCaseMicros, dailyBudgetMicros };
  }

  return {
    ok: false,
    worstCaseMicros,
    dailyBudgetMicros,
    remedy:
      "ARANJE_MAX_OUTPUT_TOKENS tavanini dusur veya " +
      "ARANJE_DAILY_AI_BUDGET_USD degerini yukselt (spec 12.3).",
  };
}

import { describe, expect, it } from "vitest";

import {
  MAX_ROUNDS,
  checkStartupInvariant,
  microsToUsd,
  patchCostMicros,
  requestCostMicros,
  usdToMicros,
  worstCaseReservationMicros,
} from "@/lib/budget/cost";
import { PLACEHOLDER_PRICE_TABLE } from "@/test/copilot-fixtures";

const PRICE = PLACEHOLDER_PRICE_TABLE.models["claude-sonnet-5"];
if (!PRICE) throw new Error("fixture price missing");

describe("cost model (spec 18)", () => {
  it("adds all four terms of the request cost", () => {
    // 1000 in, 200 out, 500 cache read, 100 cache write, at the fixture's
    // placeholder prices: 10 + 10 + 0.5 + 1.2 micro-dollars per thousand.
    const cost = requestCostMicros(
      {
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadTokens: 500,
        cacheWriteTokens: 100,
      },
      PRICE,
    );
    const expected =
      (1000 * 10 + 200 * 50 + 500 * 1 + 100 * 12) / 1_000_000 * 1_000_000;
    expect(cost).toBe(Math.ceil(expected));
  });

  it("rounds a request up, so rounding never favours spending", () => {
    // Half a micro-dollar of input becomes a whole one.
    const cheap = { ...PRICE, inputPerMTokUsd: 0.5 };
    const cost = requestCostMicros(
      { inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      cheap,
    );
    expect(cost).toBe(1);
  });

  it("sums the rounds instead of multiplying an average (spec 18)", () => {
    const rounds = [
      {
        usage: { inputTokens: 1000, outputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0 },
        price: PRICE,
      },
      {
        // A correction round: more input, cheaper cache reads, less output.
        usage: { inputTokens: 200, outputTokens: 100, cacheReadTokens: 1800, cacheWriteTokens: 0 },
        price: PRICE,
      },
    ];

    const summed = patchCostMicros(rounds);
    const perRound = rounds.map((round) => requestCostMicros(round.usage, round.price));
    expect(summed).toBe((perRound[0] ?? 0) + (perRound[1] ?? 0));

    // The rounds really do differ, so "rounds x average" would be a different
    // number and not merely a different phrasing.
    expect(perRound[0]).not.toBe(perRound[1]);
    const roundsTimesFirst = rounds.length * (perRound[0] ?? 0);
    expect(summed).not.toBe(roundsTimesFirst);
  });

  it("reserves three rounds of the adapter's maximum tokens (spec 12.3)", () => {
    const ceilings = { maxInputTokens: 8000, maxOutputTokens: 4000 };
    const worst = worstCaseReservationMicros(ceilings, PRICE);
    // 8000 tokens at 10 USD/MTok is 80000 micro-dollars; 4000 at 50 is 200000.
    const perRoundMicros = 80_000 + 200_000;
    expect(MAX_ROUNDS).toBe(3);
    expect(worst).toBe(3 * perRoundMicros);
  });

  it("assumes no cache hit in the worst case", () => {
    const ceilings = { maxInputTokens: 8000, maxOutputTokens: 4000 };
    const cheapCache = { ...PRICE, cacheReadPerMTokUsd: 0, cacheWritePerMTokUsd: 0 };
    // Cache prices do not enter the formula at all, so zeroing them changes
    // nothing: the reservation is priced as if every token were fresh.
    expect(worstCaseReservationMicros(ceilings, cheapCache)).toBe(
      worstCaseReservationMicros(ceilings, PRICE),
    );
  });

  it("converts dollars and micro-dollars without drift", () => {
    expect(usdToMicros(2)).toBe(2_000_000);
    expect(microsToUsd(2_000_000)).toBe(2);
    expect(usdToMicros(0.000001)).toBe(1);
  });
});

describe("startup invariant (spec 12.3, K-16)", () => {
  const ceilings = { maxInputTokens: 8000, maxOutputTokens: 4000 };

  it("holds for the configured ceilings and the pilot daily budget", () => {
    const result = checkStartupInvariant(ceilings, PRICE, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.worstCaseMicros).toBeLessThanOrEqual(result.dailyBudgetMicros);
  });

  it("fails when the output ceiling is raised past what the budget covers", () => {
    const result = checkStartupInvariant(
      { maxInputTokens: 8000, maxOutputTokens: 40_000 },
      PRICE,
      2,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.worstCaseMicros).toBeGreaterThan(result.dailyBudgetMicros);
    // Spec 12.3 offers exactly two fixes, and switching the test off is not
    // one of them.
    expect(result.remedy).toContain("ARANJE_MAX_OUTPUT_TOKENS");
    expect(result.remedy).toContain("ARANJE_DAILY_AI_BUDGET_USD");
  });

  it("holds again once the ceiling is lowered", () => {
    const tooBig = checkStartupInvariant(
      { maxInputTokens: 8000, maxOutputTokens: 40_000 },
      PRICE,
      2,
    );
    expect(tooBig.ok).toBe(false);
    const lowered = checkStartupInvariant(
      { maxInputTokens: 8000, maxOutputTokens: 4000 },
      PRICE,
      2,
    );
    expect(lowered.ok).toBe(true);
  });

  it("holds again once the daily budget is raised", () => {
    const raised = checkStartupInvariant(
      { maxInputTokens: 8000, maxOutputTokens: 40_000 },
      PRICE,
      20,
    );
    expect(raised.ok).toBe(true);
  });

  it("treats an exact fit as passing", () => {
    const worst = worstCaseReservationMicros(ceilings, PRICE);
    const exact = checkStartupInvariant(ceilings, PRICE, microsToUsd(worst));
    expect(exact.ok).toBe(true);
  });
});

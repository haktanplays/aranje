import { describe, expect, it } from "vitest";

import {
  DEFAULT_DAILY_BUDGET_USD,
  DEFAULT_FREE_PATCHES_PER_DAY,
  DEFAULT_MAX_INPUT_TOKENS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_MODEL,
  DEFAULT_MODEL_CHEAP,
  DEFAULT_MONTHLY_BUDGET_USD,
  loadCopilotConfig,
} from "@/lib/config/copilot";
import { PLACEHOLDER_PRICE_TABLE } from "@/test/copilot-fixtures";

const PRICES = JSON.stringify(PLACEHOLDER_PRICE_TABLE);

describe("backend configuration (spec 11.2, 11.3, 12.1)", () => {
  it("uses the values spec 11.2 and 12.1 print as defaults", () => {
    const result = loadCopilotConfig({ ARANJE_PRICE_TABLE: PRICES });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.config.modelDefault).toBe(DEFAULT_MODEL);
    expect(result.config.modelCheap).toBe(DEFAULT_MODEL_CHEAP);
    expect(result.config.modelEscalation).toBe("");
    expect(result.config.dailyBudgetUsd).toBe(DEFAULT_DAILY_BUDGET_USD);
    expect(result.config.monthlyBudgetUsd).toBe(DEFAULT_MONTHLY_BUDGET_USD);
    expect(result.config.freePatchesPerUserPerDay).toBe(
      DEFAULT_FREE_PATCHES_PER_DAY,
    );
  });

  it("keeps cheap routing off unless the flag is literally true", () => {
    for (const value of [undefined, "", "false", "1", "yes", "TRUE"]) {
      const result = loadCopilotConfig({
        ARANJE_PRICE_TABLE: PRICES,
        ...(value === undefined ? {} : { ARANJE_ENABLE_CHEAP_ROUTING: value }),
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.config.enableCheapRouting).toBe(false);
    }

    const enabled = loadCopilotConfig({
      ARANJE_PRICE_TABLE: PRICES,
      ARANJE_ENABLE_CHEAP_ROUTING: "true",
    });
    expect(enabled.ok && enabled.config.enableCheapRouting).toBe(true);
  });

  it("carries concrete token ceilings (spec 11.3, phase 2 entry)", () => {
    const result = loadCopilotConfig({ ARANJE_PRICE_TABLE: PRICES });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.maxInputTokens).toBe(DEFAULT_MAX_INPUT_TOKENS);
    expect(result.config.maxOutputTokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    expect(Number.isInteger(result.config.maxInputTokens)).toBe(true);
    expect(result.config.maxInputTokens).toBeGreaterThan(0);
    expect(result.config.maxOutputTokens).toBeGreaterThan(0);
  });

  it("refuses a build with no price configuration (spec 12.4)", () => {
    const result = loadCopilotConfig({});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((problem) => problem.field)).toContain(
      "ARANJE_PRICE_TABLE",
    );
  });

  it("refuses a price table that does not parse", () => {
    expect(loadCopilotConfig({ ARANJE_PRICE_TABLE: "{" }).ok).toBe(false);
    expect(
      loadCopilotConfig({ ARANJE_PRICE_TABLE: '{"version":"x"}' }).ok,
    ).toBe(false);
    // An unknown field in the price table is a misconfiguration, not a hint.
    expect(
      loadCopilotConfig({
        ARANJE_PRICE_TABLE: '{"version":"x","models":{},"discount":0.5}',
      }).ok,
    ).toBe(false);
  });

  it("refuses a token ceiling that is not a positive whole number", () => {
    for (const value of ["0", "-1", "3.5", "lots"]) {
      const result = loadCopilotConfig({
        ARANJE_PRICE_TABLE: PRICES,
        ARANJE_MAX_OUTPUT_TOKENS: value,
      });
      expect(result.ok).toBe(false);
    }
  });
});

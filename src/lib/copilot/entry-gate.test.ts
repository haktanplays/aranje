import { describe, expect, it } from "vitest";

import { checkPhase2EntryGate, playabilityValidatorsPresent } from "@/lib/copilot/entry-gate";
import { runValidators } from "@/lib/validators";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { testConfig } from "@/test/copilot-fixtures";

describe("phase 2 entry gate (spec 14.5, 12.3)", () => {
  it("finds range and stringCollision in the central chain", () => {
    expect(playabilityValidatorsPresent()).toBe(true);
  });

  it("runs the whole chain clean over the phase 1 fixture", () => {
    // The demo song is what phase 1 was accepted on; a green chain over it is
    // the code-level form of "phase 1 tests are green".
    expect(runValidators(SAMPLE_SONG)).toEqual([]);
  });

  it("passes with the configured ceilings and the pilot budget", () => {
    const result = checkPhase2EntryGate(testConfig());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invariant.worstCaseMicros).toBeLessThanOrEqual(
      result.invariant.dailyBudgetMicros,
    );
  });

  it("fails closed when the worst case does not fit the daily budget", () => {
    const result = checkPhase2EntryGate(
      testConfig({ maxOutputTokens: 40_000 }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("budget_invariant_violated");
    expect(result.reasons.join(" ")).toContain("ARANJE_MAX_OUTPUT_TOKENS");
  });

  it("fails closed when a token ceiling is not concrete", () => {
    const result = checkPhase2EntryGate(testConfig({ maxInputTokens: 0 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("config_missing");
  });

  it("fails closed when the default model has no price", () => {
    const result = checkPhase2EntryGate(
      testConfig({ modelDefault: "some-unpriced-model" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("config_missing");
  });

  it("fails closed when cheap routing is on with an unverified model id", () => {
    const result = checkPhase2EntryGate(
      testConfig({ enableCheapRouting: true }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reasons.join(" ")).toContain("dogrulanmamis");
  });

  it("accepts cheap routing once the dated id has been verified", () => {
    const result = checkPhase2EntryGate(
      testConfig({
        enableCheapRouting: true,
        cheapModelVerifiedAt: "2026-08-19T00:00:00Z",
      }),
    );
    expect(result.ok).toBe(true);
  });
});

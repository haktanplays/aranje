/**
 * The speed form, before it is a plan (2R-A §X, §IX).
 *
 * Two rules are being defended, and they pull in opposite directions on
 * purpose. A *field* has a range and its control stops at the end of it,
 * visibly. A *combination* — "get faster, from 100 to 80" — is refused by
 * name at apply, because each number in it is perfectly legal and only
 * together do they describe something that is not getting faster.
 */
import { describe, expect, it } from "vitest";

import {
  canStep,
  DRAFT_RANGES,
  draftPlan,
  openingDraft,
  stepDraft,
  type DraftField,
  type SpeedDraft,
} from "@/lib/practice/speed-draft";
import { practiceRateLimits, progressiveRateLimits } from "@/lib/limits";

const FIELDS: readonly DraftField[] = [
  "fromPercent",
  "toPercent",
  "incrementPercent",
  "repeatsPerStep",
];

describe("285. the form opens where the reader already is", () => {
  it("targets the speed the transport is at", () => {
    expect(openingDraft(100).toPercent).toBe(100);
    expect(openingDraft(85).toPercent).toBe(85);
  });

  it("starts four rungs below it, on rungs the manual control also has", () => {
    const draft = openingDraft(100);
    expect(draft.fromPercent).toBe(100 - 4 * practiceRateLimits.stepPercent);
    expect(draft.fromPercent % practiceRateLimits.stepPercent).toBe(0);
  });

  it("never opens below the slowest speed the app has", () => {
    const draft = openingDraft(practiceRateLimits.minPercent);
    expect(draft.fromPercent).toBe(practiceRateLimits.minPercent);
    expect(draft.toPercent).toBe(practiceRateLimits.minPercent);
  });

  it("never opens above the fastest one, whatever it is handed", () => {
    const draft = openingDraft(9_999);
    expect(draft.toPercent).toBe(practiceRateLimits.maxPercent);
  });

  it("opens on the smallest increment and the default repeat count", () => {
    const draft = openingDraft(100);
    expect(draft.incrementPercent).toBe(progressiveRateLimits.minIncrementPercent);
    expect(draft.repeatsPerStep).toBe(progressiveRateLimits.defaultRepeatsPerStep);
  });
});

describe("286. a control stops at its own end rather than pretending", () => {
  it("moves one rung at a time, and only the field asked for", () => {
    const draft = openingDraft(100);
    const next = stepDraft(draft, "fromPercent", 1);
    expect(next?.fromPercent).toBe(draft.fromPercent + practiceRateLimits.stepPercent);
    expect(next?.toPercent).toBe(draft.toPercent);
    expect(next?.incrementPercent).toBe(draft.incrementPercent);
    expect(next?.repeatsPerStep).toBe(draft.repeatsPerStep);
  });

  it("answers null at every field's floor and ceiling", () => {
    for (const field of FIELDS) {
      const range = DRAFT_RANGES[field];
      const atFloor = { ...openingDraft(100), [field]: range.min } as SpeedDraft;
      const atCeiling = { ...openingDraft(100), [field]: range.max } as SpeedDraft;
      expect(stepDraft(atFloor, field, -1), field).toBeNull();
      expect(stepDraft(atCeiling, field, 1), field).toBeNull();
      expect(canStep(atFloor, field, -1), field).toBe(false);
      expect(canStep(atCeiling, field, 1), field).toBe(false);
      // And the other direction still works, or the control is simply dead.
      expect(canStep(atFloor, field, 1), field).toBe(true);
      expect(canStep(atCeiling, field, -1), field).toBe(true);
    }
  });

  it("does not clamp: a refused press leaves the value exactly as it was", () => {
    /*
     * The distinction the sheet depends on. Clamping would return the same
     * number and look identical from inside a component, so nothing could
     * tell "already at the end" from "moved"; null says which.
     */
    const at = { ...openingDraft(100), repeatsPerStep: progressiveRateLimits.maxRepeatsPerStep };
    expect(stepDraft(at, "repeatsPerStep", 1)).toBeNull();
    expect(at.repeatsPerStep).toBe(progressiveRateLimits.maxRepeatsPerStep);
  });

  it("walks a field from one end to the other in whole rungs", () => {
    let draft: SpeedDraft = { ...openingDraft(100), incrementPercent: DRAFT_RANGES.incrementPercent.min };
    let presses = 0;
    for (;;) {
      const next = stepDraft(draft, "incrementPercent", 1);
      if (next === null) break;
      draft = next;
      presses += 1;
      expect(presses).toBeLessThan(100);
    }
    expect(draft.incrementPercent).toBe(DRAFT_RANGES.incrementPercent.max);
    expect(presses).toBe(
      (DRAFT_RANGES.incrementPercent.max - DRAFT_RANGES.incrementPercent.min) /
        DRAFT_RANGES.incrementPercent.step,
    );
  });

  it("keeps the repeat count whole, because passes are counted not measured", () => {
    let draft = { ...openingDraft(100), repeatsPerStep: 1 };
    for (let press = 0; press < 5; press += 1) {
      draft = stepDraft(draft, "repeatsPerStep", 1) ?? draft;
      expect(Number.isInteger(draft.repeatsPerStep)).toBe(true);
    }
    expect(draft.repeatsPerStep).toBe(6);
  });
});

describe("287. the combination is refused by name, never corrected", () => {
  it("accepts a form that describes getting faster", () => {
    const made = draftPlan(openingDraft(100));
    expect(made.ok).toBe(true);
    if (made.ok) {
      expect(made.plan.fromPercent).toBe(80);
      expect(made.plan.toPercent).toBe(100);
      expect(made.plan.stepPercent).toBe(progressiveRateLimits.minIncrementPercent);
    }
  });

  it("refuses a target below the start rather than swapping the two", () => {
    const made = draftPlan({ ...openingDraft(100), fromPercent: 120, toPercent: 90 });
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.reason).toBe("target_not_above_start");
  });

  it("refuses a target equal to the start: that is not getting faster", () => {
    const made = draftPlan({ ...openingDraft(100), fromPercent: 100, toPercent: 100 });
    expect(made.ok).toBe(false);
    if (!made.ok) expect(made.reason).toBe("target_not_above_start");
  });

  it("carries the reader's own increment and repeat count through unchanged", () => {
    const made = draftPlan({
      fromPercent: 60,
      toPercent: 140,
      incrementPercent: 25,
      repeatsPerStep: 7,
    });
    expect(made.ok).toBe(true);
    if (made.ok) {
      expect(made.plan.stepPercent).toBe(25);
      expect(made.plan.repeatsPerStep).toBe(7);
    }
  });

  it("every reachable form is one the plan accepts, except by combination", () => {
    /*
     * The two rules meeting. Walking each field across its whole range, the
     * only refusal that ever comes back is about the pair of speeds — never
     * an increment or a repeat count, because the controls cannot produce
     * one that is out of range.
     */
    for (const from of [50, 75, 100, 145]) {
      for (const to of [50, 75, 100, 150]) {
        for (const increment of [5, 15, 25]) {
          for (const repeats of [1, 2, 16]) {
            const made = draftPlan({
              fromPercent: from,
              toPercent: to,
              incrementPercent: increment,
              repeatsPerStep: repeats,
            });
            if (!made.ok) expect(made.reason).toBe("target_not_above_start");
            else expect(to).toBeGreaterThan(from);
          }
        }
      }
    }
  });
});

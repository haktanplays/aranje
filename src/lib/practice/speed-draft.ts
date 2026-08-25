/**
 * The four numbers behind "Kademeli", before they are a plan (2R-A §X).
 *
 * The sheet asks for a starting speed, a target, an increment and a repeat
 * count. This module holds what a half-filled form looks like and how each
 * control moves — arithmetic, so the sheet does none.
 *
 * ## Why a step can refuse to move
 *
 * Each field has a range, and `stepDraft` returns null at its ends rather
 * than clamping. A control that silently stops changing while the reader
 * keeps pressing it is a control that has stopped answering; the sheet
 * disables the button instead, so the limit is visible before it is hit.
 *
 * The *combination* is a different matter. "Target below start" is not a
 * field being out of range — each number is fine on its own — so it is
 * refused at apply, by name, through `progressivePlan` (§IX). Nothing here
 * corrects it.
 */
import { practiceRateLimits, progressiveRateLimits } from "@/lib/limits";
import {
  progressivePlan,
  type PlanResult,
} from "@/lib/practice/progressive-rate";

/** Which of the two things the speed control is doing. */
export type SpeedMode = "fixed" | "progressive";

export type SpeedDraft = {
  readonly fromPercent: number;
  readonly toPercent: number;
  readonly incrementPercent: number;
  readonly repeatsPerStep: number;
};

export type DraftField = keyof SpeedDraft;

/** One field's own range and rung. */
type Range = { readonly min: number; readonly max: number; readonly step: number };

export const DRAFT_RANGES: Readonly<Record<DraftField, Range>> = {
  fromPercent: {
    min: practiceRateLimits.minPercent,
    max: practiceRateLimits.maxPercent,
    step: practiceRateLimits.stepPercent,
  },
  toPercent: {
    min: practiceRateLimits.minPercent,
    max: practiceRateLimits.maxPercent,
    step: practiceRateLimits.stepPercent,
  },
  incrementPercent: {
    min: progressiveRateLimits.minIncrementPercent,
    max: progressiveRateLimits.maxIncrementPercent,
    step: practiceRateLimits.stepPercent,
  },
  repeatsPerStep: {
    min: progressiveRateLimits.minRepeatsPerStep,
    max: progressiveRateLimits.maxRepeatsPerStep,
    step: 1,
  },
};

/**
 * The form as it opens: four rungs below the reader's current speed, up to it.
 *
 * Derived from where the transport already is rather than from a constant, so
 * the sheet opens offering to climb to the speed the reader is actually
 * playing at instead of to a number from this file.
 */
export function openingDraft(currentPercent: number): SpeedDraft {
  const to = Math.min(
    practiceRateLimits.maxPercent,
    Math.max(practiceRateLimits.minPercent, currentPercent),
  );
  const from = Math.max(
    practiceRateLimits.minPercent,
    to - 4 * practiceRateLimits.stepPercent,
  );
  return {
    fromPercent: from,
    toPercent: to,
    incrementPercent: progressiveRateLimits.minIncrementPercent,
    repeatsPerStep: progressiveRateLimits.defaultRepeatsPerStep,
  };
}

/** One press of a control, or null when that field is already at its end. */
export function stepDraft(
  draft: SpeedDraft,
  field: DraftField,
  direction: 1 | -1,
): SpeedDraft | null {
  const range = DRAFT_RANGES[field];
  const next = draft[field] + direction * range.step;
  if (next < range.min || next > range.max) return null;
  return { ...draft, [field]: next };
}

/** Whether that press would do anything — what disables the button. */
export const canStep = (
  draft: SpeedDraft,
  field: DraftField,
  direction: 1 | -1,
): boolean => stepDraft(draft, field, direction) !== null;

/** The draft as a plan, or the named reason it is not one. */
export function draftPlan(draft: SpeedDraft): PlanResult {
  return progressivePlan(
    draft.fromPercent,
    draft.toPercent,
    draft.incrementPercent,
    draft.repeatsPerStep,
  );
}

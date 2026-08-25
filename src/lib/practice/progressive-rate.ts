/**
 * Getting faster, honestly (2R-A §12).
 *
 * The reader sets a starting speed, a target and a step, and the loop moves
 * one step closer to the target every time it comes round. That is the whole
 * of it, and the two things it deliberately is not are the reason this file
 * has a doc comment at all.
 *
 * ## It is not listening
 *
 * The app does not hear the reader play. There is no microphone, no onset
 * detection, no comparison of anything to anything. So the speed can only be
 * tied to something the app actually knows, and the only such thing is **how
 * many times the loop has come round**. A completed pass is a fact; "you
 * played that cleanly" is not, and the app must never imply it did.
 *
 * This is why the step is per *completed loop* rather than per minute or per
 * "success": a reader who stops after two passes has advanced two steps
 * because two passes happened, which is exactly as much as the tool can
 * claim.
 *
 * ## The reader's hand always wins
 *
 * Changing the speed by hand stops the automation. Not pauses it, not
 * overrides it for one pass — stops it, and says so:
 *
 *     Otomatik hızlandırma durdu.
 *
 * A control that quietly resumed on the next pass would be a tool arguing
 * with the person using it, and they would find out at the wrong moment.
 */
import { clampPercent } from "@/lib/audio/practice-rate";
import { practiceRateLimits, progressiveRateLimits } from "@/lib/limits";

/** What the reader said the loop should do to its speed. */
export type ProgressivePlan = {
  readonly fromPercent: number;
  readonly toPercent: number;
  /** How much faster each step makes it. Always positive. */
  readonly stepPercent: number;
  /**
   * How many completed passes a step waits for.
   *
   * One would be "faster every time round", which nobody practises to. The
   * default is two, and it is a *count of passes* — never a judgement about
   * them (§IX).
   */
  readonly repeatsPerStep: number;
};

export type ProgressiveState = {
  readonly plan: ProgressivePlan;
  /** The speed the next pass will play at. */
  readonly percent: number;
  /** Completed passes since the automation started. */
  readonly completedLoops: number;
  /** Completed passes since the last step. Resets to zero on each step. */
  readonly loopsAtThisSpeed: number;
  /**
   * Why the automation is no longer running, or null while it is.
   *
   * Named rather than a boolean: "the reader took over" and "it arrived" are
   * different things to say, and the sheet says different things about them.
   */
  readonly stopped: "reached_target" | "manual_change" | null;
};

/** The message the reader sees when their own hand stopped it (§12). */
export const AUTOMATION_STOPPED_MESSAGE = "Otomatik hızlandırma durdu.";

export const MIN_STEP_PERCENT = progressiveRateLimits.minIncrementPercent;

/** Why a plan was refused. Named, because each says something different. */
export type PlanRefusal =
  | "target_not_above_start"
  | "increment_out_of_range"
  | "repeats_out_of_range";

export type PlanResult =
  | { readonly ok: true; readonly plan: ProgressivePlan }
  | { readonly ok: false; readonly reason: PlanRefusal };

/**
 * A plan, or null when the numbers do not describe getting faster.
 *
 * Refused rather than corrected: a target below the start is a reader who
 * meant something else, and silently swapping the two would start a loop
 * doing the opposite of what the numbers on screen say.
 */
export function progressivePlan(
  fromPercent: number,
  toPercent: number,
  step: number = MIN_STEP_PERCENT,
  repeatsPerStep: number = progressiveRateLimits.defaultRepeatsPerStep,
): PlanResult {
  /*
   * The two ends are clamped to the rates the app allows, because a rate
   * outside them is not a thing the transport can be set to. The increment
   * and the repeat count are **refused** rather than clamped: those are the
   * reader's own numbers, and quietly changing one would start a loop doing
   * something other than what the sheet says.
   */
  const from = clampPercent(fromPercent);
  const to = clampPercent(toPercent);
  if (to <= from) return { ok: false, reason: "target_not_above_start" };
  if (
    !Number.isFinite(step) ||
    step < progressiveRateLimits.minIncrementPercent ||
    step > progressiveRateLimits.maxIncrementPercent
  ) {
    return { ok: false, reason: "increment_out_of_range" };
  }
  if (
    !Number.isInteger(repeatsPerStep) ||
    repeatsPerStep < progressiveRateLimits.minRepeatsPerStep ||
    repeatsPerStep > progressiveRateLimits.maxRepeatsPerStep
  ) {
    return { ok: false, reason: "repeats_out_of_range" };
  }
  return { ok: true, plan: { fromPercent: from, toPercent: to, stepPercent: step, repeatsPerStep } };
}

/** A plan that holds one speed: start and target are the same (§IX). */
export function fixedPlan(percent: number): ProgressivePlan {
  const at = clampPercent(percent);
  return {
    fromPercent: at,
    toPercent: at,
    stepPercent: progressiveRateLimits.minIncrementPercent,
    repeatsPerStep: progressiveRateLimits.defaultRepeatsPerStep,
  };
}

export function startProgressive(plan: ProgressivePlan): ProgressiveState {
  return {
    plan,
    percent: plan.fromPercent,
    completedLoops: 0,
    loopsAtThisSpeed: 0,
    // A plan that goes nowhere is already where it is going.
    stopped: plan.toPercent <= plan.fromPercent ? "reached_target" : null,
  };
}

/**
 * One completed pass of the loop.
 *
 * The *only* input that makes the speed move. It takes no measure of how the
 * pass went, because there is none to take.
 */
export function afterLoop(state: ProgressiveState): ProgressiveState {
  if (state.stopped !== null) return state;
  const completedLoops = state.completedLoops + 1;
  const atThisSpeed = state.loopsAtThisSpeed + 1;

  // Not enough passes yet: the speed holds and the counter moves.
  if (atThisSpeed < state.plan.repeatsPerStep) {
    return { ...state, completedLoops, loopsAtThisSpeed: atThisSpeed };
  }

  /*
   * The step, capped at the target rather than allowed past it. Rounded to
   * the same rung the manual control moves by, so every speed the automation
   * lands on is one the reader could also have chosen by hand — a ladder with
   * two sets of rungs would show as a number they cannot reproduce.
   */
  const raw = state.percent + state.plan.stepPercent;
  const rung = clampPercent(
    Math.round(raw / practiceRateLimits.stepPercent) * practiceRateLimits.stepPercent,
  );
  const next = Math.min(state.plan.toPercent, Math.max(rung, state.percent));

  if (next >= state.plan.toPercent) {
    return {
      ...state,
      percent: state.plan.toPercent,
      completedLoops,
      loopsAtThisSpeed: 0,
      stopped: "reached_target",
    };
  }
  return { ...state, percent: next, completedLoops, loopsAtThisSpeed: 0, stopped: null };
}

/**
 * The reader moved the speed themselves.
 *
 * Ends the automation at the speed they chose. There is no "resume": they
 * would have to say so again, which is the point.
 */
export function afterManualChange(
  state: ProgressiveState,
  percent: number,
): ProgressiveState {
  return {
    ...state,
    percent: clampPercent(percent),
    stopped: state.stopped ?? "manual_change",
  };
}

export const isRunning = (state: ProgressiveState | null): boolean =>
  state !== null && state.stopped === null;

/**
 * What to tell the reader about the automation, or null when there is nothing.
 *
 * Never a claim about their playing. "Sekiz tur" is how many times the loop
 * came round; it is not eight correct repetitions and does not say it is.
 */
export function progressiveNotice(state: ProgressiveState | null): string | null {
  if (state === null) return null;
  if (state.stopped === "manual_change") return AUTOMATION_STOPPED_MESSAGE;
  if (state.stopped === "reached_target") {
    return `Hedef hıza ulaşıldı: %${state.plan.toPercent}.`;
  }
  return `%${state.percent} — ${state.completedLoops} tur tamamlandı.`;
}

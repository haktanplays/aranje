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
import { clampPercent, stepPercent } from "@/lib/audio/practice-rate";
import { practiceRateLimits } from "@/lib/limits";

/** What the reader said the loop should do to its speed. */
export type ProgressivePlan = {
  readonly fromPercent: number;
  readonly toPercent: number;
  /** How much faster each completed pass makes it. Always positive. */
  readonly stepPercent: number;
};

export type ProgressiveState = {
  readonly plan: ProgressivePlan;
  /** The speed the next pass will play at. */
  readonly percent: number;
  /** Completed passes since the automation started. */
  readonly completedLoops: number;
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

export const MIN_STEP_PERCENT = practiceRateLimits.stepPercent;

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
): ProgressivePlan | null {
  const from = clampPercent(fromPercent);
  const to = clampPercent(toPercent);
  if (to <= from) return null;
  if (!Number.isFinite(step) || step < MIN_STEP_PERCENT) return null;
  return { fromPercent: from, toPercent: to, stepPercent: step };
}

export function startProgressive(plan: ProgressivePlan): ProgressiveState {
  return { plan, percent: plan.fromPercent, completedLoops: 0, stopped: null };
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
  /*
   * Stepped through the same helper the manual control uses, so the speeds
   * the automation lands on are speeds the reader could have chosen by hand.
   * A rate ladder with two sets of rungs would show as a number the manual
   * control cannot reproduce.
   */
  const next = Math.min(state.plan.toPercent, stepPercent(state.percent, 1));
  if (next >= state.plan.toPercent) {
    return {
      ...state,
      percent: state.plan.toPercent,
      completedLoops,
      stopped: "reached_target",
    };
  }
  return { ...state, percent: next, completedLoops, stopped: null };
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

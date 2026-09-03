/**
 * One pass of a looped selection, said once (2V-B.3 §4).
 *
 * ## The defect this exists to remove
 *
 * A selection carries its music by two different mechanisms, and before this
 * only one of them repeated:
 *
 * - Onsets **inside** the window are placed on the transport by
 *   `scheduleSong`. The transport owns the loop, so they come back on every
 *   wrap without anybody asking.
 * - A note that began **before** the window is not a transport event at all.
 *   It is a continuation: `activeVoicesAt` works out where it had got to and
 *   `expression.resumeAt` puts it back, once, against the audio clock.
 *
 * So the reader heard the tail of the held chord on the first pass and never
 * again. The wrap handler stopped the previous pass — correctly — and
 * scheduled nothing to replace what it had stopped.
 *
 * ## What this module is
 *
 * The answer to "what does one pass of this selection consist of", as a
 * value. First play, pause/resume and loop wrap all read it, so there is one
 * definition of the window's continuation semantics rather than three copies
 * that can drift. It is pure: no engine, no clock, no Tone.
 *
 * ## The asymmetric window, and why
 *
 * The continuation is computed against a window with the **lower bound
 * dropped** and the track filter kept. That asymmetry is the whole point: a
 * voice from before the selection's first tick is exactly what is being asked
 * for, while a voice from an instrument the reader did not select is music
 * they asked not to hear. The upper bound stays so a continuation cannot ring
 * past the end of the pass.
 */
import type { PlaybackWindow } from "@/lib/playback/selection-playback";

/** What one pass needs, beyond the events the transport already owns. */
export type SelectionIteration = {
  /**
   * Where the pass opens, in absolute ticks.
   *
   * Also the tick `activeVoicesAt` measures elapsed time against, which is
   * why it is the plan's start and never the transport's current position:
   * a wrap is a return to the beginning, not a resume from wherever the
   * playhead happened to be when the notification arrived.
   */
  readonly resumeTicks: number;
  /** The window the continuation is bounded by. */
  readonly window: PlaybackWindow;
  /**
   * Whether anything needs continuing at all.
   *
   * False for a selection that opens on an onset: the transport fires that
   * note itself, and a continuation for it would be a second attack on the
   * same string in the same instant.
   */
  readonly continues: boolean;
};

/** The shape of a selection this module can plan a pass of. */
export type IterablePlan = {
  readonly startTicks: number;
  readonly endTicks: number;
  readonly trackIds: readonly string[];
  /** How many notes were already sounding when the window opened. */
  readonly sustainCount: number;
};

/**
 * The window every continuation inside this selection is bounded by.
 *
 * One function, because there is one answer. First play, a wrap and a resume
 * after a pause are three moments in the *same* audition: if they disagreed
 * about which voices belong to it, the same held chord would be audible at
 * one of them and missing at another — which is exactly the report this batch
 * was opened on.
 */
export function selectionResumeWindow(plan: IterablePlan): PlaybackWindow {
  return {
    /* Zero is "no lower bound", not a position. */
    startTicks: 0,
    endTicks: plan.endTicks,
    trackIds: plan.trackIds,
  };
}

export function planSelectionIteration(plan: IterablePlan): SelectionIteration {
  return {
    resumeTicks: plan.startTicks,
    window: selectionResumeWindow(plan),
    continues: plan.sustainCount > 0,
  };
}

/**
 * Are two passes the same pass?
 *
 * The property the loop has to have, expressed as a comparison the tests can
 * make directly: whatever the audio clock said, pass one and pass four must
 * ask for the same tick, the same bounds and the same instruments.
 */
export function sameIteration(
  left: SelectionIteration,
  right: SelectionIteration,
): boolean {
  return (
    left.resumeTicks === right.resumeTicks &&
    left.continues === right.continues &&
    left.window.startTicks === right.window.startTicks &&
    left.window.endTicks === right.window.endTicks &&
    left.window.trackIds.length === right.window.trackIds.length &&
    left.window.trackIds.every((id, index) => id === right.window.trackIds[index])
  );
}

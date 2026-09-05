/**
 * A range of musical time, and what a copy of it holds (spec 5.4, 10, K-37).
 *
 * Session state, deliberately. A selection is where someone's finger is, not a
 * property of the piece: it is never written into the Song, never reaches the
 * fingerprint, and never travels to the Copilot. Reload the page and the music
 * is unchanged while the selection is gone, which is right for both.
 *
 * Distinct from `Selection` in `selection.ts`, which is the set of onsets a tap
 * has picked out. This is a *span of time*, measured in **ticks from the start
 * of its section** rather than in slot indices. Bars stopped sharing a grid in
 * 2H-A, so slot 8 is beat three of a 1/16 bar and beat two of a 1/32 one. An
 * index-based range would mean different music depending on which bar it began
 * in; a tick-based one means the same moment everywhere, and can cross bar
 * lines and grid changes without becoming ambiguous.
 *
 * V1 is one track inside one section. Cross-track and cross-section selection
 * are out of scope, so nothing here takes a list of tracks.
 */
import type { ClipboardSpan } from "@/lib/song/span-transform";
import type { NoteEvent } from "@/lib/song/schema";

export type TimeSelection = {
  readonly sectionId: string;
  readonly trackId: string;
  /** Inclusive, in ticks from the start of the section. */
  readonly startTicks: number;
  /** Exclusive. Equal to `startTicks` when the selection is empty. */
  readonly endTicks: number;
};

/**
 * One sounding event, positioned relative to the region that produced it.
 *
 * Ties are not carried as slots. A held note is one event with the total
 * length it sounds for, and its tie slots are rebuilt on whatever grid it
 * lands on — the only way a paste into a different resolution can be exact
 * rather than approximate.
 */
export type ClipboardEvent = {
  /** Ticks after the start of the copied region. */
  readonly offsetTicks: number;
  /** Total sounding length, onset and ties together. */
  readonly durationTicks: number;
  readonly notes: readonly NoteEvent[];
};

/**
 * A copied region.
 *
 * `widthTicks` is the whole width that was selected, not the span from the
 * first note to the last. Rests inside a pattern are part of the pattern, and
 * a trailing rest is what makes a one-bar riff repeat on the bar instead of
 * bunching up against the next copy.
 */
export type Clipboard = {
  readonly widthTicks: number;
  readonly events: readonly ClipboardEvent[];
  /**
   * Technique spans that lay over the region, positioned like the events.
   *
   * Optional so every clipboard written before spans existed still reads, and
   * so a copy that crossed no span carries no empty array. A span is clipped
   * to the region rather than carried whole: what was copied is what was
   * selected, and a palm mute that ran on past the selection did not.
   */
  readonly spans?: readonly ClipboardSpan[];
};

export const EMPTY_CLIPBOARD: Clipboard = { widthTicks: 0, events: [] };

/** Width of a region in ticks; never negative. */
export function selectionWidth(selection: TimeSelection): number {
  return Math.max(0, selection.endTicks - selection.startTicks);
}

export function isEmptySelection(selection: TimeSelection): boolean {
  return selectionWidth(selection) === 0;
}

/** The same region, moved in time. Start and end travel together. */
export function shiftSelection(
  selection: TimeSelection,
  deltaTicks: number,
): TimeSelection {
  return {
    ...selection,
    startTicks: selection.startTicks + deltaTicks,
    endTicks: selection.endTicks + deltaTicks,
  };
}

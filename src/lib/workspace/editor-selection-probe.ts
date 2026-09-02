/**
 * The editor's held selection, for the read-only measurement surface.
 *
 * ## Why this projection exists
 *
 * `use-debug-handle.ts` publishes what the *engine* is doing. Eight of the
 * acceptance round's thirteen steps ask the reader to do something the engine
 * never hears — draw a selection, reach it forward, open its actions — and
 * the harness had no fact about those at all. It filled the gap with "no
 * write happened", which is equally true of a step nobody has touched, and a
 * fresh session therefore reported every one of them satisfied on arrival.
 *
 * So the surface gains one more reading: whichever of the two selections is
 * held, in one shape, plus how many listening verbs are being offered on it.
 * Nothing is computed here that the workspace does not already know and
 * already draw; this only says it in a form something outside can read.
 *
 * A pure function rather than a hook, in its own file rather than in the
 * composition root, because it is a projection and because the root has three
 * lines of budget left.
 */
import { selectionOffers } from "@/lib/workspace/selection-verbs";
import type { SelectionSession } from "@/lib/workspace/use-selection-session";
import type { Song } from "@/lib/song/schema";

export type EditorSelectionReading = {
  readonly sectionId: string;
  readonly startTicks: number;
  readonly endTicks: number;
  readonly trackIds: string[];
  readonly listenVerbs: number;
};

export function editorSelectionProbe(
  session: SelectionSession,
  song: Song,
): EditorSelectionReading | null {
  const bars = session.bars.handle.selection;
  const time = session.time.handle.selection;
  /*
   * Counted from the capability model, which is what every surface draws its
   * listening buttons from — not from whether a selection exists, and not
   * from the edit-mode `coveredRun`. "The actions were revealed" is a claim
   * about what the reader could see and press; a selection whose run cannot
   * be heard has revealed nothing, and a reader in reading mode is still
   * being offered both verbs.
   */
  const listenVerbs = selectionOffers(song, session.time).filter(
    (offer) =>
      (offer.verb === "audition" || offer.verb === "loop_selection") &&
      offer.state.kind === "available",
  ).length;

  if (bars) {
    /*
     * Bar selections count in bars, and are reported in bars. The witness
     * only ever compares these numbers with each other — "did the end move
     * forward from the same start" — so the unit matters less than that it is
     * consistent, and converting to ticks here would invent a precision the
     * gesture does not have.
     */
    return {
      sectionId: bars.sectionId,
      startTicks: bars.startBarIndex,
      endTicks: bars.endBarIndex + 1,
      trackIds: bars.scope === "full" ? [] : [bars.trackId ?? ""],
      listenVerbs,
    };
  }
  if (!time) return null;
  return {
    sectionId: time.sectionId,
    startTicks: time.startTicks,
    endTicks: time.endTicks,
    trackIds: [time.trackId],
    listenVerbs,
  };
}

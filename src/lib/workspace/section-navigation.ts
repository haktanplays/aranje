/**
 * Which section the reader is looking at (spec 13.20 §3, 2N-A).
 *
 * Before this checkpoint there was no such thing. "Which section" was read off
 * `activeBarKey` — the bar the *transport* is on — so the stepper, the section
 * list and the tab were answering three different questions and calling them
 * one. The reproduction in `eval/tab/DEFECTS.json` measured it: pressing
 * "Sonraki bölüm: Ana Riff" scrolled the tab to Ana Riff while the stepper went
 * on saying Intro Riff, and after two jumps the section list had nothing
 * selected at all.
 *
 * So the viewed section is now a fact of its own, held here, and it is never
 * derived from the transport. **The section being looked at and the section
 * being played are two different things**, and a reader who steps away from
 * the playhead to read the chorus has not stopped the music.
 *
 * ## Following, and taking over
 *
 * There is one state, not two authorities:
 *
 * - `followsPlayback` starts true. While it is true the transport may carry
 *   the view along — that is what makes the tab scroll with the music.
 * - Choosing a section explicitly — the stepper, the list, the arrangement —
 *   **takes over**. From then on playback moves the music and not the view,
 *   until the reader points at a bar again.
 * - Tapping a bar is both: it seeks *and* it is a choice, so it hands the
 *   view back to the transport.
 *
 * That is why playback cannot produce a section change the reader did not ask
 * for.
 *
 * ## What 2Q-C removed
 *
 * There used to be a third rule here — the playhead is not drawn over music it
 * is not playing — and a `playheadBelongsHere` to decide it. It existed
 * because a surface drew one section, so a playhead two sections away had
 * nowhere honest to be and was hidden. Both reading surfaces now draw the
 * whole song on one axis, so the line is simply at the place the music is; if
 * the reader has scrolled elsewhere they do not see it, which is the truth
 * rather than a rule about the truth.
 *
 * Pure and total. Every event returns a complete state, and every state names
 * a section that exists in the song it was computed against — a stale id is a
 * section the reader cannot get back to.
 */

export type SectionView = {
  /** The section the whole surface answers for. Always a real section. */
  readonly viewedSectionId: string;
  /** True while the transport is still allowed to carry the view. */
  readonly followsPlayback: boolean;
};

export type SectionNavEvent =
  /** The stepper, the section list, the arrangement's section header. */
  | { readonly kind: "choose_section"; readonly sectionId: string }
  /** A bar was pointed at: a seek, and a return to following. */
  | { readonly kind: "open_bar"; readonly barKey: string }
  /** The transport moved. Carries the view only while it is being followed. */
  | { readonly kind: "playback_moved"; readonly barKey: string | null }
  /** A different song entirely: nothing about the old one is remembered. */
  | { readonly kind: "song_replaced" };

const sectionOf = (barKey: string): string => barKey.split(":")[0] ?? "";

/** The first section, which is where an unknown song is met. */
export function initialSectionView(sectionIds: readonly string[]): SectionView {
  return { viewedSectionId: sectionIds[0] ?? "", followsPlayback: true };
}

/**
 * The next view, given what happened.
 *
 * `sectionIds` is the song's own list, passed in rather than remembered, so a
 * section that has just been deleted cannot survive as the thing being looked
 * at. When the viewed section disappears the view falls back to the first one
 * — deterministic, and somewhere the reader can see.
 */
export function nextSectionView(
  current: SectionView,
  event: SectionNavEvent,
  sectionIds: readonly string[],
): SectionView {
  const settle = (view: SectionView): SectionView =>
    sectionIds.includes(view.viewedSectionId)
      ? view
      : { ...view, viewedSectionId: sectionIds[0] ?? "" };

  switch (event.kind) {
    case "choose_section":
      /*
       * An explicit choice takes over from the transport. Without this a
       * reader who stepped to the chorus during playback would be dragged
       * back to the verse by the next frame, which reads as the app refusing
       * to go where it was told.
       */
      return settle({ viewedSectionId: event.sectionId, followsPlayback: false });

    case "open_bar":
      // Pointing at a bar is a seek, so the view and the music are together
      // again and the transport may carry it from here.
      return settle({ viewedSectionId: sectionOf(event.barKey), followsPlayback: true });

    case "playback_moved":
      if (!current.followsPlayback || event.barKey === null) return settle(current);
      return settle({ ...current, viewedSectionId: sectionOf(event.barKey) });

    case "song_replaced":
      return initialSectionView(sectionIds);
  }
}

/** The step either side, for the stepper's two arrows. */
export function sectionNeighbours(
  sectionIds: readonly string[],
  viewedSectionId: string,
): { previous: string | null; next: string | null } {
  const index = sectionIds.indexOf(viewedSectionId);
  if (index < 0) return { previous: null, next: sectionIds[0] ?? null };
  return {
    previous: sectionIds[index - 1] ?? null,
    next: sectionIds[index + 1] ?? null,
  };
}

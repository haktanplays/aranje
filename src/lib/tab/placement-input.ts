/**
 * What the placement engine needs to know about a track (spec 9.2, K-19).
 *
 * The engine takes two lists: the struck chords in playing order, and which
 * bars the hand gets to itself. Deciding those two things is a reading of the
 * Faz 0 tie/carry semantics (spec 5.5), not part of the search, so it lives
 * here where it can be read and tested on its own.
 *
 * Three readings are worth naming, because each one is a place the engine
 * could quietly be given the wrong picture:
 *
 * - A tie (`"-"`) is not an onset. It is the same note still sounding, and
 *   counting it again would make the hand appear to re-fret what it is
 *   already holding.
 * - A bar filled by a held note is not silent. The hand is still on it, so it
 *   is not free to move.
 * - A bar the track is not written in is silent, and it also ends whatever was
 *   sounding: nothing carries across a bar the track does not appear in. The
 *   same goes for a bar that does not open with a tie — whatever was held
 *   stopped at the bar line.
 */
import type {
  PlacementBar,
  PlacementOnset,
  SlurEdge,
} from "@/lib/music/placement";
import { slotCount } from "@/lib/music/timing";
import type { Song } from "@/lib/song/schema";

export type TrackPlacementInput = {
  onsets: PlacementOnset[];
  bars: PlacementBar[];
  /**
   * Notes that must share a string because one is slurred off the other
   * (spec 8.5, 9.2, K-27).
   *
   * This is the same contiguity reading the rest of this file makes, and it
   * is made here for the same reason: whether two notes touch is a question
   * about ties and rests, not about fretboards. The search is told the answer
   * rather than working it out, so the placement engine, the expression
   * planner and the `articulationContext` validator cannot come to different
   * conclusions about which notes are joined.
   */
  slurs: SlurEdge[];
};

/** The articulations that are a claim about the note before them. */
const SLURRED = new Set(["slide", "hammer_on", "pull_off"]);

/**
 * The onsets and bars of one track.
 *
 * Onset keys are `sectionId:barIndex:slotIndex`, which is the tab timeline's
 * own bar key with the slot appended, so a caller maps a result straight back
 * onto its slots.
 */
export function trackPlacementInput(
  song: Song,
  trackId: string,
): TrackPlacementInput {
  const onsets: PlacementOnset[] = [];
  const bars: PlacementBar[] = [];
  const slurs: SlurEdge[] = [];
  let barNumber = 0;
  let sounding = false;

  /*
   * Slur contiguity is tracked separately from `sounding`, and on an absolute
   * slot index, because the two are different questions.
   *
   * `sounding` answers "is the hand still holding something through this
   * bar", which is what the silent-bar reset needs, and it deliberately
   * clears at a bar that does not open with a tie. A slur asks something
   * else: "was anything still ringing in the slot immediately before this
   * one" — and a note that fills the last slot of a bar is still ringing when
   * the next bar's first slot arrives, section line or not.
   *
   * Reusing `sounding` here got that wrong, and it got it wrong in the one
   * direction that matters: it silently declared no edge, so the search was
   * never told about a slur that `legatoLink` would go on to accept, and the
   * two disagreed again. This is the same reading `legatoLink` makes —
   * `previousEnd + 1 === start` — expressed on the same absolute grid.
   */
  let slotBase = 0;
  let previousOnset: number | null = null;
  /** Absolute index of the last slot the previous onset was still sounding in. */
  let previousEnd = -2;

  song.sections.forEach((section, sectionIndex) => {
    section.bars.forEach((bar, barIndex) => {
      barNumber += 1;
      const slots = bar.slots[trackId];

      if (slots === undefined) {
        // Not written here at all: silent, and nothing carries through it.
        sounding = false;
        bars.push({ barNumber, silent: true });
        // The bar still occupies its slots on the absolute grid, so anything
        // after it cannot be contiguous with anything before it.
        slotBase += slotCount(bar.timeSignature, bar.resolution);
        return;
      }

      let struck = false;
      // A note carries into a bar only when that bar opens with a tie. The tab
      // timeline reads the carry the same way, so the two never disagree about
      // whether a bar is free.
      const carriedThrough = sounding && slots[0] === "-";
      if (!carriedThrough) sounding = false;

      slots.forEach((slot, slotIndex) => {
        if (Array.isArray(slot)) return; // a drum slot; shape is a validator's
        if (slot === null) {
          sounding = false;
          return;
        }
        if (slot === "-") {
          // A tie is not a new onset; it extends the one still sounding.
          const abs = slotBase + slotIndex;
          if (previousEnd + 1 === abs) previousEnd = abs;
          return;
        }

        const abs = slotBase + slotIndex;
        const source = previousEnd + 1 === abs ? previousOnset : null;
        const index = onsets.length;

        struck = true;
        sounding = true;
        onsets.push({
          key: `${section.id}:${barIndex}:${slotIndex}`,
          sectionIndex,
          barIndex,
          slotIndex,
          barNumber,
          notes: slot.notes,
        });

        if (source !== null) {
          const before = onsets[source];
          slot.notes.forEach((note, targetNoteIndex) => {
            if (!SLURRED.has(note.articulation ?? "")) return;
            // The note it is slurred off is the one at the same written pitch
            // class of hand — in practice the source onset's own voice. With
            // one note there is no ambiguity; in a chord the first note is
            // the melodic voice the tab draws the mark against.
            const sourceNoteIndex = 0;
            if (!before || before.notes.length === 0) return;
            slurs.push({
              targetOnset: index,
              sourceOnset: source,
              targetNoteIndex,
              sourceNoteIndex,
            });
          });
        }

        previousOnset = index;
        previousEnd = abs;
      });

      slotBase += slots.length;
      bars.push({ barNumber, silent: !struck && !carriedThrough });
    });
  });

  return { onsets, bars, slurs };
}

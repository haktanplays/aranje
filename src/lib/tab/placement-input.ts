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
import type { PlacementBar, PlacementOnset } from "@/lib/music/placement";
import type { Song } from "@/lib/song/schema";

export type TrackPlacementInput = {
  onsets: PlacementOnset[];
  bars: PlacementBar[];
};

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
  let barNumber = 0;
  let sounding = false;

  song.sections.forEach((section, sectionIndex) => {
    section.bars.forEach((bar, barIndex) => {
      barNumber += 1;
      const slots = bar.slots[trackId];

      if (slots === undefined) {
        // Not written here at all: silent, and nothing carries through it.
        sounding = false;
        bars.push({ barNumber, silent: true });
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
        if (slot === "-") return; // a tie is not a new onset
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
      });

      bars.push({ barNumber, silent: !struck && !carriedThrough });
    });
  });

  return { onsets, bars };
}

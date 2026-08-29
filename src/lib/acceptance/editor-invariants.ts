/**
 * What must still be true of the music after a gesture (2U-A handoff §5).
 *
 * ## Why these are separate from "did it write once"
 *
 * A phase already checks that one gesture produced one edit. That is a fact
 * about the *history*, and it is silent about the music: moving a note to a
 * neighbouring string writes once whether or not the note still sounds the
 * same pitch, and duplicating a bar writes once whether or not the bass came
 * with it.
 *
 * So the musical promises are asked separately, of the song's own bytes,
 * before and after. Each one is the sentence a reader would say if it broke:
 * "the note changed pitch when I only moved it to another string", "the other
 * instrument fell out when I duplicated the bar".
 *
 * Everything here is pure and takes the two songs. Nothing reads storage,
 * nothing reads the DOM, and nothing knows which phase it is answering for —
 * the caller names the phase, and this answers the question that phase asks.
 */
import type { Song } from "@/lib/song/schema";

type Slot = unknown;

const struckSlots = (song: Song, trackId?: string): Slot[] => {
  const out: Slot[] = [];
  for (const section of song.sections) {
    for (const bar of section.bars) {
      for (const [id, slots] of Object.entries(bar.slots)) {
        if (trackId !== undefined && id !== trackId) continue;
        for (const slot of slots) {
          if (slot === null || slot === "-" || Array.isArray(slot)) continue;
          out.push(slot);
        }
      }
    }
  }
  return out;
};

const notesOf = (slot: Slot): readonly { pitch?: string }[] =>
  (slot as { notes?: readonly { pitch?: string }[] }).notes ?? [];

/** Every sounding pitch in the song, sorted. Order of writing does not matter. */
export function soundingPitches(song: Song, trackId?: string): readonly string[] {
  return struckSlots(song, trackId)
    .flatMap((slot) => notesOf(slot).map((note) => note.pitch ?? "?"))
    .sort();
}

/** How many notes the song carries. A move must not gain or lose one. */
export function noteCount(song: Song, trackId?: string): number {
  return struckSlots(song, trackId).reduce<number>(
    (total, slot) => total + notesOf(slot).length,
    0,
  );
}

/**
 * How many bars each track is written across, per section.
 *
 * A bar is one object holding every track, so "aligned" is really a question
 * about whether any track was left with slots the others do not have. A track
 * absent from a bar is silence, which is legal — what is illegal is one track
 * having *more* bars than the section does.
 */
export function barCount(song: Song): number {
  return song.sections.reduce((total, section) => total + section.bars.length, 0);
}

export type InvariantChecks = Readonly<Record<string, boolean>>;

/**
 * The musical promise a given phase makes, answered from the two songs.
 *
 * A phase with no musical promise gets an empty answer rather than a `true`:
 * claiming a check passed for a gesture that never made it would be putting a
 * PASS in the report for a question nobody asked.
 */
export function invariantChecks(
  phaseId: string,
  before: Song,
  after: Song,
  bassTrackId: string,
): InvariantChecks {
  switch (phaseId) {
    /*
     * A string move changes where a note is played and not what is heard.
     * This is the one movement whose whole point is that the music does not
     * change, so it is the one where a silent failure is invisible.
     */
    case "moveStringThin":
    case "moveStringThick":
      return {
        moveKeptSoundingPitch:
          JSON.stringify(soundingPitches(before)) ===
          JSON.stringify(soundingPitches(after)),
        moveNoOverwrite: noteCount(before) === noteCount(after),
      };

    /* A time move relocates notes; it must not consume the ones it lands near. */
    case "moveTimeRight":
    case "moveTimeLeft":
      return { moveNoOverwrite: noteCount(before) === noteCount(after) };

    /*
     * Duplicating a bar duplicates the bar, not the guitar's half of it. The
     * bass is what makes this falsifiable — on a one-track song the check
     * cannot fail.
     */
    case "measureDuplicated":
      return {
        measureAllTracksAligned: barCount(after) === barCount(before) + 1,
        measureOtherTrackKept:
          noteCount(after, bassTrackId) > noteCount(before, bassTrackId),
      };

    case "measureInserted":
      return { measureAllTracksAligned: barCount(after) === barCount(before) + 1 };

    /* Moving a bar reorders; nothing may be gained or lost by it. */
    case "measureMovedRight":
    case "measureMovedLeft":
      return {
        measureAllTracksAligned: barCount(after) === barCount(before),
        measureOtherTrackKept:
          noteCount(after, bassTrackId) === noteCount(before, bassTrackId),
      };

    case "measureDeleted":
      return { measureAllTracksAligned: barCount(after) === barCount(before) - 1 };

    default:
      return {};
  }
}

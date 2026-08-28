/**
 * Which note values can be written here, and what to call them (2T-C §4).
 *
 * The rhythm tail draws written values; this is the other half — the reader
 * choosing one before writing. Both read the same vocabulary, so what is
 * offered and what is drawn cannot drift apart.
 *
 * ## What decides whether a value is offered
 *
 * Two questions, kept separate because they have different answers:
 *
 * - **Does it fit?** A value longer than the music left after this beat is
 *   greyed rather than hidden: a reader who wanted a whole note here should
 *   see that the bar is why they cannot have one.
 * - **Can this grid write it?** A sixteenth triplet is 32 ticks and a
 *   sixteenth slot is 48; nothing on a straight grid lands on it. Offering it
 *   would be offering a note that could be written and then never joined, so
 *   triplet values appear on triplet grids and not otherwise.
 *
 * The names are the reader's — "noktalı sekizlik", "sekizlik triole" — and
 * the tick count never appears. It is on the choice for anything that needs
 * to do arithmetic, which is not the reader.
 */
import { NOTE_VALUES, valueLabel, type NoteValue } from "@/lib/music/note-value";
import { isTripletGrid, slotCount, ticksPerSlot } from "@/lib/music/timing";
import { maxDurationTicks, type DurationTarget } from "@/lib/song/note-duration";
import type { Song } from "@/lib/song/schema";

export type RhythmChoice = {
  readonly value: NoteValue;
  /** "Noktalı sekizlik" — what the reader is offered. */
  readonly label: string;
  readonly ticks: number;
  /** False when the music left in this section is shorter than this. */
  readonly fits: boolean;
};

/** Where a rhythm value is being chosen: an onset, without a note yet. */
export type RhythmTarget = Omit<DurationTarget, "noteIndex">;

/** True when a grid can place an onset on this value's boundaries. */
export function gridCanWrite(value: NoteValue, resolution: number): boolean {
  const slot = ticksPerSlot(resolution as never);
  if (slot <= 0) return false;
  /*
   * A triplet value only lines up with a triplet grid, and a straight value
   * only with a straight one. Anything else writes a note whose end nothing
   * can start from.
   */
  if (value.modifier === "triplet") return isTripletGrid(resolution as never);
  if (isTripletGrid(resolution as never)) return value.ticks % slot === 0;
  return value.ticks % slot === 0 || slot % value.ticks === 0;
}

/**
 * The values on offer at one place, longest first.
 *
 * Longest first because that is how the vocabulary is ordered and how a
 * reader scans a list of durations — from "a whole bar" down to "as short as
 * it goes" — rather than alphabetically or by tick count ascending.
 */
export function rhythmChoices(
  song: Song,
  target: RhythmTarget,
): readonly RhythmChoice[] {
  const bar = song.sections
    .find((entry) => entry.id === target.sectionId)
    ?.bars[target.barIndex];
  if (!bar) return [];

  const room = maxDurationTicks(song, { ...target, noteIndex: 0 });
  /*
   * A value longer than the bar itself is not "greyed because you are late in
   * the bar" — it can never be written in this meter at all, and showing it
   * at the top of the list every time teaches nothing. Not fitting *here* is
   * worth saying; not fitting anywhere is worth leaving out.
   */
  const barTicks =
    slotCount(bar.timeSignature, bar.resolution) * ticksPerSlot(bar.resolution);

  return NOTE_VALUES.filter(
    (value) => value.ticks <= barTicks && gridCanWrite(value, bar.resolution),
  ).map(
    (value) => ({
      value,
      label: valueLabel(value),
      ticks: value.ticks,
      fits: value.ticks <= room,
    }),
  );
}

/**
 * What a fresh onset is worth on this grid: one step of it.
 *
 * The default has to be the thing the grid is already counting in, or every
 * note a reader writes without thinking about it would be a length they did
 * not choose.
 */
export function defaultRhythmTicks(song: Song, target: RhythmTarget): number {
  const bar = song.sections
    .find((entry) => entry.id === target.sectionId)
    ?.bars[target.barIndex];
  return bar ? ticksPerSlot(bar.resolution) : 0;
}

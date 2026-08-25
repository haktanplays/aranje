/**
 * Turning a cell the reader touched into a moment the command understands
 * (spec 13.22 §4, 2O-B).
 *
 * The tab speaks in bars, slots and strings; the chord command speaks in
 * ticks. This is the one translation between them, and it is pure: given the
 * song and the cell, it works out where that cell begins, how long one step
 * of that bar lasts, and whether anything is already struck there.
 *
 * Doing it here rather than in a component keeps two things out of the UI: the
 * tick arithmetic, which belongs to `music/timing`, and the judgement about
 * what "already has notes" means, which belongs to the slot model.
 */
import { isDrumInstrument } from "@/lib/instruments/registry";
import {
  findSection,
  sectionSlotStream,
} from "@/lib/song/onset-block";
import type { Song } from "@/lib/song/schema";

export type ChordCellTarget = {
  readonly sectionId: string;
  readonly trackId: string;
  readonly timeTicks: number;
  readonly slotTicks: number;
  readonly occupied: boolean;
  readonly barNumber: number;
  readonly anchorFret?: number;
  /** Fretless instruments: the octave a stack is built in (2Q-B §8). */
  readonly octave?: number;
};

/**
 * Where a cell of the tab is, in the command's terms, or null when the cell
 * is not a place a chord could go at all.
 */
export function chordTargetAt(
  song: Song,
  input: {
    readonly sectionId: string;
    readonly trackId: string;
    readonly barIndex: number;
    readonly slotIndex: number;
    /** The bar number the reader can see, for the sheet title. */
    readonly barNumber: number;
    /** The fret they were working at, if any, so shapes are offered near it. */
    readonly anchorFret?: number | null;
    /** The octave they were working in, if the instrument has no frets. */
    readonly octave?: number | null;
  },
): ChordCellTarget | null {
  const section = findSection(song, input.sectionId);
  if (!section) return null;

  const stream = sectionSlotStream(section, input.trackId);
  const entry = stream.find(
    (slot) =>
      slot.barIndex === input.barIndex && slot.slotIndex === input.slotIndex,
  );
  if (!entry) return null;

  /*
   * A melodic track with no lane in this bar is not written here yet, which
   * is a place a chord *can* go: the lane is laid inside the write's own
   * candidate (K-55, §3). A drum lane is a different shape and stays a
   * refusal — it is not a hole, it is somebody else's instrument.
   */
  const track = song.tracks.find((entry) => entry.id === input.trackId);
  if (!track) return null;
  const unwritten = entry.slot === undefined;
  if (!entry.writable && !(unwritten && !isDrumInstrument(track.instrumentId))) {
    return null;
  }

  return {
    sectionId: input.sectionId,
    trackId: input.trackId,
    timeTicks: entry.startTicks,
    slotTicks: entry.durationTicks,
    // A tie counts as occupied: a chord cannot begin inside somebody else's
    // note, and the command says so in its own words when it is asked.
    occupied: entry.slot !== null && entry.slot !== undefined,
    barNumber: input.barNumber,
    ...(input.anchorFret === undefined || input.anchorFret === null
      ? {}
      : { anchorFret: input.anchorFret }),
    ...(input.octave === undefined || input.octave === null
      ? {}
      : { octave: input.octave }),
  };
}

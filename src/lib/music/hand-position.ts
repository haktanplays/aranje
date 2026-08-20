/**
 * How a hand sits on a fretboard, measured once.
 *
 * Two things need these numbers and must not disagree about them: the
 * placement engine that chooses positions (spec 9.2, K-19) and the `fretJump`
 * warning that reports what is left (spec 10.3). If the engine measured a jump
 * one way and the validator another, the engine could "solve" a warning it was
 * never really looking at.
 *
 * Everything here is in **physical frets** — capo plus written fret (spec 9.1)
 * — because that is where the hand actually is.
 */
import { handPositionLimits } from "@/lib/limits";
import { instrumentFamily } from "@/lib/instruments/registry";

/** One note as the hand sees it: which string, and which physical fret. */
export type HandNote = { stringIndex: number; physicalFret: number };

/**
 * The median of a list. For an even count the lower middle is taken, so the
 * answer is always one of the values given and never a half fret.
 */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor((sorted.length - 1) / 2);
  return sorted[middle] ?? null;
}

/**
 * Where the hand is for this group of notes.
 *
 * Only fretted notes count. An open string is played by the other hand, so a
 * chord of one fretted note at the twelfth fret and three open strings anchors
 * at twelve, not at three. A group with nothing fretted anchors at 0, which is
 * where a hand rests when it is holding nothing.
 */
export function anchorOf(notes: readonly HandNote[]): number {
  const fretted = notes
    .filter((note) => note.physicalFret > 0)
    .map((note) => note.physicalFret);
  return medianOf(fretted) ?? 0;
}

/**
 * How far the hand has to stretch. Open strings are not part of the stretch,
 * and one fretted note is no stretch at all.
 */
export function chordSpan(notes: readonly HandNote[]): number {
  const fretted = notes
    .filter((note) => note.physicalFret > 0)
    .map((note) => note.physicalFret);
  if (fretted.length < 2) return 0;
  return Math.max(...fretted) - Math.min(...fretted);
}

/**
 * Which part of the neck, across the strings, this group sits on. Data-model
 * string indices, thickest first — never the visual row.
 */
export function stringCenter(notes: readonly HandNote[]): number {
  return medianOf(notes.map((note) => note.stringIndex)) ?? 0;
}

/** How far this instrument's hand may travel between neighbouring onsets. */
export function maxShiftFor(instrumentId: string): number | null {
  switch (instrumentFamily(instrumentId)) {
    case "guitar":
      return handPositionLimits.guitarMaxShift;
    case "bass":
      return handPositionLimits.bassMaxShift;
    default:
      // Drums have no frets; a phase 2.5 instrument with no fretboard has no
      // hand position to speak of yet.
      return null;
  }
}

/** True when moving between these two anchors is more than the family allows. */
export function isLargeShift(from: number, to: number, maxShift: number): boolean {
  return Math.abs(to - from) > maxShift;
}

/** How much of a shift is over the threshold; 0 when it is within it. */
export function shiftExcess(from: number, to: number, maxShift: number): number {
  return Math.max(0, Math.abs(to - from) - maxShift);
}

/**
 * The allowed tonal set of spec 10.4.
 *
 * Spec 10.4 names the members in words: "Natural / harmonic / melodic minor,
 * major borrowings, b5 and neighbouring chromatic passing tones." Each of
 * those is written out below as the scale it is, so the set can be read
 * against the sentence that defines it. No degree is invented here.
 *
 * Two things follow from taking the sentence literally, and both are
 * deliberate rather than hidden:
 *
 * 1. The fixed part of the set covers eleven of the twelve pitch classes.
 *    Only the flat second is left out. That is what the union of three minor
 *    scales, the parallel major and the flat fifth adds up to; spec 10.4 is a
 *    permissive rule by design, and 10.1 blocks only when more than half of a
 *    bar sits outside it.
 * 2. "Neighbouring chromatic" is not a pitch class, it is a relationship. A
 *    note outside the fixed set is admitted when the note struck just before
 *    or just after it lies a semitone away and is itself inside the set,
 *    which is what makes it a passing tone rather than a wrong note.
 *
 * The key is written on the Song (spec 5.1), so the set can only be decided
 * with the whole song in hand, never from a patch on its own.
 */
import { KEY_PATTERN } from "@/lib/song/schema";
import { pitchToMidi } from "@/lib/music/pitch";

export type Mode = "minor" | "major";

export type ParsedKey = {
  /** Pitch class of the tonic, 0 = C. */
  tonicPc: number;
  mode: Mode;
};

/** Scale degrees in semitones above the tonic. */
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];
const HARMONIC_MINOR = [0, 2, 3, 5, 7, 8, 11];
const MELODIC_MINOR = [0, 2, 3, 5, 7, 9, 11];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
/**
 * Modal mixture the other way round. Spec 10.4 is written from a minor key's
 * point of view ("major borrowings"); in a major key the borrowing that
 * mirrors it is from the parallel minor. This mirroring is the one inference
 * this file makes, and it is stated here rather than buried in the union.
 */
const MINOR_BORROWINGS = [3, 8, 10];
/** Named on its own in spec 10.4. */
const FLAT_FIFTH = [6];

function setOf(...groups: readonly (readonly number[])[]): ReadonlySet<number> {
  return new Set(groups.flat());
}

const MINOR_SET = setOf(
  NATURAL_MINOR,
  HARMONIC_MINOR,
  MELODIC_MINOR,
  MAJOR, // major borrowings into a minor key
  FLAT_FIFTH,
);

const MAJOR_SET = setOf(MAJOR, MINOR_BORROWINGS, FLAT_FIFTH);

/** Semitones above the tonic that spec 10.4 admits without any context. */
export function allowedIntervals(mode: Mode): ReadonlySet<number> {
  return mode === "minor" ? MINOR_SET : MAJOR_SET;
}

const LETTER_PC: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

/** "E minor" -> { tonicPc: 4, mode: "minor" } (spec 5.1 key form). */
export function parseKey(key: string): ParsedKey | null {
  if (!KEY_PATTERN.test(key)) return null;
  const [pitch, mode] = key.split(" ");
  if (pitch === undefined || mode === undefined) return null;

  const letter = pitch[0];
  if (letter === undefined) return null;
  const base = LETTER_PC[letter];
  if (base === undefined) return null;

  const accidental = pitch[1];
  const shift = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;

  return {
    tonicPc: (((base + shift) % 12) + 12) % 12,
    mode: mode === "minor" ? "minor" : "major",
  };
}

/** Semitones of this pitch above the tonic, or null if unreadable. */
export function intervalFromTonic(pitch: string, key: ParsedKey): number | null {
  const midi = pitchToMidi(pitch);
  if (midi === null) return null;
  return (((midi - key.tonicPc) % 12) + 12) % 12;
}

/** Inside the fixed part of the set, before any passing-tone allowance. */
export function isDiatonic(pitch: string, key: ParsedKey): boolean {
  const interval = intervalFromTonic(pitch, key);
  if (interval === null) return false;
  return allowedIntervals(key.mode).has(interval);
}

/**
 * A chromatic neighbour in the sense of spec 10.4: one semitone from a note
 * struck immediately before or after it, which is itself inside the set.
 */
export function isChromaticNeighbour(
  pitch: string,
  neighbours: readonly string[],
  key: ParsedKey,
): boolean {
  const midi = pitchToMidi(pitch);
  if (midi === null) return false;

  return neighbours.some((other) => {
    const otherMidi = pitchToMidi(other);
    if (otherMidi === null) return false;
    if (Math.abs(otherMidi - midi) !== 1) return false;
    return isDiatonic(other, key);
  });
}

/** The full spec 10.4 test: fixed set first, passing tone second. */
export function isInTonalSet(
  pitch: string,
  neighbours: readonly string[],
  key: ParsedKey,
): boolean {
  return (
    isDiatonic(pitch, key) || isChromaticNeighbour(pitch, neighbours, key)
  );
}

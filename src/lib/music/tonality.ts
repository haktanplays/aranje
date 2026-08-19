/**
 * Tonal core and colour tones (spec 10.4, decision K-17).
 *
 * The earlier reading of spec 10.4 unioned three minor scales, the parallel
 * major and the flat fifth into one set, which admitted eleven of the twelve
 * pitch classes and left `tonalMajority` with almost nothing to refuse. K-17
 * replaces it with a narrow core and an explicit colour class:
 *
 * - **Core** is the seven-note scale the song declares, and only that: the
 *   major scale for a major key, the natural minor for a minor key.
 * - **Colour** is everything else — the harmonic minor's raised seventh, the
 *   melodic minor's raised sixth and seventh, the flat fifth, borrowings from
 *   the parallel mode, and chromatic passing tones.
 *
 * A colour tone is never an error on its own. It simply does not count towards
 * the majority, which is what lets one blue note through and stops a bar that
 * is mostly outside the key.
 *
 * There is deliberately **no** function here that returns one set containing
 * both. Merging them again is exactly the mistake K-17 undid, so the only way
 * to ask about a pitch is to ask which of the two it is.
 */
import { KEY_PATTERN } from "@/lib/song/schema";
import { pitchToMidi } from "@/lib/music/pitch";

export type Mode = "minor" | "major";

export type ParsedKey = {
  /** Pitch class of the tonic, 0 = C. */
  tonicPc: number;
  mode: Mode;
};

/** The declared scale, in semitones above the tonic. Nothing else is core. */
export const CORE_MAJOR: readonly number[] = [0, 2, 4, 5, 7, 9, 11];
export const CORE_NATURAL_MINOR: readonly number[] = [0, 2, 3, 5, 7, 8, 10];

const CORE_SETS: Readonly<Record<Mode, ReadonlySet<number>>> = {
  major: new Set(CORE_MAJOR),
  minor: new Set(CORE_NATURAL_MINOR),
};

/** Semitones above the tonic that count towards the majority (spec 10.4). */
export function coreIntervals(mode: Mode): ReadonlySet<number> {
  return CORE_SETS[mode];
}

/**
 * Why a pitch is a colour tone. The names say where the note comes from, so a
 * message can tell a musician something more useful than "outside the key".
 */
export type ColourReason =
  /** Minor key, raised seventh: harmonic and melodic minor both use it. */
  | "raised_seventh"
  /** Minor key, raised sixth: melodic minor. */
  | "raised_sixth"
  /** The flat fifth, named on its own in spec 10.4. */
  | "flat_five"
  /** Taken from the parallel mode. */
  | "borrowed"
  /** Anything left: a chromatic step. */
  | "chromatic";

const MINOR_COLOURS: Readonly<Record<number, ColourReason>> = {
  1: "chromatic",
  4: "borrowed", // major third of the parallel major
  6: "flat_five",
  9: "raised_sixth",
  11: "raised_seventh",
};

const MAJOR_COLOURS: Readonly<Record<number, ColourReason>> = {
  1: "chromatic",
  3: "borrowed", // minor third of the parallel minor
  6: "flat_five",
  8: "borrowed",
  10: "borrowed",
};

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

export type ToneClass =
  | { kind: "core"; interval: number }
  | { kind: "colour"; interval: number; reason: ColourReason }
  | { kind: "unreadable" };

/** The only way to ask about a pitch: core, colour, or not a pitch at all. */
export function classifyTone(pitch: string, key: ParsedKey): ToneClass {
  const interval = intervalFromTonic(pitch, key);
  if (interval === null) return { kind: "unreadable" };
  if (coreIntervals(key.mode).has(interval)) return { kind: "core", interval };
  const table = key.mode === "minor" ? MINOR_COLOURS : MAJOR_COLOURS;
  return {
    kind: "colour",
    interval,
    reason: table[interval] ?? "chromatic",
  };
}

/** True only for the seven notes of the declared scale. */
export function isCoreTone(pitch: string, key: ParsedKey): boolean {
  return classifyTone(pitch, key).kind === "core";
}

/**
 * One chord, one name (2V-B.4 §13).
 *
 * ## Three names for one chord is three chords
 *
 * The app could show a reader "C minor" in one place, "C minör" in another and
 * `minor` in a third, and they are all the same sound. A beginner has no way
 * to know that. So there is exactly one display name, built here, and every
 * surface that names a chord asks this file for it.
 *
 * ## Input is generous, output is not
 *
 * What a reader types is normalised: `Cm`, `C min`, `C minör`, `Cmin`, `c-`
 * are one canonical chord. What the app shows back is a single spelling. The
 * generosity is entirely on the way in — which is the opposite of how it
 * usually goes wrong, where a lenient parser leads to several spellings
 * getting stored and shown.
 *
 * ## Spelling follows the key
 *
 * The same sounding chord is written `F#` in a sharp key and `Gb` in a flat
 * one, and a reader in E minor should never be shown `Gb`. The pitch class
 * underneath is one number either way — this is a spelling rule, not a second
 * harmony.
 */
import {
  CHORD_FORMULAS,
  normalizePitchClass,
  type ChordQualityId,
} from "@/lib/chords/chord-formula";
import { parseKey } from "@/lib/music/tonality";

/**
 * The qualities the Simple surface offers, in the order it offers them.
 *
 * Eight, and no more: diminished, augmented and half-diminished are real
 * chords the model can hold and play, and they belong under "Ayrıntılar"
 * rather than in a beginner's first row of choices.
 */
export const SIMPLE_QUALITIES: readonly ChordQualityId[] = [
  "major",
  "minor",
  "power",
  "sus2",
  "sus4",
  "dominant_7",
  "major_7",
  "minor_7",
];

/** The rest, still fully supported, reached on purpose. */
export const ADVANCED_QUALITIES: readonly ChordQualityId[] = [
  "diminished",
  "augmented",
  "half_diminished_7",
];

export function isSimpleQuality(quality: ChordQualityId): boolean {
  return SIMPLE_QUALITIES.includes(quality);
}

/** A chord, as the app knows it: a pitch class and a quality. Nothing else. */
export type ChordIdentity = {
  readonly rootPitchClass: number;
  readonly quality: ChordQualityId;
};

const SHARP_SPELLING: readonly string[] = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

const FLAT_SPELLING: readonly string[] = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];

/**
 * Keys written with flats.
 *
 * A short, explicit list rather than a circle-of-fifths calculation: the set
 * is small, it never changes, and a table can be read and checked by someone
 * who does not want to re-derive music theory to review a diff.
 */
const FLAT_KEYS = new Set([
  "F major",
  "Bb major",
  "Eb major",
  "Ab major",
  "Db major",
  "Gb major",
  "D minor",
  "G minor",
  "C minor",
  "F minor",
  "Bb minor",
  "Eb minor",
]);

/** Does this key write its accidentals as flats? */
export function keyPrefersFlats(key: string): boolean {
  const parsed = parseKey(key);
  if (!parsed) return false;
  const tonic = SHARP_SPELLING[normalizePitchClass(parsed.tonicPc)] ?? "";
  const flat = FLAT_SPELLING[normalizePitchClass(parsed.tonicPc)] ?? "";
  return (
    FLAT_KEYS.has(`${tonic} ${parsed.mode}`) || FLAT_KEYS.has(`${flat} ${parsed.mode}`)
  );
}

/**
 * How a pitch class is written in this key.
 *
 * The whole of the enharmonic rule, in one place, so "the same chord is not
 * named differently on two surfaces" is structural rather than a convention
 * every component has to remember.
 */
export function spellPitchClass(pitchClass: number, key: string): string {
  const index = normalizePitchClass(pitchClass);
  const table = keyPrefersFlats(key) ? FLAT_SPELLING : SHARP_SPELLING;
  return table[index] ?? "";
}

/** "Am7", "Db5", "Cmaj7" — the name a reader reads, spelled for their key. */
export function chordDisplayName(chord: ChordIdentity, key: string): string {
  return `${spellPitchClass(chord.rootPitchClass, key)}${CHORD_FORMULAS[chord.quality].suffix}`;
}

/** The quality's own word, for a control that names it on its own. */
export function qualityLabel(quality: ChordQualityId): string {
  return CHORD_FORMULAS[quality].label;
}

/**
 * Every way a reader might write a quality.
 *
 * Longest first at match time, because `min` is a prefix of `minor` and of
 * `minör` and a shortest-first search would stop early and mis-read `Cminor`
 * as `C min` + `or`.
 */
const QUALITY_ALIASES: readonly (readonly [string, ChordQualityId])[] = [
  ["halfdim7", "half_diminished_7"],
  ["halfdiminished7", "half_diminished_7"],
  ["m7b5", "half_diminished_7"],
  ["ø7", "half_diminished_7"],
  ["ø", "half_diminished_7"],
  ["maj7", "major_7"],
  ["major7", "major_7"],
  ["majör7", "major_7"],
  ["δ7", "major_7"],
  ["m7", "minor_7"],
  ["min7", "minor_7"],
  ["minor7", "minor_7"],
  ["minör7", "minor_7"],
  ["-7", "minor_7"],
  ["dom7", "dominant_7"],
  ["dominant7", "dominant_7"],
  ["7", "dominant_7"],
  ["dim", "diminished"],
  ["diminished", "diminished"],
  ["eksilmiş", "diminished"],
  ["°", "diminished"],
  ["aug", "augmented"],
  ["augmented", "augmented"],
  ["artmış", "augmented"],
  ["+", "augmented"],
  ["sus2", "sus2"],
  ["sus4", "sus4"],
  ["sus", "sus4"],
  ["power", "power"],
  ["5", "power"],
  ["minor", "minor"],
  ["minör", "minor"],
  ["min", "minor"],
  ["moll", "minor"],
  ["m", "minor"],
  ["-", "minor"],
  ["major", "major"],
  ["majör", "major"],
  ["maj", "major"],
  ["dur", "major"],
  ["M", "major"],
  ["", "major"],
];

/**
 * Read what a reader wrote.
 *
 * Returns null rather than a guess: an input this cannot place is a question
 * for the reader, and silently choosing a major chord for it would put music
 * in the song that nobody asked for.
 */
export function parseChordInput(input: string): ChordIdentity | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  /* The root: a letter, then any number of accidentals in either notation. */
  const match = /^([A-Ga-g])([#♯b♭]*)\s*(.*)$/u.exec(trimmed);
  if (!match) return null;
  const [, letter, accidentals, rest] = match;

  const base: Readonly<Record<string, number>> = {
    c: 0,
    d: 2,
    e: 4,
    f: 5,
    g: 7,
    a: 9,
    b: 11,
  };
  let pitchClass = base[letter!.toLowerCase()];
  if (pitchClass === undefined) return null;
  for (const mark of accidentals ?? "") {
    if (mark === "#" || mark === "♯") pitchClass += 1;
    if (mark === "b" || mark === "♭") pitchClass -= 1;
  }

  /* Case matters for exactly one alias — "M" is major and "m" is minor — so
     the tail is matched case-sensitively first and case-insensitively after. */
  const tail = (rest ?? "").replace(/[\s._-]+/gu, (found) =>
    found.trim() === "" ? "" : found,
  );
  const cleaned = tail.replace(/\s+/gu, "");
  const exact = QUALITY_ALIASES.find(([alias]) => alias === cleaned);
  const loose =
    exact ??
    QUALITY_ALIASES.find(([alias]) => alias.toLowerCase() === cleaned.toLowerCase());
  if (!loose) return null;

  return { rootPitchClass: normalizePitchClass(pitchClass), quality: loose[1] };
}

/**
 * Are these the same chord?
 *
 * By identity, not by name: `F#m` and `Gbm` are one chord written for two
 * keys, and a comparison on the displayed string would call them different.
 */
export function sameChord(left: ChordIdentity, right: ChordIdentity): boolean {
  return (
    normalizePitchClass(left.rootPitchClass) === normalizePitchClass(right.rootPitchClass) &&
    left.quality === right.quality
  );
}

/** The chord a transposition produces. Identity in, identity out. */
export function transposeChord(chord: ChordIdentity, semitones: number): ChordIdentity {
  return {
    rootPitchClass: normalizePitchClass(chord.rootPitchClass + semitones),
    quality: chord.quality,
  };
}

/** How a measure is named for a reader. Never "Bar 4", never a slot. */
export function measureLabel(barNumber: number): string {
  return `${barNumber}. ölçü`;
}

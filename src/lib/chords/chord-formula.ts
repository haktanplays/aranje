/**
 * The harmonic vocabulary, once (spec 13.22 §5, 2O-B).
 *
 * Eleven qualities, each a set of semitone steps above a root. This table is
 * the **only** place those numbers appear: the reader-facing name, the
 * recogniser and both voicing generators all read it, so a major third cannot
 * be four semitones in one place and three in another.
 *
 * What it deliberately is not:
 *
 * - It is not a chord *object*. Nothing here is ever written into a Song — a
 *   chord in Aranjé is what it has always been, several `NoteEvent`s starting
 *   on the same onset (spec 5.4). This table describes how to *choose* those
 *   pitches and is thrown away the moment they exist.
 * - It is not a judgement. There is no "common", "easy" or "suggested" flag,
 *   because the app does not rank harmony for its reader.
 * - It is not the full vocabulary of music. Add9, 6, 9, 11, 13, altered
 *   dominants, slash chords and polychords are outside V1 and the UI does not
 *   pretend otherwise.
 */

/** The eleven V1 qualities. Adding one here is a compile error until it is
 *  given intervals and a label below. */
export const CHORD_QUALITY_IDS = [
  "major",
  "minor",
  "power",
  "sus2",
  "sus4",
  "diminished",
  "augmented",
  "dominant_7",
  "major_7",
  "minor_7",
  "half_diminished_7",
] as const;

export type ChordQualityId = (typeof CHORD_QUALITY_IDS)[number];

/**
 * Which tones make the quality what it is.
 *
 * `required` names the intervals a voicing may never leave out. It is a
 * property of the harmony, not of the instrument: a minor triad without its
 * third is not a minor triad played awkwardly, it is a different chord. The
 * fifth of a seventh chord is the one interval that may go, and only because
 * the seventh already fixes the quality — that single exemption is written
 * here rather than decided inside a search.
 */
export type ChordFormula = {
  readonly id: ChordQualityId;
  /** Semitones above the root, ascending, starting at 0. */
  readonly intervals: readonly number[];
  /** Intervals a voicing must contain. A subset of `intervals`. */
  readonly required: readonly number[];
  /** Turkish, reader-facing. The only name a musician sees. */
  readonly label: string;
  /** How the chord is written after the root: "Am7" is root + "m7". */
  readonly suffix: string;
};

/**
 * A total record: a quality with no formula does not compile.
 */
export const CHORD_FORMULAS: Readonly<Record<ChordQualityId, ChordFormula>> = {
  major: {
    id: "major",
    intervals: [0, 4, 7],
    required: [0, 4, 7],
    label: "Majör",
    suffix: "",
  },
  minor: {
    id: "minor",
    intervals: [0, 3, 7],
    required: [0, 3, 7],
    label: "Minör",
    suffix: "m",
  },
  power: {
    id: "power",
    intervals: [0, 7],
    required: [0, 7],
    label: "Power chord",
    suffix: "5",
  },
  sus2: {
    id: "sus2",
    intervals: [0, 2, 7],
    required: [0, 2, 7],
    label: "Sus2",
    suffix: "sus2",
  },
  sus4: {
    id: "sus4",
    intervals: [0, 5, 7],
    required: [0, 5, 7],
    label: "Sus4",
    suffix: "sus4",
  },
  diminished: {
    id: "diminished",
    intervals: [0, 3, 6],
    required: [0, 3, 6],
    label: "Eksilmiş",
    suffix: "dim",
  },
  augmented: {
    id: "augmented",
    intervals: [0, 4, 8],
    required: [0, 4, 8],
    label: "Artmış",
    suffix: "aug",
  },
  /*
   * The four sevenths share one exemption: the fifth may be dropped when a
   * fretboard cannot reach it. Everything that makes the chord what it is —
   * root, third or its sus equivalent, seventh — stays required.
   */
  dominant_7: {
    id: "dominant_7",
    intervals: [0, 4, 7, 10],
    required: [0, 4, 10],
    label: "7",
    suffix: "7",
  },
  major_7: {
    id: "major_7",
    intervals: [0, 4, 7, 11],
    required: [0, 4, 11],
    label: "Maj7",
    suffix: "maj7",
  },
  minor_7: {
    id: "minor_7",
    intervals: [0, 3, 7, 10],
    required: [0, 3, 10],
    label: "Min7",
    suffix: "m7",
  },
  /*
   * The half-diminished seventh keeps its diminished fifth: drop it and what
   * is left is a plain minor seventh. Its "fifth" is the characteristic tone,
   * so the seventh-chord exemption does not apply.
   */
  half_diminished_7: {
    id: "half_diminished_7",
    intervals: [0, 3, 6, 10],
    required: [0, 3, 6, 10],
    label: "Yarı eksilmiş 7",
    suffix: "m7b5",
  },
};

/** In the fixed order above, for a UI that must not re-sort them by taste. */
export const CHORD_FORMULA_LIST: readonly ChordFormula[] = CHORD_QUALITY_IDS.map(
  (id) => CHORD_FORMULAS[id],
);

export function isChordQualityId(value: string): value is ChordQualityId {
  return (CHORD_QUALITY_IDS as readonly string[]).includes(value);
}

/* ----------------------------------------------------------- pitch classes */

/** 0-11, whatever the sign or size of the number handed in. */
export function normalizePitchClass(value: number): number {
  return ((Math.trunc(value) % 12) + 12) % 12;
}

export function isPitchClass(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 11;
}

/**
 * The pitch classes this chord contains, ascending from the root.
 *
 * Ascending *from the root* rather than numerically: the order is the chord's
 * own, so a caller can tell the third from the seventh without knowing which
 * key it is in.
 */
export function chordPitchClasses(
  rootPitchClass: number,
  quality: ChordQualityId,
): number[] {
  const root = normalizePitchClass(rootPitchClass);
  return CHORD_FORMULAS[quality].intervals.map((step) =>
    normalizePitchClass(root + step),
  );
}

/** The pitch classes a voicing of this chord may not be missing. */
export function requiredPitchClasses(
  rootPitchClass: number,
  quality: ChordQualityId,
): number[] {
  const root = normalizePitchClass(rootPitchClass);
  return CHORD_FORMULAS[quality].required.map((step) =>
    normalizePitchClass(root + step),
  );
}

/** The twelve roots, spelled with sharps, as the twelve pitch classes. */
export const ROOT_PITCH_CLASSES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

/**
 * How a root is written for a reader.
 *
 * Both spellings, because a musician who thinks in flats should not have to
 * translate: "C♯ / D♭" names one sounding pitch, and the pitch class beneath
 * it is what the app actually works with. There is no second semantics here —
 * the two spellings are one number.
 */
export const ROOT_LABELS: readonly string[] = [
  "C",
  "C♯ / D♭",
  "D",
  "D♯ / E♭",
  "E",
  "F",
  "F♯ / G♭",
  "G",
  "G♯ / A♭",
  "A",
  "A♯ / B♭",
  "B",
];

/** The short spelling used inside a chord name: sharps, like the pitch helper. */
export const ROOT_SHORT_LABELS: readonly string[] = [
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

export function rootLabel(pitchClass: number): string {
  return ROOT_LABELS[normalizePitchClass(pitchClass)] ?? "";
}

/** "Am7", "D5", "Cmaj7" — the name a reader reads, built in one place. */
export function chordName(
  rootPitchClass: number,
  quality: ChordQualityId,
): string {
  const root = ROOT_SHORT_LABELS[normalizePitchClass(rootPitchClass)] ?? "";
  return `${root}${CHORD_FORMULAS[quality].suffix}`;
}

/**
 * Reading a chord back out of the notes (spec 13.22 §11, 2O-B).
 *
 * Nothing is stored about what a chord "is", so the only honest way to name
 * one is to look at the notes and work it out again. That is what this does,
 * and the discipline it keeps is about what it refuses to claim:
 *
 * - **It is not a validator.** Music it cannot name is not wrong. A cluster
 *   with no entry in the V1 table comes back as "özel nota grubu" and the
 *   reader is told nothing further.
 * - **It does not pick a winner.** If a set of pitch classes is exactly two
 *   chords in the V1 vocabulary — and several are — both are returned. Showing
 *   one would be inventing a fact the notes do not carry.
 * - **The lowest note is not the root.** It is reported separately, because a
 *   listener does hear it, but it never decides the answer.
 * - **Only pitch matters.** Velocity, articulation and fret position are how
 *   a note is played, not which note it is.
 */
import {
  CHORD_QUALITY_IDS,
  chordName,
  chordPitchClasses,
  normalizePitchClass,
  type ChordQualityId,
} from "@/lib/chords/chord-formula";
import { pitchClass, pitchToMidi } from "@/lib/music/pitch";
import type { NoteEvent } from "@/lib/song/schema";

export type ChordMatch = {
  readonly rootPitchClass: number;
  readonly quality: ChordQualityId;
  /** "Am7". Built from the one naming function. */
  readonly name: string;
};

export type ChordReading =
  /** No pitched note to read. */
  | { readonly kind: "empty" }
  /** One note; naming a chord from it would be an invention. */
  | { readonly kind: "single"; readonly pitch: string }
  /**
   * One or more exact readings of the same notes.
   *
   * Several is the normal case for symmetrical chords and for anything whose
   * pitch-class set is shared — a C6 and an Am7 are the same four notes.
   */
  | {
      readonly kind: "matched";
      readonly matches: readonly ChordMatch[];
      /** The lowest sounding note, for describing the bass. Never the root. */
      readonly lowestPitch: string;
    }
  /** Real music the V1 vocabulary has no name for. Not an error. */
  | { readonly kind: "unknown"; readonly lowestPitch: string };

/**
 * Every V1 chord whose pitch classes are exactly this set.
 *
 * Exactly: a subset is not a match, and neither is a superset. "Cmaj7 with the
 * fifth missing" is a real thing to play and a dishonest thing to name, so a
 * three-note set is only ever read as a three-note chord.
 *
 * Roots are tried in ascending pitch-class order and qualities in table order,
 * so the answer is a property of the notes and not of iteration.
 */
export function matchPitchClasses(
  pitchClasses: readonly number[],
): ChordMatch[] {
  const wanted = new Set(pitchClasses.map(normalizePitchClass));
  if (wanted.size === 0) return [];

  const matches: ChordMatch[] = [];
  for (let root = 0; root < 12; root += 1) {
    for (const quality of CHORD_QUALITY_IDS) {
      const tones = new Set(chordPitchClasses(root, quality));
      if (tones.size !== wanted.size) continue;
      let same = true;
      for (const tone of tones) {
        if (!wanted.has(tone)) {
          same = false;
          break;
        }
      }
      if (same) {
        matches.push({ rootPitchClass: root, quality, name: chordName(root, quality) });
      }
    }
  }
  return matches;
}

/** What these notes, struck together, can honestly be called. */
export function readChord(notes: readonly NoteEvent[]): ChordReading {
  const midi = notes
    .map((note) => pitchToMidi(note.pitch))
    .filter((value): value is number => value !== null);
  if (midi.length === 0) return { kind: "empty" };

  const lowest = notes.reduce((low, note) => {
    const a = pitchToMidi(note.pitch);
    const b = pitchToMidi(low.pitch);
    if (a === null) return low;
    if (b === null) return note;
    return a < b ? note : low;
  });

  const classes = notes
    .map((note) => pitchClass(note.pitch))
    .filter((value): value is number => value !== null);
  const unique = new Set(classes);

  // One pitch class, however many octaves of it: still one note's worth of
  // information. An octave doubling is not a chord.
  if (unique.size < 2) return { kind: "single", pitch: lowest.pitch };

  const matches = matchPitchClasses([...unique]);
  if (matches.length === 0) return { kind: "unknown", lowestPitch: lowest.pitch };
  return { kind: "matched", matches, lowestPitch: lowest.pitch };
}

/**
 * The sentence a reader is shown for a reading.
 *
 * Ambiguity is carried through rather than resolved: two names joined, in the
 * order the recogniser found them.
 */
export function describeChord(reading: ChordReading): string {
  switch (reading.kind) {
    case "empty":
      return "Bu vuruşta nota yok.";
    case "single":
      return "Tek nota.";
    case "unknown":
      return "Özel nota grubu.";
    case "matched": {
      const names = reading.matches.map((match) => match.name);
      return names.length === 1
        ? `Akor yapısı: ${names[0]}`
        : `Olası yapılar: ${names.join(" · ")}`;
    }
  }
}

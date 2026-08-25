/**
 * A pitch in the reader's own words (2Q-B §7.2).
 *
 * `A3` is the technical name — the one the Song Contract stores, the one MIDI
 * export writes and the one a sample file is called. It is also the one most
 * people learning music in Turkish do not read fluently. So the sheet says
 * both: the solfège name it is spoken as, and the technical name it is stored
 * as, side by side, with the octave spelled out separately.
 *
 * ## Nothing is normalised away
 *
 * `Bb3` is written "Si bemol", not "La diyez". They are the same key on a
 * piano and different notes on a page, and the song stored one of them. A
 * naming helper that quietly re-spelled a pitch would be telling the reader
 * their song says something it does not.
 *
 * ## What this is not
 *
 * It is not a key- or scale-aware speller: it never asks what key the song is
 * in and never chooses a spelling. It reads the pitch it is given.
 */
import { parsePitch } from "@/lib/music/pitch";

/** The seven letters, spoken. Fixed by convention, not by taste. */
export const SOLFEGE_BY_LETTER: Readonly<Record<string, string>> = {
  C: "Do",
  D: "Re",
  E: "Mi",
  F: "Fa",
  G: "Sol",
  A: "La",
  B: "Si",
};

/** The two accidentals the contract's pitch grammar allows, spoken. */
export const ACCIDENTAL_WORDS: Readonly<Record<"#" | "b", string>> = {
  "#": "diyez",
  b: "bemol",
};

export type SpokenPitch = {
  /** How it is said: "La", "Do diyez", "Si bemol". */
  readonly spoken: string;
  /** How it is stored: "A3", "C#4", "Bb3". */
  readonly technical: string;
  readonly octave: number;
};

/** The spoken form of a pitch, or null when it is not a pitch at all. */
export function spokenPitch(pitch: string): SpokenPitch | null {
  const parsed = parsePitch(pitch);
  if (!parsed) return null;
  const letter = SOLFEGE_BY_LETTER[parsed.letter];
  if (letter === undefined) return null;
  const accidental = parsed.accidental;
  return {
    spoken: accidental === null ? letter : `${letter} ${ACCIDENTAL_WORDS[accidental]}`,
    technical: pitch,
    octave: parsed.octave,
  };
}

/**
 * The one line the note sheet shows, in the order the reader needs it: what
 * it is called, what it is stored as, where it sits.
 */
export function describePitch(pitch: string): string | null {
  const spoken = spokenPitch(pitch);
  if (!spoken) return null;
  return `Nota: ${spoken.spoken} · Teknik: ${spoken.technical} · Oktav: ${spoken.octave}`;
}

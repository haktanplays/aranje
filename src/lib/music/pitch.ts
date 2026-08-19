/**
 * Scientific pitch notation helpers. C4 is MIDI 60.
 *
 * The written form is `letter + optional accidental + octave`, e.g. "E2",
 * "F#4", "Bb3". Octave -1 is the lowest representable octave.
 */

const LETTER_SEMITONES: Readonly<Record<string, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

const SHARP_NAMES = [
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
] as const;

/** Accepted written pitch form. */
export const PITCH_PATTERN = /^([A-G])(#|b)?(-1|[0-9])$/;

export type ParsedPitch = {
  letter: string;
  accidental: "#" | "b" | null;
  octave: number;
};

export function parsePitch(pitch: string): ParsedPitch | null {
  const match = PITCH_PATTERN.exec(pitch);
  if (!match) return null;
  const [, letter, accidental, octave] = match;
  if (letter === undefined || octave === undefined) return null;
  return {
    letter,
    accidental: accidental === "#" || accidental === "b" ? accidental : null,
    octave: Number.parseInt(octave, 10),
  };
}

export function isPitch(value: string): boolean {
  return parsePitch(value) !== null;
}

/** MIDI number for a written pitch, or null when the form is invalid. */
export function pitchToMidi(pitch: string): number | null {
  const parsed = parsePitch(pitch);
  if (!parsed) return null;
  const base = LETTER_SEMITONES[parsed.letter];
  if (base === undefined) return null;
  const offset = parsed.accidental === "#" ? 1 : parsed.accidental === "b" ? -1 : 0;
  return (parsed.octave + 1) * 12 + base + offset;
}

/** Written pitch for a MIDI number, always spelled with sharps. */
export function midiToPitch(midi: number): string {
  const octave = Math.floor(midi / 12) - 1;
  const name = SHARP_NAMES[((midi % 12) + 12) % 12];
  return `${name}${octave}`;
}

/** Pitch class 0-11, or null when the form is invalid. */
export function pitchClass(pitch: string): number | null {
  const midi = pitchToMidi(pitch);
  return midi === null ? null : ((midi % 12) + 12) % 12;
}

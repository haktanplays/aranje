/**
 * How far a slide comes from, or goes to, in words (2V-C.2 §12).
 *
 * `approxSemitones` is a real number in the contract because playback needs
 * one. It is not a number the reader should be typing. A guitarist deciding
 * how to enter a note is not choosing an interval — there is no note at the
 * other end, that is what makes it an *open* slide — they are choosing how
 * much of the approach the listener hears. So the interface asks that, in
 * three words, and this is the only place the words become numbers.
 *
 * Three and not five: two options read as a switch, and past three the reader
 * is being asked to hear differences that a sampled instrument transposed by
 * a few semitones cannot reliably deliver. "Belirgin" is the default because
 * it is the one that sounds like the gesture rather than like a wobble or a
 * dive.
 *
 * The real interval is not hidden — it belongs under a "Daha fazla"
 * disclosure, spoken as an interval rather than as a field to fill in.
 */
import { fretboardRange, soundingMidi } from "@/lib/music/fretboard";
import type { Fretboard, PitchGesture, Position } from "@/lib/song/schema";

export type SlideDistanceId = "short" | "clear" | "long";

export type SlideDistance = {
  readonly id: SlideDistanceId;
  /** What the reader reads. Musician language, never a number. */
  readonly label: string;
  /** The bound written into the gesture. */
  readonly semitones: number;
  /** The interval, said plainly, for the disclosure. */
  readonly spoken: string;
};

/**
 * The three options, and the only mapping from a word to a bound.
 *
 * The bounds are deliberately small. Beyond about five semitones a sampled
 * note transposed that far stops sounding like the same string, and the
 * gesture starts reading as an effect — which is the note the founder left on
 * L14 and is not something a longer distance fixes.
 */
export const SLIDE_DISTANCES: readonly SlideDistance[] = [
  { id: "short", label: "Kısa", semitones: 1, spoken: "Bir perde." },
  { id: "clear", label: "Belirgin", semitones: 2, spoken: "İki perde." },
  { id: "long", label: "Uzun", semitones: 4, spoken: "Dört perde." },
];

export const DEFAULT_SLIDE_DISTANCE: SlideDistanceId = "clear";

export function slideDistance(id: SlideDistanceId): SlideDistance {
  return SLIDE_DISTANCES.find((entry) => entry.id === id) ?? SLIDE_DISTANCES[1]!;
}

/** Which option a written gesture is currently using, if it matches one. */
export function distanceOf(semitones: number | undefined): SlideDistanceId | null {
  if (semitones === undefined) return null;
  return SLIDE_DISTANCES.find((entry) => entry.semitones === semitones)?.id ?? null;
}

/**
 * Where the hand would have to be, in sounding pitch.
 *
 * Asked of the sounding pitch and not of the fret, so a capo or an alternate
 * tuning moves the answer with the instrument rather than against it: on a
 * capo-5 guitar, "two frets below" is two semitones below what is heard, and
 * whether that pitch exists on the neck is a question about the neck.
 */
export function approachMidi(
  fretboard: Fretboard,
  position: Position,
  gesture: Extract<PitchGesture, { kind: "slide_in" | "slide_out" }>,
  semitones: number,
): number | null {
  const sounding = soundingMidi(fretboard, position);
  if (sounding === null) return null;
  const down = gesture.kind === "slide_in" ? gesture.from === "below" : gesture.to === "down";
  return sounding + (down ? -semitones : semitones);
}

/**
 * True when the approach or exit pitch is somewhere the instrument can be.
 *
 * A slide from four semitones below an open low string starts at a pitch that
 * does not exist on the neck, and playing it anyway is how a gesture stops
 * being a hand. The refusal is typed rather than silent, so the interface can
 * say which option is unavailable and why instead of offering a dead button.
 */
export function approachIsPlayable(
  fretboard: Fretboard,
  position: Position,
  gesture: Extract<PitchGesture, { kind: "slide_in" | "slide_out" }>,
  semitones: number,
): boolean {
  const approach = approachMidi(fretboard, position, gesture, semitones);
  if (approach === null) return false;
  const range = fretboardRange(fretboard);
  if (range === null) return false;
  return approach >= range.lowMidi && approach <= range.highMidi;
}

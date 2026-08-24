/**
 * Chords for instruments with no fretboard (spec 13.22 §10, 2O-B).
 *
 * A piano, an organ, a synth or a string section has no strings to assign and
 * no positions to write: the chord is a stack of pitches and nothing else. So
 * this produces exactly that — root position and its inversions, as `pitch`
 * and nothing more. No `position` field is written, ever, because there is no
 * fretboard for one to mean anything on.
 *
 * ## The range this checks, and the one it does not
 *
 * Aranje has no numeric range for these instruments. That is deliberate and
 * older than this file: `range.ts` defers them rather than inventing bounds,
 * because a made-up low note is worse than an honest gap. Nothing here
 * overturns that.
 *
 * What is checked instead is the only bound that really exists: the pitches
 * the Song Contract can represent at all, and the register the reader chose.
 * A voicing that would climb out of the octave window the reader is working in
 * is refused rather than transposed down behind their back — not because the
 * instrument cannot play it, which this file does not claim to know, but
 * because they asked for a chord in one place and would have been given one
 * somewhere else.
 */
import {
  chordPitchClasses,
  normalizePitchClass,
  ROOT_SHORT_LABELS,
  type ChordQualityId,
} from "@/lib/chords/chord-formula";
import { keyboardVoicingLimits } from "@/lib/limits";
import { midiToPitch, pitchToMidi, PITCH_PATTERN } from "@/lib/music/pitch";

export type KeyboardVoicing = {
  /** Deterministic identity. Never written into a Song. */
  readonly id: string;
  /** 0 is root position, 1 the first inversion, and so on. */
  readonly inversion: number;
  /** Ascending. Exactly the pitches that will be written. */
  readonly pitches: readonly string[];
  readonly midi: readonly number[];
  readonly bassPitch: string;
};

export type KeyboardVoicingRequest = {
  readonly rootPitchClass: number;
  readonly quality: ChordQualityId;
  /**
   * The octave the reader is working in, scientific pitch notation — 4 is the
   * octave that holds middle C. It is a choice, not a default hidden in here.
   */
  readonly octave: number;
  /** Power chords only: the octave above the root, as in the fretted search. */
  readonly withOctave?: boolean;
};

/** The lowest and highest pitch the Song Contract can write down at all. */
export function representablePitchRange(): { lowMidi: number; highMidi: number } {
  return { lowMidi: keyboardVoicingLimits.lowestMidi, highMidi: keyboardVoicingLimits.highestMidi };
}

function isWritable(midi: number): boolean {
  if (midi < keyboardVoicingLimits.lowestMidi) return false;
  if (midi > keyboardVoicingLimits.highestMidi) return false;
  // The written form has to survive a round trip through the schema's pattern.
  return PITCH_PATTERN.test(midiToPitch(midi));
}

/**
 * The chord in root position, in the octave the reader chose.
 *
 * Each tone is placed at or above the one before it, so the stack is always
 * ascending and a chord that crosses an octave boundary keeps its shape rather
 * than folding back on itself.
 */
function rootPosition(request: KeyboardVoicingRequest): number[] | null {
  const root = normalizePitchClass(request.rootPitchClass);
  const rootMidi = pitchToMidi(`${ROOT_SHORT_LABELS[root]}${request.octave}`);
  if (rootMidi === null) return null;

  const tones = chordPitchClasses(root, request.quality);
  const stack: number[] = [];
  let previous = rootMidi - 1;
  for (const tone of tones) {
    let midi = rootMidi + normalizePitchClass(tone - root);
    while (midi <= previous) midi += 12;
    stack.push(midi);
    previous = midi;
  }
  if (request.quality === "power" && request.withOctave === true) {
    stack.push(rootMidi + 12);
  }
  return stack;
}

/**
 * Root position and every inversion of it.
 *
 * An inversion takes the lowest note and lifts it an octave, which is what an
 * inversion is. A stack that climbs past the window the reader is working in
 * is dropped rather than quietly folded back down.
 */
export function keyboardCandidates(
  request: KeyboardVoicingRequest,
): KeyboardVoicing[] {
  const base = rootPosition(request);
  if (!base || base.length === 0) return [];

  const ceiling =
    (base[0] ?? 0) + keyboardVoicingLimits.registerSpanSemitones;
  const voicings: KeyboardVoicing[] = [];
  let stack = [...base];

  /*
   * A power chord has no inversions here, for the same reason it has none on
   * a fretboard: root and fifth is a shape, and putting the fifth underneath
   * makes it a different sound with the same name. Inverting the three-note
   * form would also stack the root on top of itself, which the Song Contract
   * would carry as two identical notes on one onset.
   */
  const inversions = request.quality === "power" ? 1 : base.length;

  for (let inversion = 0; inversion < inversions; inversion += 1) {
    if (inversion > 0) {
      const lowest = stack[0];
      if (lowest === undefined) break;
      stack = [...stack.slice(1), lowest + 12];
    }
    if (stack.some((midi) => !isWritable(midi))) continue;
    if (stack.some((midi) => midi > ceiling)) continue;

    const pitches = stack.map(midiToPitch);
    voicings.push({
      id: `inv${inversion}`,
      inversion,
      pitches,
      midi: [...stack],
      bassPitch: pitches[0] ?? "",
    });
  }

  return voicings;
}

/** What a reader is shown, at most the central maximum. */
export function selectKeyboardVoicings(
  request: KeyboardVoicingRequest,
): KeyboardVoicing[] {
  return keyboardCandidates(request).slice(0, keyboardVoicingLimits.maxVariations);
}

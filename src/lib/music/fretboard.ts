/**
 * Tuning, capo and capo-relative fret semantics (spec 9.1).
 *
 *   position.fret : 0..(MAX_PHYSICAL_FRET - capo)
 *   soundingPitch = tuning[string] + capo + position.fret
 *   physicalFret  = capo + position.fret
 *
 * fret 0 means the open sound behind the capo, not the open string.
 * position.string is 0-based and counted from the thickest string upward, so
 * tuning[0] is string 0.
 */
import { pitchToMidi } from "@/lib/music/pitch";

export const MAX_PHYSICAL_FRET = 24;
export const MAX_CAPO = 12;

export type Position = { string: number; fret: number };

export type Fretboard = { tuning: readonly string[]; capo: number };

export type TuningPreset = {
  id: string;
  displayName: string;
  /** Thickest string first. */
  tuning: readonly string[];
};

/** Core tuning presets (spec 9.1). Further presets open up in phase 2.5. */
export const TUNING_PRESETS: Readonly<Record<string, TuningPreset>> = {
  e_standard: {
    id: "e_standard",
    displayName: "E Standard",
    tuning: ["E2", "A2", "D3", "G3", "B3", "E4"],
  },
  drop_d: {
    id: "drop_d",
    displayName: "Drop D",
    tuning: ["D2", "A2", "D3", "G3", "B3", "E4"],
  },
  bass_standard: {
    id: "bass_standard",
    displayName: "Bass E Standard",
    tuning: ["E1", "A1", "D2", "G2"],
  },
};

/** Highest capo-relative fret number that can be written for this capo. */
export function maxCapoRelativeFret(capo: number): number {
  return MAX_PHYSICAL_FRET - capo;
}

/** Physical fret actually pressed, counted from the nut. */
export function physicalFret(capo: number, fret: number): number {
  return capo + fret;
}

/** MIDI number a position sounds, or null when the position is not playable. */
export function soundingMidi(
  fretboard: Fretboard,
  position: Position,
): number | null {
  if (!Number.isInteger(position.string) || !Number.isInteger(position.fret)) {
    return null;
  }
  if (position.string < 0 || position.string >= fretboard.tuning.length) {
    return null;
  }
  if (position.fret < 0 || position.fret > maxCapoRelativeFret(fretboard.capo)) {
    return null;
  }
  const openString = fretboard.tuning[position.string];
  if (openString === undefined) return null;
  const openMidi = pitchToMidi(openString);
  if (openMidi === null) return null;
  return openMidi + fretboard.capo + position.fret;
}

/** True when the position exists on this fretboard with this capo. */
export function isPlayablePosition(
  fretboard: Fretboard,
  position: Position,
): boolean {
  return soundingMidi(fretboard, position) !== null;
}

/** Lowest and highest MIDI note reachable on a fretboard (spec 9.1 bounds). */
export function fretboardRange(
  fretboard: Fretboard,
): { lowMidi: number; highMidi: number } | null {
  const lowestString = fretboard.tuning[0];
  const highestString = fretboard.tuning[fretboard.tuning.length - 1];
  if (lowestString === undefined || highestString === undefined) return null;
  const lowMidi = pitchToMidi(lowestString);
  const highMidi = pitchToMidi(highestString);
  if (lowMidi === null || highMidi === null) return null;
  return {
    lowMidi: lowMidi + fretboard.capo,
    highMidi: highMidi + MAX_PHYSICAL_FRET,
  };
}

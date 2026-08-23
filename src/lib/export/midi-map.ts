/**
 * The one place this app's vocabulary meets General MIDI (spec 13.19, 2M-A §10).
 *
 * Every number a `.mid` file carries about *what* something sounds like lives
 * here: which GM program stands in for an instrument, which percussion note
 * stands in for a drum piece, and how a track's persisted level and stereo
 * position become CC7 and CC10. Nothing in a component, a scheduler or the
 * writer may hold one of these numbers.
 *
 * **Program numbers are 0-based here**, which is what the MIDI byte on the
 * wire is, and is one less than the 1-based number a DAW's instrument list
 * prints. `29` below is "Overdriven Guitar", shown as *30* in most software.
 * Stating it once, in the type, is the whole reason this file exists.
 *
 * An instrument the table does not know is a typed refusal, never a silent
 * fallback: a bass exported as a piano is a worse answer than an export that
 * says what it cannot do.
 */
import { DRUM_PIECES, type DrumPiece } from "@/lib/instruments/registry";
import { mixerLimits } from "@/lib/limits";

/** GM channel 10, counted from zero as the protocol does. */
export const MIDI_DRUM_CHANNEL = 9;

/** The controller numbers this export writes, named rather than inlined. */
export const MIDI_CC = { volume: 7, pan: 10 } as const;

/** The range every MIDI data byte lives in. */
export const MIDI_DATA_RANGE = { min: 0, max: 127 } as const;

/**
 * Instrument id → General MIDI program, 0-based.
 *
 * The *instrument* is mapped, not the preset: GM has no way to say "high gain
 * versus clean" that another program would honour, and a file that claimed to
 * would be lying about what it carries. Which is why the sheet says the
 * instrument sound does not travel.
 */
export const MIDI_PROGRAMS: Readonly<Record<string, number>> = {
  electric_guitar: 29, // Overdriven Guitar
  steel_acoustic: 25, // Acoustic Guitar (steel)
  nylon_guitar: 24, // Acoustic Guitar (nylon)
  electric_bass: 33, // Electric Bass (finger)
  piano: 0, // Acoustic Grand Piano
  electric_piano: 4, // Electric Piano 1
  organ: 16, // Drawbar Organ
  strings: 48, // String Ensemble 1
  synth: 80, // Lead 1 (square)
};

/**
 * Drum piece → General MIDI percussion note.
 *
 * Kick, snare, the three hats/cymbals and the three toms all keep their own
 * note, so a kit that arrives in a DAW still reads as a kit rather than as a
 * row of identical hits.
 */
export const MIDI_DRUM_NOTES: Readonly<Record<DrumPiece, number>> = {
  kick: 36, // Bass Drum 1
  snare: 38, // Acoustic Snare
  closed_hat: 42, // Closed Hi-Hat
  open_hat: 46, // Open Hi-Hat
  ride: 51, // Ride Cymbal 1
  crash: 49, // Crash Cymbal 1
  china: 52, // Chinese Cymbal
  tom_high: 50, // High Tom
  tom_mid: 47, // Low-Mid Tom
  tom_floor: 41, // Low Floor Tom
};

export type MidiMapErrorCode = "midi_instrument_unsupported" | "midi_drum_unsupported";

export type MidiProgramResult =
  | { readonly ok: true; readonly program: number }
  | { readonly ok: false; readonly code: MidiMapErrorCode; readonly detail: string };

/** The program for an instrument, or a typed refusal naming what was missing. */
export function midiProgramFor(instrumentId: string): MidiProgramResult {
  const program = MIDI_PROGRAMS[instrumentId];
  if (program === undefined) {
    return {
      ok: false,
      code: "midi_instrument_unsupported",
      detail: instrumentId,
    };
  }
  return { ok: true, program };
}

/** The percussion note for a drum piece, or a typed refusal. */
export function midiDrumNoteFor(piece: string): MidiProgramResult {
  const note = (MIDI_DRUM_NOTES as Record<string, number>)[piece];
  if (note === undefined) {
    return { ok: false, code: "midi_drum_unsupported", detail: piece };
  }
  return { ok: true, program: note };
}

/** Every drum piece the contract has is mapped — asserted, not assumed. */
export const MAPPED_DRUM_PIECES: readonly DrumPiece[] = DRUM_PIECES;

const clampData = (value: number) =>
  Math.min(MIDI_DATA_RANGE.max, Math.max(MIDI_DATA_RANGE.min, value));

/**
 * A track's level as CC7.
 *
 * MIDI volume is not decibels, and pretending otherwise is how exports end up
 * quietly twice as loud as the project. The mapping is the one the MIDI spec
 * itself documents — CC7 is an amplitude ratio, `(value/127)` — inverted, so
 * a track at 0 dB arrives at 127 and one at −6 dB arrives at about half
 * amplitude. Clamping happens only at MIDI's own 0–127 wall: the Song keeps
 * whatever it had, and the mixer's own −24…+6 dB range is a separate
 * question this function does not re-litigate.
 */
export function volumeDbToCc7(volumeDb: number): number {
  if (!Number.isFinite(volumeDb)) return MIDI_DATA_RANGE.max;
  const amplitude = 10 ** (volumeDb / 20);
  return clampData(Math.round(amplitude * MIDI_DATA_RANGE.max));
}

/**
 * A track's stereo position as CC10.
 *
 * −1 → 0 (hard left), 0 → 64 (the centre every sequencer agrees on), +1 → 127.
 * 64 rather than 63.5 rounded: centre has to be exact, because a mix that
 * drifts one step left every export is a bug nobody can see.
 */
export function panToCc10(pan: number): number {
  if (!Number.isFinite(pan)) return 64;
  const clamped = Math.min(
    mixerLimits.pan.max,
    Math.max(mixerLimits.pan.min, pan),
  );
  if (clamped === mixerLimits.pan.center) return 64;
  return clampData(Math.round(64 + clamped * 63));
}

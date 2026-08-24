/**
 * One door onto both searches (spec 13.22 §7, 2O-B).
 *
 * A track either has a fretboard or it does not, and that single fact —
 * already the authority everywhere else in the app, from `isEditableTrack` to
 * the range validator — decides which search answers. Nothing here keeps a
 * list of instrument names: a list would be a second registry, and it would be
 * wrong the first time the real one gained an entry.
 */
import { chordFail, type ChordFailure } from "@/lib/chords/chord-errors";
import {
  isChordQualityId,
  isPitchClass,
  type ChordQualityId,
} from "@/lib/chords/chord-formula";
import {
  selectFrettedVoicings,
  type FrettedVoicing,
} from "@/lib/chords/fretted-voicing";
import {
  selectKeyboardVoicings,
  type KeyboardVoicing,
} from "@/lib/chords/keyboard-voicing";
import { isDrumInstrument } from "@/lib/instruments/registry";
import { midiToPitch } from "@/lib/music/pitch";
import type { NoteEvent, Track } from "@/lib/song/schema";

/** A shape a reader can choose, whichever kind of instrument it is for. */
export type ChordVoicing =
  | { readonly kind: "fretted"; readonly id: string; readonly shape: FrettedVoicing }
  | { readonly kind: "keyboard"; readonly id: string; readonly stack: KeyboardVoicing };

export type ChordVoicingRequest = {
  readonly track: Track;
  readonly rootPitchClass: number;
  readonly quality: ChordQualityId;
  /** Fretted: where on the neck the reader is looking, in physical frets. */
  readonly anchorFret?: number;
  /** Non-fretted: the octave the reader is working in. */
  readonly octave?: number;
  /** Power chords: root and fifth, or root, fifth and the octave above. */
  readonly withOctave?: boolean;
};

export type ChordVoicingResult =
  | { readonly ok: true; readonly voicings: readonly ChordVoicing[] }
  | { readonly ok: false; readonly error: ChordFailure };

/** Whether this track can carry a chord at all, asked of the track itself. */
export function isHarmonicTrack(track: Track): boolean {
  return !isDrumInstrument(track.instrumentId);
}

/** The octave a keyboard chord lands in when the reader has not said. */
export const DEFAULT_KEYBOARD_OCTAVE = 4;

export function chordVoicings(request: ChordVoicingRequest): ChordVoicingResult {
  const { track } = request;
  if (!isHarmonicTrack(track)) return chordFail("instrument_not_harmonic");
  if (!isPitchClass(request.rootPitchClass)) return chordFail("invalid_chord_root");
  if (!isChordQualityId(request.quality)) return chordFail("unsupported_chord_quality");

  if (track.fretboard) {
    const shapes = selectFrettedVoicings({
      fretboard: track.fretboard,
      rootPitchClass: request.rootPitchClass,
      quality: request.quality,
      ...(request.anchorFret === undefined ? {} : { anchorFret: request.anchorFret }),
      ...(request.withOctave === undefined ? {} : { withOctave: request.withOctave }),
    });
    if (shapes.length === 0) return chordFail("no_playable_voicing");
    return {
      ok: true,
      voicings: shapes.map((shape) => ({ kind: "fretted", id: shape.id, shape })),
    };
  }

  const stacks = selectKeyboardVoicings({
    rootPitchClass: request.rootPitchClass,
    quality: request.quality,
    octave: request.octave ?? DEFAULT_KEYBOARD_OCTAVE,
    ...(request.withOctave === undefined ? {} : { withOctave: request.withOctave }),
  });
  if (stacks.length === 0) return chordFail("voicing_out_of_range");
  return {
    ok: true,
    voicings: stacks.map((stack) => ({ kind: "keyboard", id: stack.id, stack })),
  };
}

/**
 * The notes a chosen shape becomes.
 *
 * This is where a voicing stops being a candidate and becomes music. A fretted
 * shape carries its string and fret, because that is how it is played and how
 * the tab draws it; a keyboard stack carries pitch alone, because there is no
 * string to name. The velocity and articulation are the whole chord's — one
 * chord, one way of being played.
 *
 * Notes come back in string order for a fretboard and ascending pitch order
 * for a stack, which is the order both are read in.
 */
export function voicingToNotes(
  voicing: ChordVoicing,
  options: {
    readonly velocity?: number;
    readonly articulation?: NoteEvent["articulation"];
  } = {},
): NoteEvent[] {
  const dress = (note: NoteEvent): NoteEvent => ({
    ...note,
    ...(options.velocity === undefined ? {} : { velocity: options.velocity }),
    // "Normal" is never written: an absent field and a normal note are the
    // same note (spec 5.4), and the whole app agrees about that.
    ...(options.articulation === undefined || options.articulation === "normal"
      ? {}
      : { articulation: options.articulation }),
  });

  if (voicing.kind === "keyboard") {
    return voicing.stack.midi.map((midi) => dress({ pitch: midiToPitch(midi) }));
  }

  return voicing.shape.strings.flatMap((entry, stringIndex) =>
    entry.kind === "played"
      ? [dress({ pitch: entry.pitch, position: { string: stringIndex, fret: entry.fret } })]
      : [],
  );
}

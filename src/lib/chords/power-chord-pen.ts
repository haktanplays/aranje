/**
 * The power chord pen (2S-A §7).
 *
 * The chord builder has always been able to write a power chord, and the
 * measurement of what that costs is in `eval/intent-composer/FINDINGS.md` §C:
 * five taps before a single note exists, and the root asked for **by name**
 * — `C`, `C♯ / D♭`, `D` — when the reader's finger is already on a string and
 * a fret. Somebody who does not read notation knows where their finger is;
 * they do not necessarily know what that note is called.
 *
 * So the pen turns the question round. The reader touches a string and a fret;
 * that is the root, and it is the lowest sounding note of the shape. Nothing
 * else about the harmony is asked.
 *
 * ## What is *not* new here
 *
 * Almost everything. The shapes come from `frettedCandidates`, which is the
 * same search the chord builder uses and the only place that knows what a
 * fretboard can reach. The write goes through `applyChordWrite`, which is the
 * same command the builder commits, with the same refusals about ties, mixed
 * onsets and linked notes. A power chord is not a new object in the Song
 * Contract: it is notes in one slot, exactly as it has always been.
 *
 * What this module adds is one constraint — **the root is where the finger
 * is** — and the arithmetic to express it.
 */
import { applyChordWrite, type ChordWriteResult } from "@/lib/chords/chord-command";
import { chordFail } from "@/lib/chords/chord-errors";
import { frettedCandidates, type FrettedVoicing } from "@/lib/chords/fretted-voicing";
import { isHarmonicTrack } from "@/lib/chords/chord-voicing";
import { DEFAULT_VELOCITY } from "@/lib/audio/schedule";
import {
  physicalFret,
  soundingMidi,
  type Fretboard,
} from "@/lib/music/fretboard";
import type { Song, Track } from "@/lib/song/schema";

/** How many voices the pen writes. Two is root and fifth; three adds the octave. */
export type PowerChordVoices = 2 | 3;

export type PowerChordPenRequest = {
  readonly song: Song;
  readonly track: Track;
  readonly sectionId: string;
  /** Ticks from the start of the section: the moment, not a slot number. */
  readonly timeTicks: number;
  readonly durationTicks: number;
  /** Where the finger is. The root of the chord, and its lowest note. */
  readonly stringIndex: number;
  /** Capo-relative, exactly as it is written into a Song (spec 9.1). */
  readonly fret: number;
  readonly voices: PowerChordVoices;
  /**
   * `insert` needs an empty beat. `replace_onset` says out loud that what is
   * there is going. There is no mode that decides for itself (2S-A §7).
   */
  readonly mode: "insert" | "replace_onset";
  /** Absent means the engine's own default, the same one a typed note gets. */
  readonly velocity?: number;
};

export type PowerChordPenResult =
  | (Extract<ChordWriteResult, { ok: true }> & {
      /** The shape that was written, so a preview can draw exactly it. */
      readonly voicing: FrettedVoicing;
      /** The lowest sounding note, which is the note the finger was on. */
      readonly rootPitch: string;
    })
  | Extract<ChordWriteResult, { ok: false }>;

/**
 * The shape whose lowest note is the one under the finger.
 *
 * Every candidate the search offers is a real shape; this picks the ones that
 * are *this* reader's shape. The comparison is on the sounding note rather
 * than on the string index alone, because two strings can carry the same note
 * and only one of them is where the finger is.
 */
export function shapesRootedAt(
  fretboard: Fretboard,
  stringIndex: number,
  fret: number,
  voices: PowerChordVoices,
): FrettedVoicing[] {
  const rootMidi = soundingMidi(fretboard, { string: stringIndex, fret });
  if (rootMidi === null) return [];

  const candidates = frettedCandidates({
    fretboard,
    rootPitchClass: ((rootMidi % 12) + 12) % 12,
    quality: "power",
    anchorFret: physicalFret(fretboard.capo, fret),
    withOctave: voices === 3,
  });

  return candidates.filter((shape) => {
    const spot = shape.strings[stringIndex];
    if (!spot || spot.kind !== "played" || spot.fret !== fret) return false;
    // The finger is on the *lowest* note: a shape that puts something under
    // it is a different chord, whatever its pitch classes are.
    return shape.strings.every(
      (entry, index) =>
        entry.kind === "muted" || index >= stringIndex || entry.midi > spot.midi,
    );
  });
}

/**
 * Write a power chord rooted where the finger is.
 *
 * Pure: it takes a Song and gives back another one, and the input is never
 * touched. The preview and the commit call exactly this, which is what makes
 * "the ghost is the real command's real result" a fact rather than an
 * intention (2S-A §7).
 */
export function writePowerChord(
  request: PowerChordPenRequest,
): PowerChordPenResult {
  const { track } = request;

  if (!isHarmonicTrack(track)) return chordFail("instrument_not_harmonic");
  // A shape is a claim about frets. A harmonic instrument without a fretboard
  // gets told so rather than shown an invented one.
  if (!track.fretboard) return chordFail("power_chord_needs_fretboard");

  const shapes = shapesRootedAt(
    track.fretboard,
    request.stringIndex,
    request.fret,
    request.voices,
  );
  const voicing = shapes[0];
  if (!voicing) return chordFail("power_chord_root_unreachable");

  const written = applyChordWrite(request.song, {
    sectionId: request.sectionId,
    trackId: track.id,
    timeTicks: request.timeTicks,
    durationTicks: request.durationTicks,
    voicing: { kind: "fretted", id: voicing.id, shape: voicing },
    velocity: request.velocity ?? DEFAULT_VELOCITY,
    mode: request.mode,
  });

  if (!written.ok) return written;
  return { ...written, voicing, rootPitch: voicing.bassPitch };
}

/**
 * The songs the launch-audio and headroom work is measured against
 * (2O-B.1 §4, §5).
 *
 * Fixtures only. Nothing here is imported by the app, and every instrument
 * comes from the registry's own presets and tunings rather than being typed
 * out again, so a fixture cannot quietly disagree with the track a reader
 * would really get.
 */
import { applyChordWrite } from "@/lib/chords/chord-command";
import { chordVoicings, voicingToNotes } from "@/lib/chords/chord-voicing";
import { isDrumInstrument } from "@/lib/instruments/registry";
import { TUNING_PRESETS } from "@/lib/music/fretboard";
import { ticksPerSlot } from "@/lib/music/timing";
import type { ChordQualityId } from "@/lib/chords/chord-formula";
import type {
  Bar,
  DrumSlot,
  MelodicSlot,
  Section,
  Song,
  Track,
} from "@/lib/song/schema";

const E_STANDARD = TUNING_PRESETS.e_standard!.tuning;
const BASS_STANDARD = TUNING_PRESETS.bass_standard!.tuning;

const HALF = ticksPerSlot(8) * 4;

export const guitar = (overrides: Partial<Track> = {}): Track => ({
  id: "gtr",
  name: "Ritim Gitar",
  instrumentId: "electric_guitar",
  presetId: "high_gain",
  volumeDb: -6,
  fretboard: { tuning: [...E_STANDARD], capo: 0 },
  ...overrides,
});

export const bass = (overrides: Partial<Track> = {}): Track => ({
  id: "bass",
  name: "Bas",
  instrumentId: "electric_bass",
  presetId: "finger",
  volumeDb: -6,
  fretboard: { tuning: [...BASS_STANDARD], capo: 0 },
  ...overrides,
});

export const drums = (overrides: Partial<Track> = {}): Track => ({
  id: "drums",
  name: "Davul",
  instrumentId: "drum_kit",
  presetId: "rock",
  volumeDb: -6,
  ...overrides,
});

/**
 * A guitar on a preset with no vendored samples.
 *
 * Not a hypothetical: it is what every launch template handed a new reader
 * before this checkpoint, and it is the fixture that proves a missing pack is
 * now a typed state rather than a silent success.
 */
export const silentGuitar = (): Track =>
  guitar({ presetId: "clean", name: "Sessiz Gitar" });

/**
 * An empty bar for these tracks.
 *
 * A drum track's empty slot is an empty *hit list*, not `null`: the two slot
 * shapes are different things and mixing them is a hard validator error
 * (spec 5.4, `drumVocab`). Which shape a track gets is asked of the registry
 * rather than decided by whoever writes the fixture.
 */
const emptyBar = (tracks: readonly Track[], resolution = 8): Bar => {
  const slots: Bar["slots"] = {};
  for (const track of tracks) {
    slots[track.id] = isDrumInstrument(track.instrumentId)
      ? Array.from({ length: resolution }, (): DrumSlot => [])
      : Array.from({ length: resolution }, (): MelodicSlot => null);
  }
  return {
    timeSignature: [4, 4],
    resolution: resolution as Bar["resolution"],
    slots,
  };
};

const section = (tracks: readonly Track[], bars = 1): Section => ({
  id: "s1",
  name: "Bölüm 1",
  status: "fixed",
  bars: Array.from({ length: bars }, () => emptyBar(tracks)),
});

export const songOf = (tracks: readonly Track[], bars = 1): Song => ({
  version: 2,
  title: "Akor Ses Testi",
  bpm: 120,
  key: "E minor",
  tracks: [...tracks],
  sections: [section(tracks, bars)],
});

/** One chord on one track, through the production write command. */
export function chordOn(
  track: Track,
  options: {
    root: number;
    quality: ChordQualityId;
    withOctave?: boolean;
    voicingIndex?: number;
    velocity?: number;
  },
  extraTracks: readonly Track[] = [],
): Song {
  const base = songOf([track, ...extraTracks]);
  const found = chordVoicings({
    track,
    rootPitchClass: options.root,
    quality: options.quality,
    ...(options.withOctave === undefined ? {} : { withOctave: options.withOctave }),
  });
  if (!found.ok) throw new Error(`no voicing: ${options.root}/${options.quality}`);
  const voicing = found.voicings[options.voicingIndex ?? 0];
  if (!voicing) throw new Error(`no voicing at index ${options.voicingIndex ?? 0}`);

  const written = applyChordWrite(base, {
    sectionId: "s1",
    trackId: track.id,
    timeTicks: 0,
    durationTicks: HALF,
    voicing,
    velocity: options.velocity ?? 100,
    mode: "insert",
  });
  if (!written.ok) throw new Error(`refused: ${written.error.code}`);
  return written.song;
}

/** How many notes a voicing turns into, without rendering it. */
export function voicingNoteCount(
  track: Track,
  root: number,
  quality: ChordQualityId,
  options: { withOctave?: boolean; voicingIndex?: number } = {},
): number {
  const found = chordVoicings({
    track,
    rootPitchClass: root,
    quality,
    ...(options.withOctave === undefined ? {} : { withOctave: options.withOctave }),
  });
  if (!found.ok) return 0;
  const voicing = found.voicings[options.voicingIndex ?? 0];
  // Through the same door the write command uses, so the count is the number
  // of note events that will actually sound.
  return voicing ? voicingToNotes(voicing).length : 0;
}

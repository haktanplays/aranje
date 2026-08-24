/**
 * The instruments, tunings and songs the chord work is measured against
 * (2O-B §1).
 *
 * Fixtures only — no production code lives here, and nothing here is imported
 * by the app. Every tuning comes from the registry's own presets rather than
 * being typed out again, so a fixture cannot quietly disagree with the
 * instrument a reader would really get.
 */
import { TUNING_PRESETS } from "@/lib/music/fretboard";
import type { Bar, Section, Song, Track } from "@/lib/song/schema";

const E_STANDARD = TUNING_PRESETS.e_standard!.tuning;
const DROP_D = TUNING_PRESETS.drop_d!.tuning;
const BASS_STANDARD = TUNING_PRESETS.bass_standard!.tuning;

/** DADGAD: a real alternate tuning, and deliberately not one of the presets. */
export const DADGAD = ["D2", "A2", "D3", "G3", "A3", "D4"] as const;

export const guitar = (overrides: Partial<Track> = {}): Track => ({
  id: "gtr",
  name: "Gitar",
  instrumentId: "electric_guitar",
  presetId: "clean",
  volumeDb: -6,
  fretboard: { tuning: [...E_STANDARD], capo: 0 },
  ...overrides,
});

export const dropDGuitar = (): Track =>
  guitar({ fretboard: { tuning: [...DROP_D], capo: 0 } });

export const capoGuitar = (capo = 2): Track =>
  guitar({ fretboard: { tuning: [...E_STANDARD], capo } });

export const dadgadGuitar = (): Track =>
  guitar({ fretboard: { tuning: [...DADGAD], capo: 0 } });

export const acoustic = (): Track =>
  guitar({
    id: "ac",
    name: "Akustik",
    instrumentId: "steel_acoustic",
    presetId: "finger",
  });

export const bass = (): Track => ({
  id: "bass",
  name: "Bas",
  instrumentId: "electric_bass",
  presetId: "finger",
  volumeDb: -6,
  fretboard: { tuning: [...BASS_STANDARD], capo: 0 },
});

/**
 * A pitched instrument with no fretboard.
 *
 * These are `phase_2_5` in the registry and carry no sample pack, so a fixture
 * that uses one is measuring the *writing* path, never the sound. Recorded
 * here so that stays visible wherever one of them appears.
 */
export const keyboard = (instrumentId: string, presetId: string): Track => ({
  id: instrumentId,
  name: instrumentId,
  instrumentId,
  presetId,
  volumeDb: -6,
});

export const piano = () => keyboard("piano", "grand");
export const electricPiano = () => keyboard("electric_piano", "soft");
export const organ = () => keyboard("organ", "rock");
export const synth = () => keyboard("synth", "lead");
export const stringsEnsemble = () => keyboard("strings", "sustain");
export const nylonGuitar = (): Track =>
  guitar({ id: "nylon", name: "Klasik", instrumentId: "nylon_guitar", presetId: "warm" });
export const drums = (): Track => ({
  id: "drums",
  name: "Davul",
  instrumentId: "drum_kit",
  presetId: "rock",
  volumeDb: -6,
});

/** An empty 4/4 bar at the default grid, with a slot list per track. */
export const emptyBar = (trackIds: readonly string[], resolution = 8): Bar => ({
  timeSignature: [4, 4],
  resolution: resolution as Bar["resolution"],
  slots: Object.fromEntries(
    trackIds.map((id) => [id, Array.from({ length: resolution }, () => null)]),
  ),
});

export const section = (
  trackIds: readonly string[],
  bars = 1,
  resolution = 8,
): Section => ({
  id: "s1",
  name: "Bölüm 1",
  status: "fixed",
  bars: Array.from({ length: bars }, () => emptyBar(trackIds, resolution)),
});

export const songOf = (tracks: readonly Track[], bars = 1, resolution = 8): Song => ({
  version: 2,
  title: "Akor Testi",
  bpm: 120,
  key: "E minor",
  tracks: [...tracks],
  sections: [section(tracks.map((track) => track.id), bars, resolution)],
});

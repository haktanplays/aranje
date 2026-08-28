import { SONG_VERSION } from "@/lib/song/schema";
/**
 * Small song builders used by the unit tests. Kept out of the app code path;
 * nothing in src/app or src/components imports this file.
 */
import type {
  Bar,
  DrumSlot,
  MelodicSlot,
  Section,
  Song,
  Track,
} from "@/lib/song/schema";

export function melodicBar(
  trackId: string,
  slots: readonly MelodicSlot[],
  overrides: Partial<Omit<Bar, "slots">> = {},
): Bar {
  return {
    timeSignature: [4, 4],
    resolution: 8,
    ...overrides,
    slots: { [trackId]: [...slots] },
  };
}

export function restSlots(count: number): MelodicSlot[] {
  return Array.from({ length: count }, () => null);
}

export function silentDrumSlots(count: number): DrumSlot[] {
  return Array.from({ length: count }, () => []);
}

export function guitarTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "gtr",
    name: "Gitar",
    instrumentId: "electric_guitar",
    presetId: "clean",
    volumeDb: -6,
    fretboard: { tuning: ["E2", "A2", "D3", "G3", "B3", "E4"], capo: 0 },
    ...overrides,
  };
}

export function drumTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: "drums",
    name: "Davul",
    instrumentId: "drum_kit",
    presetId: "rock",
    volumeDb: -4,
    ...overrides,
  };
}

export function section(bars: readonly Bar[], overrides: Partial<Section> = {}): Section {
  return {
    id: "s1",
    name: "Bölüm",
    status: "fixed",
    bars: [...bars],
    ...overrides,
  };
}

export function song(
  tracks: readonly Track[],
  sections: readonly Section[],
  overrides: Partial<Song> = {},
): Song {
  return {
    version: SONG_VERSION,
    title: "Test",
    bpm: 120,
    key: "E minor",
    tracks: [...tracks],
    sections: [...sections],
    ...overrides,
  };
}

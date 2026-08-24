/**
 * The songs the bend and slide benchmark measures (2P-A §10, §11).
 *
 * One guitar, one string at a time unless the fixture is about a chord.
 * Every pitch sits inside the vendored high-gain pack's range, because a
 * fixture that asks for a note the pack cannot play would be measuring the
 * sampler's interpolation rather than the gesture.
 */
import { TUNING_PRESETS } from "@/lib/music/fretboard";
import { ticksPerSlot } from "@/lib/music/timing";
import type { Bar, MelodicSlot, NoteEvent, Section, Song, Track } from "@/lib/song/schema";

const E_STANDARD = TUNING_PRESETS.e_standard!.tuning;

/** The preset that has samples. A silent fixture measures nothing. */
export const guitar = (overrides: Partial<Track> = {}): Track => ({
  id: "gtr",
  name: "Gitar",
  instrumentId: "electric_guitar",
  presetId: "high_gain",
  volumeDb: -6,
  fretboard: { tuning: [...E_STANDARD], capo: 0 },
  ...overrides,
});

export const SLOTS_PER_BAR = 8;
export const SLOT_TICKS = ticksPerSlot(SLOTS_PER_BAR);

export type SlotSpec = MelodicSlot;

/** One bar of a single melodic track, from a slot list written out in full. */
export function barOf(trackId: string, slots: readonly SlotSpec[]): Bar {
  return {
    timeSignature: [4, 4],
    resolution: SLOTS_PER_BAR,
    slots: { [trackId]: [...slots] },
  };
}

export function songOf(track: Track, bars: readonly Bar[], bpm = 90): Song {
  const section: Section = {
    id: "s1",
    name: "Bölüm 1",
    status: "fixed",
    bars: [...bars],
  };
  return {
    version: 2,
    title: "Expression Benchmark",
    bpm,
    key: "E minor",
    tracks: [track],
    sections: [section],
  };
}

export const note = (
  pitch: string,
  string: number,
  fret: number,
  extra: Partial<NoteEvent> = {},
): NoteEvent => ({ pitch, velocity: 100, position: { string, fret }, ...extra });

export const struck = (...notes: NoteEvent[]): SlotSpec => ({ notes });
export const rest: SlotSpec = null;
export const tie: SlotSpec = "-";

/**
 * Fill the rest of a bar with ties so one note lasts the whole thing.
 *
 * Written out rather than implied: a tie is a real slot in this contract and
 * a fixture that left them out would be measuring a much shorter note than
 * its name claims.
 */
export function held(first: SlotSpec, count: number): SlotSpec[] {
  return [first, ...Array.from({ length: count - 1 }, () => tie)];
}

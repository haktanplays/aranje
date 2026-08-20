/**
 * The one place ticks become seconds (spec 8.3, K-25).
 */
import { describe, expect, it } from "vitest";

import {
  buildTempoMap,
  durationSeconds,
  hasTempoChanges,
  secondsAtTicks,
  secondsPerTickAt,
  sectionBpm,
  sectionStartSeconds,
  songDurationSeconds,
  tempoAtTicks,
  ticksAtSeconds,
} from "@/lib/audio/tempo";
import { PPQ } from "@/lib/audio/schedule";
import { songSchema, type Bar, type Section, type Song } from "@/lib/song/schema";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const GUITAR = SAMPLE_SONG.tracks.find((t) => t.id === "gtr");
if (!GUITAR) throw new Error("no guitar");

/** One 4/4 bar of rests at eighths: 8 slots, 768 ticks. */
const bar = (): Bar => ({
  timeSignature: [4, 4],
  resolution: 8,
  slots: { gtr: Array.from({ length: 8 }, () => null) },
});

const BAR_TICKS = PPQ * 4;

function song(sections: { id: string; bars: number; bpm?: number }[]): Song {
  const parsed = songSchema.safeParse({
    version: 2,
    title: "tempo fixture",
    bpm: 120,
    key: "E minor",
    tracks: [GUITAR],
    sections: sections.map(
      (s): Section => ({
        id: s.id,
        name: s.id.toUpperCase(),
        status: "fixed",
        ...(s.bpm === undefined ? {} : { bpmOverride: s.bpm }),
        bars: Array.from({ length: s.bars }, bar),
      }),
    ),
  });
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

describe("a song at one tempo", () => {
  const flat = song([{ id: "a", bars: 2 }, { id: "b", bars: 2 }]);

  it("has one segment per section, all at the song's own tempo", () => {
    const map = buildTempoMap(flat);
    expect(map.segments).toHaveLength(2);
    expect(map.segments.every((s) => s.bpm === 120)).toBe(true);
    expect(hasTempoChanges(flat)).toBe(false);
  });

  it("is exactly as long as the arithmetic says", () => {
    // 4 bars of 4/4 at 120 = 16 beats = 8 seconds.
    expect(songDurationSeconds(flat)).toBeCloseTo(8, 9);
  });

  it("converts a tick the same way the old global formula did", () => {
    const map = buildTempoMap(flat);
    const perTick = 60 / (120 * PPQ);
    for (const ticks of [0, 100, BAR_TICKS, BAR_TICKS * 3]) {
      expect(secondsAtTicks(map, ticks)).toBeCloseTo(ticks * perTick, 9);
    }
  });
});

describe("a song that changes tempo at a section line", () => {
  // 2 bars at 120 (4 s), then 2 bars at 60 (8 s).
  const stepped = song([
    { id: "fast", bars: 2 },
    { id: "slow", bars: 2, bpm: 60 },
  ]);
  const map = buildTempoMap(stepped);

  it("declares that it changes", () => {
    expect(hasTempoChanges(stepped)).toBe(true);
    expect(sectionBpm(stepped, "fast")).toBe(120);
    expect(sectionBpm(stepped, "slow")).toBe(60);
  });

  it("takes effect on the first tick of the section, not before it", () => {
    const boundary = BAR_TICKS * 2;
    expect(tempoAtTicks(map, boundary - 1)).toBe(120);
    expect(tempoAtTicks(map, boundary)).toBe(60);
  });

  it("times an onset either side of the boundary correctly", () => {
    const boundary = BAR_TICKS * 2;
    expect(secondsAtTicks(map, boundary)).toBeCloseTo(4, 9);
    // One tick before: still a 120bpm tick.
    expect(secondsAtTicks(map, boundary - PPQ)).toBeCloseTo(3.5, 9);
    // One quarter after: a 60bpm tick, so a whole second.
    expect(secondsAtTicks(map, boundary + PPQ)).toBeCloseTo(5, 9);
  });

  it("adds the two halves of a note held across the boundary", () => {
    const boundary = BAR_TICKS * 2;
    // A half note starting a quarter before the change: one quarter at 120
    // (0.5 s) plus one at 60 (1.0 s).
    const span = durationSeconds(map, boundary - PPQ, PPQ * 2);
    expect(span).toBeCloseTo(1.5, 9);
    // Not what a single-tempo reading would have said, either way.
    expect(span).not.toBeCloseTo((PPQ * 2 * 60) / (120 * PPQ), 6);
    expect(span).not.toBeCloseTo((PPQ * 2 * 60) / (60 * PPQ), 6);
  });

  it("puts each section's start where the clock actually reaches it", () => {
    expect(sectionStartSeconds(map, "fast")).toBeCloseTo(0, 9);
    expect(sectionStartSeconds(map, "slow")).toBeCloseTo(4, 9);
    expect(map.totalSeconds).toBeCloseTo(12, 9);
  });

  it("reads a clock back to the right tick", () => {
    for (const ticks of [0, PPQ, BAR_TICKS * 2, BAR_TICKS * 2 + PPQ * 3]) {
      expect(ticksAtSeconds(map, secondsAtTicks(map, ticks))).toBeCloseTo(ticks, 6);
    }
  });

  it("gives the right tick length on each side", () => {
    expect(secondsPerTickAt(map, 0)).toBeCloseTo(60 / (120 * PPQ), 12);
    expect(secondsPerTickAt(map, BAR_TICKS * 2)).toBeCloseTo(60 / (60 * PPQ), 12);
  });
});

describe("a section with no tempo of its own", () => {
  it("runs at the song's tempo, whatever the section before it did", () => {
    // The middle section is loud about its tempo; the last says nothing and
    // must go back to the song's own, not inherit 60.
    const mixed = song([
      { id: "a", bars: 1 },
      { id: "b", bars: 1, bpm: 60 },
      { id: "c", bars: 1 },
    ]);
    const map = buildTempoMap(mixed);
    expect(map.segments.map((s) => s.bpm)).toEqual([120, 60, 120]);
  });
});

describe("practice rate scales the whole map", () => {
  const stepped = song([
    { id: "fast", bars: 2 },
    { id: "slow", bars: 2, bpm: 60 },
  ]);

  it("halves every section at 50% and leaves the written tempo alone", () => {
    const map = buildTempoMap(stepped, 50);
    expect(map.segments.map((s) => s.bpm)).toEqual([60, 30]);
    expect(map.segments.map((s) => s.writtenBpm)).toEqual([120, 60]);
    expect(map.totalSeconds).toBeCloseTo(24, 9);
  });

  it("speeds every section up at 150%", () => {
    const map = buildTempoMap(stepped, 150);
    expect(map.segments.map((s) => s.bpm)).toEqual([180, 90]);
    expect(map.totalSeconds).toBeCloseTo(8, 9);
  });

  it("keeps the ratio between sections, whatever the speed", () => {
    for (const percent of [50, 100, 150]) {
      const map = buildTempoMap(stepped, percent);
      const [a, b] = map.segments;
      expect((a?.bpm ?? 0) / (b?.bpm ?? 1)).toBeCloseTo(2, 9);
    }
  });

  it("does not touch the song", () => {
    const before = JSON.stringify(stepped);
    buildTempoMap(stepped, 50);
    buildTempoMap(stepped, 150);
    expect(JSON.stringify(stepped)).toBe(before);
  });
});

describe("the demo song still reads the way it always did", () => {
  it("has no tempo changes and one segment per section", () => {
    expect(hasTempoChanges(SAMPLE_SONG)).toBe(false);
    const map = buildTempoMap(SAMPLE_SONG);
    expect(map.segments).toHaveLength(SAMPLE_SONG.sections.length);
    expect(map.segments.every((s) => s.bpm === SAMPLE_SONG.bpm)).toBe(true);
  });

  it("is as long as dividing by the global tempo would have said", () => {
    const map = buildTempoMap(SAMPLE_SONG);
    const flat = (map.totalTicks / PPQ) * (60 / SAMPLE_SONG.bpm);
    expect(map.totalSeconds).toBeCloseTo(flat, 9);
  });
});

/**
 * Time across bars that do not share a grid (spec 5.5, 8.3, 8.5, K-34).
 *
 * Every one of these is the same question in a different place: when bar 1 is
 * 1/16 and bar 2 is 1/32, is the answer computed on ticks or on slot counts?
 * Slot counts are the tempting shortcut and they are wrong by exactly the
 * ratio between the two grids, which is a mistake that sounds like sloppy
 * playing rather than like a bug.
 *
 * Phase 2H-A found one of these already in the code: a note tied over a bar
 * line was scheduled for its first bar's worth only, in both the scheduler and
 * the expression planner. It never showed because both grids were the same
 * length and the sample rang on anyway.
 */
import { describe, expect, it } from "vitest";

import { buildSongPlan } from "@/lib/audio/schedule";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { buildTempoMap, secondsAtTicks, durationSeconds } from "@/lib/audio/tempo";
import { positionAtTicks } from "@/lib/audio/position";
import { PPQ, slotCount, ticksPerSlot, type Resolution } from "@/lib/music/timing";
import { songSchema, type Bar, type MelodicSlot, type Song } from "@/lib/song/schema";

const TIE = "-" as MelodicSlot;
const REST = null as unknown as MelodicSlot;

const note = (pitch: string, string: number, fret: number, articulation?: string) =>
  ({
    notes: [
      {
        pitch,
        position: { string, fret },
        ...(articulation === undefined ? {} : { articulation }),
      },
    ],
  }) as unknown as MelodicSlot;

/** One bar on one grid, filled out to its own slot count with rests. */
function bar(resolution: Resolution, written: readonly MelodicSlot[]): Bar {
  const count = slotCount([4, 4], resolution);
  if (written.length > count) throw new Error("more slots written than the bar has");
  return {
    timeSignature: [4, 4],
    resolution,
    slots: {
      gtr: [
        ...written,
        ...Array.from({ length: count - written.length }, () => REST),
      ],
    },
  };
}

/** A bar of pure tie: the sound carries straight through it. */
const held = (resolution: Resolution): Bar =>
  bar(
    resolution,
    Array.from({ length: slotCount([4, 4], resolution) }, () => TIE),
  );

function song(bars: readonly Bar[], bpmOverrides: Record<number, number> = {}): Song {
  const parsed = songSchema.safeParse({
    version: 2,
    title: "mixed grid",
    bpm: 120,
    key: "E minor",
    tracks: [
      {
        id: "gtr",
        name: "G",
        instrumentId: "electric_guitar",
        presetId: "clean",
        volumeDb: 0,
        fretboard: { tuning: ["E2", "A2", "D3", "G3", "B3", "E4"], capo: 0 },
      },
    ],
    // One bar per section, so a section tempo can be put on any of them.
    sections: bars.map((entry, index) => ({
      id: `s${index + 1}`,
      name: `S${index + 1}`,
      status: "fixed",
      ...(bpmOverrides[index] === undefined
        ? {}
        : { bpmOverride: bpmOverrides[index] }),
      bars: [entry],
    })),
  });
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

const noteEvents = (target: Song) =>
  buildSongPlan(target).events.filter((event) => event.kind === "note");

describe("a tie is one note, however many grids it crosses", () => {
  it("sums 1/16 and 1/32 on ticks rather than on slot counts", () => {
    // Struck halfway through a 1/16 bar, then a whole 1/32 bar of tie.
    const fixture = song([
      bar(16, [
        ...Array.from({ length: 8 }, () => REST),
        note("A3", 1, 12),
        ...Array.from({ length: 7 }, () => TIE),
      ]),
      held(32),
    ]);
    const events = noteEvents(fixture);
    expect(events).toHaveLength(1);

    // 8 slots at 48 ticks, then 32 slots at 24 ticks: 384 + 768 = 1152.
    const full = 8 * ticksPerSlot(16) + 32 * ticksPerSlot(32);
    expect(full).toBe(1152);
    // The slot-count shortcut would have said (8 + 32) × 48 = 1920.
    expect(events[0]?.durationTicks).toBe(Math.round(full * 0.92));
    expect(events[0]?.durationTicks).not.toBe(Math.round(40 * 48 * 0.92));
  });

  it("sums 1/32 and 1/16 triplets the same way", () => {
    const fixture = song([
      bar(32, [
        ...Array.from({ length: 16 }, () => REST),
        note("A3", 1, 12),
        ...Array.from({ length: 15 }, () => TIE),
      ]),
      held(24),
    ]);
    const events = noteEvents(fixture);
    expect(events).toHaveLength(1);
    const full = 16 * ticksPerSlot(32) + 24 * ticksPerSlot(24);
    expect(full).toBe(384 + 768);
    expect(events[0]?.durationTicks).toBe(Math.round(full * 0.92));
    // The shortcut here would have *under*-counted: (16 + 24) × 24 = 960.
    expect(events[0]?.durationTicks).not.toBe(Math.round(40 * 24 * 0.92));
  });

  it("keeps its real length through three different grids in a row", () => {
    const fixture = song([
      bar(16, [note("A3", 1, 12), ...Array.from({ length: 15 }, () => TIE)]),
      held(32),
      held(24),
    ]);
    const events = noteEvents(fixture);
    expect(events).toHaveLength(1);
    // Three whole 4/4 bars, whatever they are written on.
    expect(events[0]?.durationTicks).toBe(Math.round(3 * PPQ * 4 * 0.92));
  });

  it("does not re-strike on the grid change", () => {
    const fixture = song([
      bar(16, [note("A3", 1, 12), ...Array.from({ length: 15 }, () => TIE)]),
      held(32),
    ]);
    expect(noteEvents(fixture).map((event) => event.time)).toEqual([0]);
  });

  it("holds a sustain to the same length in the expression plan", () => {
    const fixture = song([
      bar(16, [note("A3", 1, 12, "sustain"), ...Array.from({ length: 15 }, () => TIE)]),
      held(32),
    ]);
    const planned = buildExpressionPlan(fixture).notes;
    expect(planned).toHaveLength(1);
    // sustain holds for its whole length, so two whole bars at 120 bpm.
    expect(planned[0]?.durationSeconds).toBeCloseTo(4, 3);
  });

  it("ends the sound where the track stops being written, not later", () => {
    const fixture = song([
      bar(16, [note("A3", 1, 12), ...Array.from({ length: 15 }, () => TIE)]),
      { timeSignature: [4, 4], resolution: 32, slots: {} },
    ]);
    const events = noteEvents(fixture);
    expect(events).toHaveLength(1);
    expect(events[0]?.durationTicks).toBe(Math.round(PPQ * 4 * 0.92));
  });

  it("ends the sound at a real rest, whatever grid the rest is on", () => {
    const fixture = song([
      bar(16, [note("A3", 1, 12), ...Array.from({ length: 15 }, () => TIE)]),
      bar(24, [REST]),
    ]);
    const events = noteEvents(fixture);
    expect(events[0]?.durationTicks).toBe(Math.round(PPQ * 4 * 0.92));
  });
});

describe("onsets land on the tick their own grid puts them on", () => {
  it("puts a triplet bar's beats where triplets go, not where sixteenths do", () => {
    const fixture = song([
      bar(16, [note("A3", 1, 12)]),
      bar(12, [
        note("B3", 1, 14),
        REST,
        REST,
        note("C4", 1, 15),
        REST,
        REST,
        note("D4", 1, 17),
      ]),
    ]);
    const times = noteEvents(fixture).map((event) => event.time);
    const barTwo = PPQ * 4;
    // A 1/8-triplet slot is 64 ticks; the beat is three of them.
    expect(times).toEqual([0, barTwo, barTwo + 192, barTwo + 384]);
    // Every one of them is a whole tick — nothing rounds.
    for (const time of times) expect(Number.isInteger(time)).toBe(true);
  });

  it("puts a 1/32 bar's last slot one slot before the bar line", () => {
    const fixture = song([
      bar(32, [...Array.from({ length: 31 }, () => REST), note("A3", 1, 12)]),
    ]);
    expect(noteEvents(fixture)[0]?.time).toBe(PPQ * 4 - ticksPerSlot(32));
  });

  it("reads the playhead back on the same grid it was written on", () => {
    const fixture = song([bar(16, [note("A3", 1, 12)]), bar(24, [note("B3", 1, 14)])]);
    const plan = buildSongPlan(fixture);
    // The 1/16 bar's fourth slot, and the 1/16-triplet bar's fourth slot.
    expect(positionAtTicks(plan, 3 * ticksPerSlot(16)).slotIndex).toBe(3);
    expect(positionAtTicks(plan, PPQ * 4 + 3 * ticksPerSlot(24)).slotIndex).toBe(3);
    // The last slot of the triplet bar is 23, not 15.
    expect(positionAtTicks(plan, PPQ * 8 - 1).slotIndex).toBe(23);
  });
});

describe("a section tempo and a grid are different things", () => {
  it("measures a mixed-grid tie in seconds through the tempo map", () => {
    // Bar 1 at 138 on 1/16, bar 2 at 69 on 1/32.
    const fixture = song([bar(16, [note("A3", 1, 12), ...Array.from({ length: 15 }, () => TIE)]), held(32)], {
      0: 138,
      1: 69,
    });
    const tempo = buildTempoMap(fixture);
    expect(tempo.segments.map((segment) => segment.writtenBpm)).toEqual([138, 69]);

    // A 4/4 bar is four beats: 4 × 60/138 then 4 × 60/69.
    const firstBar = (4 * 60) / 138;
    const secondBar = (4 * 60) / 69;
    expect(secondsAtTicks(tempo, PPQ * 4)).toBeCloseTo(firstBar, 6);
    expect(tempo.totalSeconds).toBeCloseTo(firstBar + secondBar, 6);

    // And the note's own length is the sum of its two halves, not one of them
    // scaled — the thing `durationSeconds` exists to get right.
    const full = durationSeconds(tempo, 0, PPQ * 8);
    expect(full).toBeCloseTo(firstBar + secondBar, 6);
  });

  it("gives the numbers the phase asked to see", () => {
    // What one slot lasts, at the tempos this piece actually uses.
    const ms = (bpm: number, resolution: Resolution) =>
      (ticksPerSlot(resolution) * 60 * 1000) / (bpm * PPQ);
    expect(ms(138, 16)).toBeCloseTo(108.7, 1);
    expect(ms(138, 24)).toBeCloseTo(72.5, 1);
    expect(ms(138, 32)).toBeCloseTo(54.3, 1);
    expect(ms(69, 32)).toBeCloseTo(108.7, 1);
  });

  it("scales every grid by the practice rate and none of them by itself", () => {
    const fixture = song([bar(16, [note("A3", 1, 12)]), bar(32, [note("B3", 1, 14)])], {
      1: 69,
    });
    for (const percent of [50, 150]) {
      const scaled = buildTempoMap(fixture, percent);
      const written = buildTempoMap(fixture, 100);
      expect(scaled.totalSeconds).toBeCloseTo(
        (written.totalSeconds * 100) / percent,
        6,
      );
      // The grid is unaffected: the bars still start on the same ticks.
      expect(scaled.segments.map((segment) => segment.startTicks)).toEqual(
        written.segments.map((segment) => segment.startTicks),
      );
    }
  });
});

describe("legato and slide across a grid change", () => {
  it("joins two notes that touch across a bar line on different grids", () => {
    const fixture = song([
      bar(16, [
        note("A3", 1, 12),
        ...Array.from({ length: 15 }, () => TIE),
      ]),
      bar(32, [note("B3", 1, 14, "hammer_on")]),
    ]);
    const plan = buildExpressionPlan(fixture);
    expect(plan.fallbacks).toBe(0);
    expect(plan.chains).toHaveLength(1);
    expect(plan.chains[0]?.sourcePitch).toBe("A3");
    expect(plan.chains[0]?.transitions[0]?.kind).toBe("hammer_on");
  });

  it("arrives at a slide's target on the target's own tick", () => {
    const fixture = song([
      bar(16, [
        note("A3", 1, 12),
        ...Array.from({ length: 15 }, () => TIE),
      ]),
      bar(24, [note("D4", 1, 17, "slide")]),
    ]);
    const plan = buildExpressionPlan(fixture);
    expect(plan.fallbacks).toBe(0);
    const transition = plan.chains[0]?.transitions[0];
    expect(transition?.kind).toBe("slide");
    /*
     * Transition times are measured from the chain's own start, and this
     * chain starts on the song's first tick, so they read as absolute here.
     * The written onset is the arrival, and it is bar two's first tick — a
     * tick that only lands in the right place if the 1/16 bar before it was
     * measured on its own grid.
     */
    const tempo = buildTempoMap(fixture);
    expect(transition?.arrivesAtSeconds).toBeCloseTo(
      secondsAtTicks(tempo, PPQ * 4),
      4,
    );
    // The hand starts moving inside the previous note, so before that.
    expect(transition?.atSeconds ?? 0).toBeLessThan(
      transition?.arrivesAtSeconds ?? 0,
    );
  });

  it("still refuses a legato pair a rest separates, on any grid", () => {
    const fixture = song([
      bar(16, [note("A3", 1, 12)]),
      bar(32, [note("B3", 1, 14, "hammer_on")]),
    ]);
    const plan = buildExpressionPlan(fixture);
    expect(plan.chains).toHaveLength(0);
    expect(plan.fallbacks).toBe(1);
  });
});

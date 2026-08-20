/**
 * Counting what a piece does rhythmically, without grading it (spec 11.6, K-34).
 */
import { describe, expect, it } from "vitest";

import {
  gridDistribution,
  rhythmReport,
  scalarRunCandidates,
  speedReport,
  usedResolutions,
} from "@/lib/copilot/rhythm-report";
import { slotCount, type Resolution } from "@/lib/music/timing";
import { songSchema, type Bar, type MelodicSlot, type Song } from "@/lib/song/schema";

const REST = null as unknown as MelodicSlot;
const TIE = "-" as MelodicSlot;
const note = (pitch: string) => ({ notes: [{ pitch }] }) as unknown as MelodicSlot;

function bar(resolution: Resolution, written: Record<number, MelodicSlot>): Bar {
  const count = slotCount([4, 4], resolution);
  return {
    timeSignature: [4, 4],
    resolution,
    slots: {
      gtr: Array.from({ length: count }, (_, index) => written[index] ?? REST),
    },
  } as Bar;
}

function song(bars: readonly Bar[], bpm = 120): Song {
  return songSchema.parse({
    version: 2,
    title: "report",
    bpm,
    key: "D minor",
    tracks: [
      {
        id: "gtr",
        name: "G",
        instrumentId: "electric_guitar",
        presetId: "clean",
        volumeDb: 0,
        fretboard: { tuning: ["D2", "A2", "D3", "G3", "B3", "E4"], capo: 0 },
      },
    ],
    sections: [{ id: "s1", name: "S", status: "fixed", bars: [...bars] }],
  });
}

/** Consecutive pitches from slot 0 of a bar. */
const walk = (resolution: Resolution, pitches: readonly string[]) =>
  bar(
    resolution,
    Object.fromEntries(pitches.map((pitch, index) => [index, note(pitch)])),
  );

describe("which grids were used", () => {
  it("counts bars by grid and names the triplets", () => {
    const fixture = song([walk(16, ["D3"]), walk(24, ["D3"]), walk(32, ["D3"])]);
    const distribution = gridDistribution(fixture);
    expect(distribution.totalBars).toBe(3);
    expect(distribution.byResolution).toEqual({ 16: 1, 24: 1, 32: 1 });
    expect(distribution.tripletBars).toBe(1);
    expect(distribution.thirtySecondBars).toBe(1);
    expect(distribution.highResolutionBars).toBe(2);
    expect(usedResolutions(distribution)).toEqual([16, 24, 32]);
  });

  it("notices a fine bar whose notes did not need a fine grid", () => {
    // Every onset on an even slot of a 1/32 bar: 1/16 would have held it.
    const lazy = song([
      bar(32, { 0: note("D3"), 4: note("E3"), 8: note("F3"), 12: note("G3") }),
    ]);
    expect(gridDistribution(lazy).unusedFineBars).toBe(1);

    // One odd slot, and the grid is doing something.
    const earned = song([
      bar(32, { 0: note("D3"), 3: note("E3"), 8: note("F3"), 12: note("G3") }),
    ]);
    expect(gridDistribution(earned).unusedFineBars).toBe(0);
  });

  it("says nothing about whether any of that is good", () => {
    // The report has no score, rank or verdict field anywhere in it.
    const keys = Object.keys(gridDistribution(song([walk(32, ["D3"])])));
    for (const forbidden of ["score", "rating", "quality", "grade", "better"]) {
      expect(keys.join(" ").toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe("how fast the writing actually gets", () => {
  it("measures the shortest real gap between onsets", () => {
    // Four 1/32 notes in a row at 120 bpm: a slot is 62.5 ms.
    const fixture = song([walk(32, ["D3", "E3", "F3", "G3"])]);
    const speed = speedReport(fixture, "gtr");
    expect(speed.fastestGapSeconds).toBeCloseTo(0.0625, 4);
    expect(speed.fastestOnsetsPerSecond).toBeCloseTo(16, 2);
  });

  it("does not count the notes of a chord as an infinitely fast run", () => {
    const chord = song([
      bar(16, {
        0: { notes: [{ pitch: "D3" }, { pitch: "A3" }, { pitch: "D4" }] } as unknown as MelodicSlot,
        8: note("E3"),
      }),
    ]);
    const speed = speedReport(chord, "gtr");
    expect(speed.onsets).toBe(4);
    expect(speed.fastestGapSeconds).toBeCloseTo(1, 3);
  });

  it("tells a burst apart from a continuous stream", () => {
    const burst = song([
      bar(32, {
        0: note("D3"),
        1: note("E3"),
        2: note("F3"),
        3: note("G3"),
        16: note("A3"),
      }),
    ]);
    const continuous = song([
      walk(32, Array.from({ length: 32 }, (_, index) => (index % 2 === 0 ? "D3" : "E3"))),
    ]);
    expect(speedReport(burst, "gtr").longestBurst).toBe(4);
    expect(speedReport(continuous, "gtr").longestBurst).toBe(32);
  });

  it("reports nothing rather than a number when there is one note", () => {
    const speed = speedReport(song([walk(16, ["D3"])]), "gtr");
    expect(speed.fastestGapSeconds).toBeNull();
    expect(speed.burstCount).toBe(0);
  });
});

describe("scalar run candidates", () => {
  it("finds a stepwise line of four or more", () => {
    const fixture = song([walk(16, ["D3", "E3", "F3", "G3", "A3"])]);
    const runs = scalarRunCandidates(fixture, "gtr");
    expect(runs).toHaveLength(1);
    expect(runs[0]?.length).toBe(5);
    expect(runs[0]?.direction).toBe("up");
  });

  it("does not call an arpeggio a scale walk", () => {
    // Thirds and fourths: the notes belong to the scale, the motion does not
    // read as a walk. This is the distinction the phase asked for.
    const arpeggio = song([walk(16, ["D3", "F3", "A3", "D4", "F4"])]);
    expect(scalarRunCandidates(arpeggio, "gtr")).toEqual([]);
  });

  it("does not call a wandering line a run either", () => {
    const wander = song([walk(16, ["D3", "E3", "D3", "E3", "D3"])]);
    expect(scalarRunCandidates(wander, "gtr")).toEqual([]);
  });

  it("stops a run at a rest", () => {
    const broken = song([
      bar(16, {
        0: note("D3"),
        1: note("E3"),
        2: note("F3"),
        8: note("G3"),
        9: note("A3"),
      }),
    ]);
    expect(scalarRunCandidates(broken, "gtr")).toEqual([]);
  });

  it("does not treat a tie as a new onset inside a run", () => {
    const held = song([
      bar(16, {
        0: note("D3"),
        1: TIE,
        2: note("E3"),
        3: note("F3"),
        4: note("G3"),
      }),
    ]);
    const runs = scalarRunCandidates(held, "gtr");
    expect(runs).toHaveLength(1);
    expect(runs[0]?.pitches).toEqual(["D3", "E3", "F3", "G3"]);
  });

  it("finds a run written on a triplet grid the same way", () => {
    const triplets = song([walk(24, ["D3", "E3", "F3", "G3", "A3", "Bb3"])]);
    expect(scalarRunCandidates(triplets, "gtr")).toHaveLength(1);
  });
});

describe("the whole report", () => {
  it("puts the three parts together without inventing a verdict", () => {
    const fixture = song([walk(16, ["D3", "E3", "F3", "G3"]), walk(24, ["A3"])]);
    const report = rhythmReport(fixture);
    expect(Object.keys(report).sort()).toEqual(["grid", "scalarRuns", "speed"]);
    expect(report.speed).toHaveLength(1);
    expect(report.scalarRuns).toHaveLength(1);
    expect(report.grid.tripletBars).toBe(1);
  });
});

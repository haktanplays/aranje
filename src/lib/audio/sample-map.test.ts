import { describe, expect, it } from "vitest";

import { nearestSample, playbackRateFor, sampleEntries } from "@/lib/audio/sample-map";
import { pitchToMidi } from "@/lib/music/pitch";

const PACK = sampleEntries(["A2", "C3", "A3", "C4", "E2", "E3"]);

describe("choosing a recording", () => {
  it("sorts the pack low to high and drops anything unreadable", () => {
    expect(sampleEntries(["C4", "A2", "nope"]).map((entry) => entry.note)).toEqual([
      "A2",
      "C4",
    ]);
  });

  it("takes the nearest recording", () => {
    expect(nearestSample(PACK, pitchToMidi("C3") ?? 0)?.note).toBe("C3");
    expect(nearestSample(PACK, pitchToMidi("B2") ?? 0)?.note).toBe("C3");
    expect(nearestSample(PACK, pitchToMidi("F3") ?? 0)?.note).toBe("E3");
  });

  it("has nothing to choose from an empty pack", () => {
    expect(nearestSample([], 60)).toBeNull();
  });
});

describe("turning pitch into speed", () => {
  it("plays a recording at its own speed for its own note", () => {
    expect(playbackRateFor(60, 60)).toBe(1);
  });

  it("doubles an octave up and halves an octave down", () => {
    expect(playbackRateFor(60, 72)).toBeCloseTo(2, 10);
    expect(playbackRateFor(60, 48)).toBeCloseTo(0.5, 10);
  });

  it("moves a semitone for a hundred cents", () => {
    expect(playbackRateFor(60, 60, 100)).toBeCloseTo(playbackRateFor(60, 61), 10);
    expect(playbackRateFor(60, 60, 200)).toBeCloseTo(playbackRateFor(60, 62), 10);
  });

  it("bends down as readily as up", () => {
    expect(playbackRateFor(60, 60, -100)).toBeCloseTo(playbackRateFor(60, 59), 10);
  });
});

import { describe, expect, it } from "vitest";

import { isPitch, midiToPitch, pitchClass, pitchToMidi } from "@/lib/music/pitch";

describe("pitch notation", () => {
  it("anchors C4 at MIDI 60", () => {
    expect(pitchToMidi("C4")).toBe(60);
  });

  it("reads the standard guitar tuning", () => {
    expect(["E2", "A2", "D3", "G3", "B3", "E4"].map(pitchToMidi)).toEqual([
      40, 45, 50, 55, 59, 64,
    ]);
  });

  it("reads the standard bass tuning", () => {
    expect(["E1", "A1", "D2", "G2"].map(pitchToMidi)).toEqual([28, 33, 38, 43]);
  });

  it("handles accidentals in both directions", () => {
    expect(pitchToMidi("F#4")).toBe(66);
    expect(pitchToMidi("Gb4")).toBe(66);
  });

  it("rejects malformed pitches", () => {
    for (const bad of ["H4", "E", "E##4", "e4", "E10", ""]) {
      expect(pitchToMidi(bad)).toBeNull();
      expect(isPitch(bad)).toBe(false);
    }
  });

  it("round-trips through MIDI using sharp spelling", () => {
    expect(midiToPitch(40)).toBe("E2");
    expect(midiToPitch(66)).toBe("F#4");
    expect(pitchToMidi(midiToPitch(59))).toBe(59);
  });

  it("reduces to a pitch class", () => {
    expect(pitchClass("E2")).toBe(4);
    expect(pitchClass("E4")).toBe(4);
  });
});

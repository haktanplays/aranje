import { describe, expect, it } from "vitest";

import {
  allowedIntervals,
  intervalFromTonic,
  isChromaticNeighbour,
  isDiatonic,
  isInTonalSet,
  parseKey,
} from "@/lib/music/tonality";

describe("allowed tonal set (spec 10.4)", () => {
  it("reads the key written on the song", () => {
    expect(parseKey("E minor")).toEqual({ tonicPc: 4, mode: "minor" });
    expect(parseKey("C major")).toEqual({ tonicPc: 0, mode: "major" });
    expect(parseKey("F# minor")).toEqual({ tonicPc: 6, mode: "minor" });
    expect(parseKey("Bb major")).toEqual({ tonicPc: 10, mode: "major" });
    expect(parseKey("H minor")).toBeNull();
    expect(parseKey("E")).toBeNull();
  });

  it("admits eleven of the twelve pitch classes, all but the flat second", () => {
    // This is what the union in spec 10.4 adds up to. It is recorded as a
    // test so the breadth of the rule stays visible rather than surprising.
    for (const mode of ["minor", "major"] as const) {
      const allowed = allowedIntervals(mode);
      expect(allowed.has(1)).toBe(false);
      for (let interval = 0; interval < 12; interval += 1) {
        if (interval === 1) continue;
        expect(allowed.has(interval)).toBe(true);
      }
    }
  });

  it("counts intervals from the tonic, whatever the octave", () => {
    const eMinor = parseKey("E minor");
    if (!eMinor) throw new Error("unreadable key");
    expect(intervalFromTonic("E2", eMinor)).toBe(0);
    expect(intervalFromTonic("E5", eMinor)).toBe(0);
    expect(intervalFromTonic("F2", eMinor)).toBe(1);
    expect(intervalFromTonic("D3", eMinor)).toBe(10);
  });

  it("leaves the flat second outside the fixed set", () => {
    const eMinor = parseKey("E minor");
    const cMajor = parseKey("C major");
    if (!eMinor || !cMajor) throw new Error("unreadable key");
    expect(isDiatonic("F2", eMinor)).toBe(false);
    expect(isDiatonic("E2", eMinor)).toBe(true);
    expect(isDiatonic("F#2", eMinor)).toBe(true);
    expect(isDiatonic("C#4", cMajor)).toBe(false);
    expect(isDiatonic("Db4", cMajor)).toBe(false);
  });

  it("admits an outside note that passes by semitone from an inside one", () => {
    const eMinor = parseKey("E minor");
    if (!eMinor) throw new Error("unreadable key");

    // E - F - F#: the F is a step between two notes of the set.
    expect(isChromaticNeighbour("F2", ["E2"], eMinor)).toBe(true);
    expect(isInTonalSet("F2", ["E2", "F#2"], eMinor)).toBe(true);

    // The same F with nothing beside it stays outside.
    expect(isInTonalSet("F2", ["A3"], eMinor)).toBe(false);
    expect(isInTonalSet("F2", [], eMinor)).toBe(false);

    // A semitone in pitch, not in pitch class: E3 is eleven semitones away.
    expect(isInTonalSet("F2", ["E3"], eMinor)).toBe(false);

    // The neighbour has to be inside the set itself.
    expect(isInTonalSet("F2", ["F#2"], eMinor)).toBe(true);
    expect(isChromaticNeighbour("F2", ["E2"], eMinor)).toBe(true);
  });
});

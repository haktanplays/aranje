import { describe, expect, it } from "vitest";

import * as tonality from "@/lib/music/tonality";
import {
  CORE_MAJOR,
  CORE_NATURAL_MINOR,
  classifyTone,
  coreIntervals,
  intervalFromTonic,
  isCoreTone,
  parseKey,
} from "@/lib/music/tonality";

const E_MINOR = parseKey("E minor");
const C_MAJOR = parseKey("C major");
if (!E_MINOR || !C_MAJOR) throw new Error("fixture keys are unreadable");

describe("tonal core (spec 10.4, K-17)", () => {
  it("reads the key written on the song", () => {
    expect(parseKey("E minor")).toEqual({ tonicPc: 4, mode: "minor" });
    expect(parseKey("C major")).toEqual({ tonicPc: 0, mode: "major" });
    expect(parseKey("F# minor")).toEqual({ tonicPc: 6, mode: "minor" });
    expect(parseKey("Bb major")).toEqual({ tonicPc: 10, mode: "major" });
    expect(parseKey("H minor")).toBeNull();
    expect(parseKey("E")).toBeNull();
  });

  it("admits exactly seven intervals, and no more", () => {
    expect([...coreIntervals("major")].sort((a, b) => a - b)).toEqual([
      ...CORE_MAJOR,
    ]);
    expect([...coreIntervals("minor")].sort((a, b) => a - b)).toEqual([
      ...CORE_NATURAL_MINOR,
    ]);
    expect(coreIntervals("major").size).toBe(7);
    expect(coreIntervals("minor").size).toBe(7);
  });

  it("is the declared scale, not a union of modes", () => {
    // The five intervals a minor key leaves out. Under the old union rule all
    // but one of these counted as tonal; under K-17 none of them do.
    for (const interval of [1, 4, 6, 9, 11]) {
      expect(coreIntervals("minor").has(interval)).toBe(false);
    }
    for (const interval of [1, 3, 6, 8, 10]) {
      expect(coreIntervals("major").has(interval)).toBe(false);
    }
  });

  it("counts intervals from the tonic, whatever the octave", () => {
    expect(intervalFromTonic("E2", E_MINOR)).toBe(0);
    expect(intervalFromTonic("E5", E_MINOR)).toBe(0);
    expect(intervalFromTonic("D3", E_MINOR)).toBe(10);
    expect(intervalFromTonic("not a pitch", E_MINOR)).toBeNull();
  });

  it("names why a colour tone is colour", () => {
    // E minor: D# is the raised seventh, C# the raised sixth, Bb the flat
    // fifth, G# the major third borrowed from E major, F a chromatic step.
    expect(classifyTone("D#3", E_MINOR)).toMatchObject({
      kind: "colour",
      reason: "raised_seventh",
    });
    expect(classifyTone("C#3", E_MINOR)).toMatchObject({
      kind: "colour",
      reason: "raised_sixth",
    });
    expect(classifyTone("Bb2", E_MINOR)).toMatchObject({
      kind: "colour",
      reason: "flat_five",
    });
    expect(classifyTone("G#2", E_MINOR)).toMatchObject({
      kind: "colour",
      reason: "borrowed",
    });
    expect(classifyTone("F2", E_MINOR)).toMatchObject({
      kind: "colour",
      reason: "chromatic",
    });
  });

  it("treats the parallel minor's notes as borrowings in a major key", () => {
    expect(classifyTone("Eb4", C_MAJOR)).toMatchObject({
      kind: "colour",
      reason: "borrowed",
    });
    expect(classifyTone("Gb4", C_MAJOR)).toMatchObject({
      kind: "colour",
      reason: "flat_five",
    });
    expect(classifyTone("C#4", C_MAJOR)).toMatchObject({
      kind: "colour",
      reason: "chromatic",
    });
  });

  it("calls the seven scale degrees core, in both modes", () => {
    for (const pitch of ["E2", "F#2", "G2", "A2", "B2", "C3", "D3"]) {
      expect(isCoreTone(pitch, E_MINOR)).toBe(true);
    }
    for (const pitch of ["C4", "D4", "E4", "F4", "G4", "A4", "B4"]) {
      expect(isCoreTone(pitch, C_MAJOR)).toBe(true);
    }
  });

  it("says nothing tonal about a pitch it cannot read", () => {
    expect(classifyTone("H9", E_MINOR)).toEqual({ kind: "unreadable" });
    expect(isCoreTone("H9", E_MINOR)).toBe(false);
  });

  it("exposes no API that merges core and colour back together", () => {
    // K-17 removed the union set on purpose. Pinning the export list is what
    // stops it coming back under a new name.
    expect(Object.keys(tonality).sort()).toEqual([
      "CORE_MAJOR",
      "CORE_NATURAL_MINOR",
      "classifyTone",
      "coreIntervals",
      "intervalFromTonic",
      "isCoreTone",
      "parseKey",
    ]);
    expect(coreIntervals("minor").size).toBe(7);
    expect(coreIntervals("major").size).toBe(7);
  });
});

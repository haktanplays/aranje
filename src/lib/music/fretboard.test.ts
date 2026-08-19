import { describe, expect, it } from "vitest";

import {
  MAX_PHYSICAL_FRET,
  TUNING_PRESETS,
  fretboardRange,
  isPlayablePosition,
  maxCapoRelativeFret,
  physicalFret,
  soundingMidi,
  type Fretboard,
} from "@/lib/music/fretboard";
import { midiToPitch, pitchToMidi } from "@/lib/music/pitch";

const E_STANDARD: Fretboard = {
  tuning: TUNING_PRESETS.e_standard?.tuning ?? [],
  capo: 0,
};

describe("capo-relative fret semantics (spec 9.1)", () => {
  it("counts strings from the thickest upward, 0-based", () => {
    expect(E_STANDARD.tuning[0]).toBe("E2");
    expect(soundingMidi(E_STANDARD, { string: 0, fret: 0 })).toBe(
      pitchToMidi("E2"),
    );
  });

  it("sounds tuning + capo + fret", () => {
    const capo2: Fretboard = { tuning: E_STANDARD.tuning, capo: 2 };
    const sounding = soundingMidi(capo2, { string: 0, fret: 0 });
    expect(sounding).toBe((pitchToMidi("E2") ?? 0) + 2);
    expect(midiToPitch(sounding ?? 0)).toBe("F#2");
  });

  it("treats fret 0 as the sound behind the capo, not the open string", () => {
    const capo5: Fretboard = { tuning: E_STANDARD.tuning, capo: 5 };
    expect(soundingMidi(capo5, { string: 0, fret: 0 })).toBe(
      pitchToMidi("A2"),
    );
  });

  it("derives the physical fret separately from the written fret", () => {
    expect(physicalFret(0, 3)).toBe(3);
    expect(physicalFret(5, 3)).toBe(8);
  });

  it("shrinks the writable fret range as the capo moves up", () => {
    expect(maxCapoRelativeFret(0)).toBe(MAX_PHYSICAL_FRET);
    expect(maxCapoRelativeFret(12)).toBe(12);
  });

  it("rejects a fret beyond the capo-relative range", () => {
    const capo12: Fretboard = { tuning: E_STANDARD.tuning, capo: 12 };
    expect(isPlayablePosition(capo12, { string: 0, fret: 12 })).toBe(true);
    expect(isPlayablePosition(capo12, { string: 0, fret: 13 })).toBe(false);
  });

  it("rejects a string that does not exist", () => {
    expect(isPlayablePosition(E_STANDARD, { string: 6, fret: 0 })).toBe(false);
    expect(isPlayablePosition(E_STANDARD, { string: -1, fret: 0 })).toBe(false);
  });

  it("rejects non-integer positions", () => {
    expect(isPlayablePosition(E_STANDARD, { string: 0.5, fret: 0 })).toBe(false);
    expect(isPlayablePosition(E_STANDARD, { string: 0, fret: 1.5 })).toBe(false);
  });

  it("maps the demo song positions to their written pitches", () => {
    const cases: [number, number, string][] = [
      [0, 0, "E2"],
      [0, 3, "G2"],
      [1, 0, "A2"],
      [1, 2, "B2"],
      [1, 3, "C3"],
      [2, 0, "D3"],
      [2, 2, "E3"],
      [2, 4, "F#3"],
      [2, 5, "G3"],
      [4, 0, "B3"],
      [5, 0, "E4"],
      [5, 2, "F#4"],
      [5, 3, "G4"],
    ];
    for (const [string, fret, pitch] of cases) {
      expect(soundingMidi(E_STANDARD, { string, fret })).toBe(
        pitchToMidi(pitch),
      );
    }
  });

  it("derives the reachable range from tuning and fret count", () => {
    const range = fretboardRange(E_STANDARD);
    expect(range?.lowMidi).toBe(pitchToMidi("E2"));
    expect(range?.highMidi).toBe((pitchToMidi("E4") ?? 0) + MAX_PHYSICAL_FRET);
  });

  it("takes the extremes over every string, not over the outer two", () => {
    // A tuning whose lowest and highest strings are not first and last.
    const odd: Fretboard = { tuning: ["E2", "A1", "E5", "D3"], capo: 0 };
    const range = fretboardRange(odd);
    expect(range?.lowMidi).toBe(pitchToMidi("A1"));
    expect(range?.highMidi).toBe((pitchToMidi("E5") ?? 0) + MAX_PHYSICAL_FRET);
  });

  it("raises the floor with the capo but leaves the ceiling where it was", () => {
    const open = fretboardRange(E_STANDARD);
    const capoed = fretboardRange({ ...E_STANDARD, capo: 3 });
    // The frets above the capo are lost exactly as fast as the open string
    // rises, so the highest reachable pitch does not move (spec 9.1).
    expect(capoed?.lowMidi).toBe((open?.lowMidi ?? 0) + 3);
    expect(capoed?.highMidi).toBe(open?.highMidi);
  });

  it("refuses a tuning it cannot read", () => {
    expect(fretboardRange({ tuning: ["E2", "H9"], capo: 0 })).toBeNull();
    expect(fretboardRange({ tuning: [], capo: 0 })).toBeNull();
  });

  it("keeps the bass tuning at four strings", () => {
    expect(TUNING_PRESETS.bass_standard?.tuning).toEqual([
      "E1",
      "A1",
      "D2",
      "G2",
    ]);
  });
});

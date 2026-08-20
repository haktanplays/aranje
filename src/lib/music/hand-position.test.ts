import { describe, expect, it } from "vitest";

import { handPositionLimits } from "@/lib/limits";
import {
  anchorOf,
  chordSpan,
  isLargeShift,
  maxShiftFor,
  medianOf,
  shiftExcess,
  stringCenter,
  type HandNote,
} from "@/lib/music/hand-position";

const note = (stringIndex: number, physicalFret: number): HandNote => ({
  stringIndex,
  physicalFret,
});

describe("median", () => {
  it("takes the lower middle for an even count, so it is always a real fret", () => {
    expect(medianOf([2, 4])).toBe(2);
    expect(medianOf([1, 2, 3, 4])).toBe(2);
    expect(medianOf([4, 2])).toBe(2);
  });

  it("takes the middle for an odd count", () => {
    expect(medianOf([1, 2, 12])).toBe(2);
    expect(medianOf([12, 1, 2])).toBe(2);
  });

  it("has nothing to say about an empty list", () => {
    expect(medianOf([])).toBeNull();
  });
});

describe("anchor", () => {
  it("is the median of the fretted notes", () => {
    expect(anchorOf([note(0, 5), note(1, 7), note(2, 9)])).toBe(7);
  });

  it("is not dragged down by open strings in a mixed chord", () => {
    // One finger at the twelfth fret and three open strings: the hand is at
    // twelve, not at three.
    expect(anchorOf([note(0, 0), note(1, 0), note(2, 0), note(3, 12)])).toBe(12);
  });

  it("is zero when nothing is fretted", () => {
    expect(anchorOf([note(0, 0), note(1, 0)])).toBe(0);
    expect(anchorOf([])).toBe(0);
  });

  it("is not moved by one stretched finger", () => {
    expect(anchorOf([note(0, 1), note(1, 2), note(2, 12)])).toBe(2);
  });
});

describe("chord span", () => {
  it("is the distance between the outer fretted notes", () => {
    expect(chordSpan([note(0, 3), note(1, 5), note(2, 7)])).toBe(4);
  });

  it("is zero for one fretted note or none", () => {
    expect(chordSpan([note(0, 5)])).toBe(0);
    expect(chordSpan([note(0, 0), note(1, 0)])).toBe(0);
    expect(chordSpan([])).toBe(0);
  });

  it("does not count open strings as part of the stretch", () => {
    // Fretted at 5 and 7; the open string is played by the other hand.
    expect(chordSpan([note(0, 0), note(1, 5), note(2, 7)])).toBe(2);
  });
});

describe("string centre", () => {
  it("is the median of the data-model string indices", () => {
    expect(stringCenter([note(0, 3), note(1, 3), note(5, 3)])).toBe(1);
    expect(stringCenter([note(4, 0), note(5, 0)])).toBe(4);
  });

  it("is zero for nothing", () => {
    expect(stringCenter([])).toBe(0);
  });
});

describe("family thresholds", () => {
  it("comes from the one central source", () => {
    expect(maxShiftFor("electric_guitar")).toBe(handPositionLimits.guitarMaxShift);
    expect(maxShiftFor("steel_acoustic")).toBe(handPositionLimits.guitarMaxShift);
    expect(maxShiftFor("nylon_guitar")).toBe(handPositionLimits.guitarMaxShift);
    expect(maxShiftFor("electric_bass")).toBe(handPositionLimits.bassMaxShift);
    expect(maxShiftFor("drum_kit")).toBeNull();
    expect(maxShiftFor("piano")).toBeNull();
  });

  it("calls exactly the threshold small and one past it large", () => {
    expect(isLargeShift(0, 7, 7)).toBe(false);
    expect(isLargeShift(0, 8, 7)).toBe(true);
    expect(isLargeShift(8, 0, 7)).toBe(true);
    expect(isLargeShift(0, 5, 5)).toBe(false);
    expect(isLargeShift(0, 6, 5)).toBe(true);
  });

  it("measures only the part of a shift that is over the line", () => {
    expect(shiftExcess(0, 7, 7)).toBe(0);
    expect(shiftExcess(0, 10, 7)).toBe(3);
    expect(shiftExcess(10, 0, 7)).toBe(3);
  });
});

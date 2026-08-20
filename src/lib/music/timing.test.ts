import { describe, expect, it } from "vitest";

import {
  CORE_TIME_SIGNATURES,
  PPQ,
  RESOLUTIONS,
  TICKS_PER_WHOLE,
  TIME_SIGNATURES,
  TRIPLET_RESOLUTIONS,
  formatTimeSignature,
  isCoreTimeSignature,
  isRepresentableGrid,
  isTripletGrid,
  resolutionLabel,
  slotCount,
  slotsPerFeltBeat,
  slotsPerNotatedBeat,
  ticksPerBar,
  ticksPerSlot,
  type Resolution,
  type TimeSignature,
} from "@/lib/music/timing";

describe("the grids that exist (spec 5.5, K-34)", () => {
  it("is exactly the five the contract names", () => {
    expect([...RESOLUTIONS]).toEqual([8, 12, 16, 24, 32]);
  });

  it("does not include 64", () => {
    // Deliberate: see the module header and spec 5.5. The gap is recorded,
    // not silently supported.
    expect(RESOLUTIONS).not.toContain(64 as unknown as Resolution);
  });

  it("knows which of them are triplet grids", () => {
    expect([...TRIPLET_RESOLUTIONS]).toEqual([12, 24]);
    expect(isTripletGrid(12)).toBe(true);
    expect(isTripletGrid(24)).toBe(true);
    for (const straight of [8, 16, 32]) {
      expect(isTripletGrid(straight)).toBe(false);
    }
  });

  it("never labels a triplet grid as a plain note value", () => {
    expect(resolutionLabel(8)).toBe("1/8");
    expect(resolutionLabel(16)).toBe("1/16");
    expect(resolutionLabel(32)).toBe("1/32");
    expect(resolutionLabel(12)).toBe("1/8 üçleme");
    expect(resolutionLabel(24)).toBe("1/16 üçleme");
    // "1/12" would read as a straight value next to "1/16". It never appears.
    for (const resolution of RESOLUTIONS) {
      if (!isTripletGrid(resolution)) continue;
      expect(resolutionLabel(resolution)).not.toBe(`1/${resolution}`);
    }
  });
});

describe("slot count (spec 5.5)", () => {
  const cases: [TimeSignature, Resolution, number][] = [
    [[4, 4], 8, 8],
    [[4, 4], 12, 12],
    [[4, 4], 16, 16],
    [[4, 4], 24, 24],
    [[4, 4], 32, 32],
    [[3, 4], 8, 6],
    [[3, 4], 12, 9],
    [[3, 4], 16, 12],
    [[3, 4], 24, 18],
    [[3, 4], 32, 24],
    [[6, 8], 8, 6],
    [[6, 8], 16, 12],
    [[6, 8], 24, 18],
    [[6, 8], 32, 24],
    [[7, 8], 8, 7],
    [[7, 8], 16, 14],
    [[7, 8], 24, 21],
    [[7, 8], 32, 28],
  ];

  it.each(cases)(
    "%s at resolution %i has %i slots",
    (timeSignature, resolution, expected) => {
      expect(slotCount(timeSignature, resolution)).toBe(expected);
    },
  );

  it("is a whole number wherever the grid is representable at all", () => {
    for (const timeSignature of TIME_SIGNATURES) {
      for (const resolution of RESOLUTIONS) {
        if (!isRepresentableGrid(timeSignature, resolution)) continue;
        const count = slotCount(timeSignature, resolution);
        expect(Number.isInteger(count)).toBe(true);
        expect(count).toBeGreaterThan(0);
      }
    }
  });

  it("refuses a meter it cannot write, rather than returning half a slot", () => {
    // 7/8 at 1/12 is 10.5 slots — not a bar.
    expect(isRepresentableGrid([7, 8], 12)).toBe(false);
    expect(() => slotCount([7, 8], 12)).toThrow(RangeError);

    // 6/8 at 1/12 divides into nine whole slots, but none of them is an
    // eighth, so the meter's own note value cannot be written.
    expect((6 * 12) / 8).toBe(9);
    expect(isRepresentableGrid([6, 8], 12)).toBe(false);
    expect(() => slotCount([6, 8], 12)).toThrow(RangeError);
  });

  it("says exactly which meter/grid pairs are the ones that fail", () => {
    const rejected: string[] = [];
    for (const timeSignature of TIME_SIGNATURES) {
      for (const resolution of RESOLUTIONS) {
        if (isRepresentableGrid(timeSignature, resolution)) continue;
        rejected.push(`${formatTimeSignature(timeSignature)}@${resolution}`);
      }
    }
    expect(rejected).toEqual(["6/8@12", "7/8@12"]);
  });
});

describe("ticks (spec 8.3)", () => {
  it("gives every grid a whole number of ticks per slot", () => {
    expect(TICKS_PER_WHOLE).toBe(PPQ * 4);
    const perSlot = Object.fromEntries(
      RESOLUTIONS.map((resolution) => [resolution, ticksPerSlot(resolution)]),
    );
    expect(perSlot).toEqual({ 8: 96, 12: 64, 16: 48, 24: 32, 32: 24 });
    for (const value of Object.values(perSlot)) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("makes a triplet slot two thirds of the straight slot above it", () => {
    // An eighth triplet is two thirds of an eighth; a sixteenth triplet is
    // two thirds of a sixteenth. This is the arithmetic that stops 12 and 24
    // from being treated as denser straight grids.
    expect(ticksPerSlot(12) * 3).toBe(ticksPerSlot(8) * 2);
    expect(ticksPerSlot(24) * 3).toBe(ticksPerSlot(16) * 2);
  });

  it("gives a 4/4 bar the same length on every grid", () => {
    const lengths = RESOLUTIONS.map((resolution) => ticksPerBar([4, 4], resolution));
    expect(new Set(lengths).size).toBe(1);
    expect(lengths[0]).toBe(PPQ * 4);
  });

  it("gives every representable bar a length that is a whole note count", () => {
    for (const timeSignature of TIME_SIGNATURES) {
      for (const resolution of RESOLUTIONS) {
        if (!isRepresentableGrid(timeSignature, resolution)) continue;
        const ticks = ticksPerBar(timeSignature, resolution);
        // numerator × the notated note value, whatever grid it is written on.
        expect(ticks).toBe(
          (timeSignature[0] * TICKS_PER_WHOLE) / timeSignature[1],
        );
      }
    }
  });
});

describe("where the beats fall", () => {
  it("counts the notated beat in grid steps", () => {
    expect(slotsPerNotatedBeat([4, 4], 8)).toBe(2);
    expect(slotsPerNotatedBeat([4, 4], 12)).toBe(3);
    expect(slotsPerNotatedBeat([4, 4], 16)).toBe(4);
    expect(slotsPerNotatedBeat([4, 4], 24)).toBe(6);
    expect(slotsPerNotatedBeat([4, 4], 32)).toBe(8);
  });

  it("counts the felt beat as the dotted note in compound time", () => {
    expect(slotsPerFeltBeat([4, 4], 24)).toBe(6);
    expect(slotsPerFeltBeat([6, 8], 8)).toBe(3);
    expect(slotsPerFeltBeat([6, 8], 24)).toBe(9);
    expect(slotsPerFeltBeat([7, 8], 8)).toBe(1);
  });

  it("puts a whole number of slots in a beat on every representable grid", () => {
    for (const timeSignature of TIME_SIGNATURES) {
      for (const resolution of RESOLUTIONS) {
        if (!isRepresentableGrid(timeSignature, resolution)) continue;
        expect(
          Number.isInteger(slotsPerNotatedBeat(timeSignature, resolution)),
        ).toBe(true);
        expect(
          Number.isInteger(slotsPerFeltBeat(timeSignature, resolution)),
        ).toBe(true);
      }
    }
  });
});

describe("meters", () => {
  it("marks only 4/4 and 6/8 as core (spec 2.6)", () => {
    expect(CORE_TIME_SIGNATURES).toHaveLength(2);
    expect(isCoreTimeSignature([4, 4])).toBe(true);
    expect(isCoreTimeSignature([6, 8])).toBe(true);
    expect(isCoreTimeSignature([3, 4])).toBe(false);
    expect(isCoreTimeSignature([7, 8])).toBe(false);
  });

  it("formats a meter for display", () => {
    expect(formatTimeSignature([6, 8])).toBe("6/8");
  });
});

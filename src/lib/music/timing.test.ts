import { describe, expect, it } from "vitest";

import {
  CORE_TIME_SIGNATURES,
  RESOLUTIONS,
  TIME_SIGNATURES,
  formatTimeSignature,
  isCoreTimeSignature,
  slotCount,
  type Resolution,
  type TimeSignature,
} from "@/lib/music/timing";

describe("slot count (spec 5.5)", () => {
  const cases: [TimeSignature, Resolution, number][] = [
    [[4, 4], 8, 8],
    [[4, 4], 16, 16],
    [[3, 4], 8, 6],
    [[3, 4], 16, 12],
    [[6, 8], 8, 6],
    [[6, 8], 16, 12],
    [[7, 8], 8, 7],
    [[7, 8], 16, 14],
  ];

  it.each(cases)(
    "%s at resolution %i has %i slots",
    (timeSignature, resolution, expected) => {
      expect(slotCount(timeSignature, resolution)).toBe(expected);
    },
  );

  it("is a whole number for every allowed meter and resolution", () => {
    for (const timeSignature of TIME_SIGNATURES) {
      for (const resolution of RESOLUTIONS) {
        const count = slotCount(timeSignature, resolution);
        expect(Number.isInteger(count)).toBe(true);
        expect(count).toBeGreaterThan(0);
      }
    }
  });

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

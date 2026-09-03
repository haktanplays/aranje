/**
 * Rhythm has axes, and the view is not one of them (2V-B.3 §15, §16, §18).
 *
 * The claim these tests exist to protect is the one the whole batch turns on:
 * Simple is a *projection* of the format, not a second format. A song written
 * in something Simple cannot name must still parse, still play and still come
 * back byte-identical — so the profile list is asserted to be a subset of what
 * the schema already accepts, never a replacement for it.
 */
import { describe, expect, it } from "vitest";

import { RESOLUTIONS, ticksPerSlot } from "@/lib/music/timing";
import {
  RHYTHM_PROFILES,
  RHYTHM_PROFILE_IDS,
  defaultGrouping,
  groupingFitsMeter,
  isTripletResolution,
  profileForResolution,
  rhythmAxes,
} from "@/lib/music/rhythm-profile";

describe("the five profiles a beginner is offered (§16)", () => {
  it("offers exactly five, named the way a musician says them", () => {
    expect(RHYTHM_PROFILE_IDS).toHaveLength(5);
    expect(RHYTHM_PROFILES.map((profile) => profile.label)).toEqual([
      "Düz 1/8",
      "Düz 1/16",
      "Düz 1/32",
      "Üçleme 1/8T",
      "Üçleme 1/16T",
    ]);
  });

  it("names only grids the format already accepts", () => {
    for (const profile of RHYTHM_PROFILES) {
      expect(RESOLUTIONS).toContain(profile.resolution);
    }
  });

  it("says nothing rather than guessing, for a grid no profile names", () => {
    /* 1/4 is a real resolution and no Simple profile is about it. The honest
       answer is null: showing the bar without claiming a profile for it. */
    expect(profileForResolution(4)).toBeNull();
    expect(profileForResolution(16)?.id).toBe("straight_16");
    expect(profileForResolution(24)?.family).toBe("triplet");
  });

  it("keeps the straight and triplet families apart", () => {
    for (const profile of RHYTHM_PROFILES) {
      expect(isTripletResolution(profile.resolution)).toBe(
        profile.family === "triplet",
      );
    }
  });

  it("covers binary and triplet division at PPQ 192 without a remainder", () => {
    /*
     * The claim §18 asks to be stated somewhere checkable: 192 ticks per
     * quarter divides evenly for both families, which is why a triplet is
     * exact here rather than rounded.
     */
    for (const profile of RHYTHM_PROFILES) {
      expect(Number.isInteger(ticksPerSlot(profile.resolution))).toBe(true);
      expect(768 % ticksPerSlot(profile.resolution)).toBe(0);
    }
  });
});

describe("beat grouping is explicit and optional (§15)", () => {
  it("feels a compound metre in threes and a simple one in ones", () => {
    expect(defaultGrouping([6, 8])).toEqual([3, 3]);
    expect(defaultGrouping([4, 4])).toEqual([1, 1, 1, 1]);
    expect(defaultGrouping([3, 4])).toEqual([1, 1, 1]);
  });

  it("accepts an additive grouping that adds up, and refuses one that does not", () => {
    expect(groupingFitsMeter([2, 2, 3], [7, 8])).toBe(true);
    expect(groupingFitsMeter([3, 2, 2], [7, 8])).toBe(true);
    expect(groupingFitsMeter([2, 2, 2], [7, 8])).toBe(false);
    expect(groupingFitsMeter([], [4, 4])).toBe(false);
    expect(groupingFitsMeter([0, 4], [4, 4])).toBe(false);
  });

  it("falls back to the default rather than keeping a grouping that cannot be", () => {
    const axes = rhythmAxes({ meter: [7, 8], resolution: 8, grouping: [2, 2, 2] });
    expect(axes.grouping).toEqual(defaultGrouping([7, 8]));
  });
});

describe("one bar's rhythm, on every axis at once", () => {
  it("reports the meter, the grouping, the grid and the profile together", () => {
    const axes = rhythmAxes({ meter: [4, 4], resolution: 16 });
    expect(axes.meter).toEqual([4, 4]);
    expect(axes.slots).toBe(16);
    expect(axes.slotTicks).toBe(48);
    expect(axes.barTicks).toBe(768);
    expect(axes.profile?.id).toBe("straight_16");
  });

  it("keeps the measure the same length whatever grid it is written on", () => {
    const lengths = RHYTHM_PROFILES.map(
      (profile) => rhythmAxes({ meter: [4, 4], resolution: profile.resolution }).barTicks,
    );
    /* Five grids, one measure: the ruler changes and the time does not. */
    expect(new Set(lengths)).toEqual(new Set([768]));
  });

  it("expresses 4/4, 3/4 and 6/8 without a remainder (§18)", () => {
    for (const meter of [[4, 4], [3, 4], [6, 8]] as const) {
      const axes = rhythmAxes({ meter, resolution: 8 });
      expect(Number.isInteger(axes.slots)).toBe(true);
      expect(axes.slots * axes.slotTicks).toBe(axes.barTicks);
    }
  });
});

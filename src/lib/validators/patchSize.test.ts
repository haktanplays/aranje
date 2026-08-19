import { describe, expect, it } from "vitest";

import { songLimits } from "@/lib/limits";
import type { CopilotPatch } from "@/lib/copilot/contract";
import { touchedBars, validatePatchSize } from "@/lib/validators/patchSize";
import { TEST_SONG, mainSection } from "@/test/copilot-fixtures";

const SECTION = mainSection();

function bar(barIndex: number) {
  return {
    barIndex,
    slots: Array.from({ length: 8 }, () => [{ piece: "kick" as const }]),
  };
}

function patch(bars: CopilotPatch["bars"]): CopilotPatch {
  return {
    id: "p1",
    operation: "arrange_track",
    sectionId: SECTION.id,
    targetTrackId: "drums",
    bars,
    explanation: "x",
  };
}

describe("patchSize (spec 10.1, surface from K-18)", () => {
  it("measures the bars written in the target track", () => {
    expect(touchedBars(patch([bar(0), bar(1), bar(2)]))).toEqual({
      count: 3,
      duplicates: [],
    });
    expect(validatePatchSize(TEST_SONG, patch([bar(0), bar(1)]))).toEqual([]);
  });

  it("accepts a patch at the limit", () => {
    const bars = Array.from({ length: songLimits.barsPerPatch }, (_, index) =>
      bar(index),
    );
    expect(touchedBars(patch(bars)).count).toBe(songLimits.barsPerPatch);
    expect(validatePatchSize(TEST_SONG, patch(bars))).toEqual([]);
  });

  it("blocks a patch one bar over the limit", () => {
    const bars = Array.from({ length: songLimits.barsPerPatch + 1 }, (_, index) =>
      bar(index),
    );
    const issues = validatePatchSize(TEST_SONG, patch(bars));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "patchSize",
      severity: "error",
      sectionId: SECTION.id,
      trackId: "drums",
    });
    expect(issues[0]?.message).toContain(String(songLimits.barsPerPatch));
  });

  it("refuses the same bar twice, so the limit cannot be slipped by repetition", () => {
    const bars = [bar(0), bar(0), bar(1)];
    expect(touchedBars(patch(bars))).toEqual({ count: 2, duplicates: [0] });

    const issues = validatePatchSize(TEST_SONG, patch(bars));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("birden fazla kez");
  });

  it("names every repeated bar, in order", () => {
    const bars = [bar(2), bar(0), bar(2), bar(0), bar(1)];
    expect(touchedBars(patch(bars)).duplicates).toEqual([0, 2]);
  });

  it("does not measure a replaced section, because nothing is replaced now", () => {
    // K-18 removed section replacement from the public flow, so the old
    // max(new, displaced) reading has nothing left to measure. What counts is
    // what the patch writes into the one track it may touch.
    const bars = [bar(0)];
    expect(touchedBars(patch(bars)).count).toBe(1);
    expect(SECTION.bars.length).toBeGreaterThan(1);
  });

  it("repeats itself exactly", () => {
    const subject = patch([bar(0), bar(0)]);
    expect(validatePatchSize(TEST_SONG, subject)).toEqual(
      validatePatchSize(TEST_SONG, subject),
    );
  });
});

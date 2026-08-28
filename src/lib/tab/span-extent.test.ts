import { describe, expect, it } from "vitest";

import { sliceSpan } from "@/lib/tab/span-extent";
import type { Bar, Resolution } from "@/lib/song/schema";

const bar = (resolution: Resolution = 16): Bar => ({
  timeSignature: [4, 4],
  resolution,
  slots: {},
});

describe("sliceSpan", () => {
  it("gives a slot-long note exactly its own slot", () => {
    expect(sliceSpan([bar()], 0, 48)).toEqual([
      { barIndex: 0, startSlot: 0, endSlot: 0, openStart: false, openEnd: false },
    ]);
  });

  it("covers every slot a longer note reaches", () => {
    expect(sliceSpan([bar()], 96, 192)).toEqual([
      { barIndex: 0, startSlot: 2, endSlot: 5, openStart: false, openEnd: false },
    ]);
  });

  /* Nowhere smaller to draw it, and dropping it would lose the note. */
  it("still gives a slot to a note shorter than one", () => {
    expect(sliceSpan([bar()], 48, 24)).toMatchObject([{ startSlot: 1, endSlot: 1 }]);
  });

  /* A note whose string was taken the instant it began is still written. */
  it("still gives a slot to a note that is heard for nothing", () => {
    expect(sliceSpan([bar()], 96, 0)).toMatchObject([{ startSlot: 2, endSlot: 2 }]);
  });

  /*
   * The two sides of a bar line are on different grids, so the same note
   * covers four slots on one side and eight on the other. Counting in ticks
   * and converting once is the only way both numbers come out right.
   */
  it("splits across a bar line, counting each bar on its own grid", () => {
    const slices = sliceSpan([bar(16), bar(32)], 576, 384);
    expect(slices).toEqual([
      { barIndex: 0, startSlot: 12, endSlot: 15, openStart: false, openEnd: true },
      { barIndex: 1, startSlot: 0, endSlot: 7, openStart: true, openEnd: false },
    ]);
  });

  it("crosses more than one bar line when it is long enough", () => {
    const slices = sliceSpan([bar(), bar(), bar()], 0, 768 * 3);
    expect(slices.map((s) => s.barIndex)).toEqual([0, 1, 2]);
    expect(slices.map((s) => s.openStart)).toEqual([false, true, true]);
    expect(slices.map((s) => s.openEnd)).toEqual([true, true, false]);
  });

  it("returns nothing for a note that starts past the last bar", () => {
    expect(sliceSpan([bar()], 1000, 48)).toEqual([]);
  });

  it("stops at the end of the music rather than running off it", () => {
    const slices = sliceSpan([bar()], 720, 200);
    expect(slices).toEqual([
      { barIndex: 0, startSlot: 15, endSlot: 15, openStart: false, openEnd: true },
    ]);
  });
});

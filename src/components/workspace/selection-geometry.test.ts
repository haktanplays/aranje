/**
 * The selection band is positioned from ticks, not slot indices (K-34, K-37).
 *
 * The failure this guards against is quiet: a band drawn from indices looks
 * right in a section whose bars all share a grid, and drifts further from the
 * music with every grid change — worst in the fills and runs where someone is
 * most likely to be selecting something.
 */
import { describe, expect, it } from "vitest";

import { bandFor, barSpans, ticksForX, xForTicks } from "@/components/workspace/selection-geometry";
import { SLOT_WIDTH } from "@/components/workspace/geometry";
import { ticksPerSlot } from "@/lib/music/timing";
import { bar, slots, song, REST, note } from "@/test/move-fixtures";

const sectionOf = (...bars: ReturnType<typeof bar>[]) => {
  const built = song(bars);
  const section = built.sections[0];
  if (!section) throw new Error("fixture has no section");
  return section;
};

describe("bar spans", () => {
  it("lays bars out left to right with their own widths", () => {
    const section = sectionOf(bar(slots([note("A3", 1, 12), REST])), bar(slots([], 16), 16));
    const spans = barSpans(section);
    expect(spans[0]?.x).toBe(0);
    expect(spans[0]?.width).toBe(SLOT_WIDTH * 8);
    expect(spans[1]?.x).toBe(SLOT_WIDTH * 8);
    expect(spans[1]?.width).toBe(SLOT_WIDTH * 16);
  });
});

describe("ticks to pixels", () => {
  it("puts the same moment in the same place across different grids", () => {
    // Bar one is 1/8 (96 ticks a slot), bar two is 1/32 (24). Half way through
    // each bar is half way across each bar, whatever the grid.
    const section = sectionOf(bar(slots([], 8), 8), bar(slots([], 32), 32));
    const spans = barSpans(section);
    const firstHalf = xForTicks(section, 384);
    const secondHalf = xForTicks(section, 768 + 384);
    expect(firstHalf).toBe((spans[0]?.width ?? 0) / 2);
    expect(secondHalf).toBe((spans[1]?.x ?? 0) + (spans[1]?.width ?? 0) / 2);
  });

  it("would be wrong if it used slot indices", () => {
    // Slot 4 of a 1/32 bar is an eighth of the way in, not half. This pins the
    // difference the index-based version would get wrong.
    const section = sectionOf(bar(slots([], 32), 32));
    const ticks = 4 * ticksPerSlot(32);
    expect(xForTicks(section, ticks)).toBe(4 * SLOT_WIDTH);
    expect(xForTicks(section, ticks)).not.toBe(4 * (SLOT_WIDTH * 8) / 8 * 2);
  });

  it("ends the section at the right edge of its last bar", () => {
    const section = sectionOf(bar(slots([], 8), 8));
    expect(xForTicks(section, 768)).toBe(SLOT_WIDTH * 8);
  });

  it("returns null outside the section", () => {
    const section = sectionOf(bar(slots([], 8), 8));
    expect(xForTicks(section, -1)).toBeNull();
    expect(xForTicks(section, 769)).toBeNull();
  });
});

describe("the band", () => {
  it("is one continuous band across a bar line, not two", () => {
    const section = sectionOf(bar(slots([], 8), 8), bar(slots([], 8), 8));
    const band = bandFor(section, 96 * 6, 96 * 10);
    expect(band).not.toBeNull();
    if (!band) return;
    expect(band.left).toBe(SLOT_WIDTH * 6);
    // Two slots of bar one plus two of bar two, uninterrupted.
    expect(band.width).toBe(SLOT_WIDTH * 4);
  });

  it("keeps a zero-width selection visible as a caret", () => {
    const section = sectionOf(bar(slots([], 8), 8));
    const band = bandFor(section, 96, 96);
    expect(band?.width).toBeGreaterThan(0);
  });
});

describe("pixels back to ticks", () => {
  it("snaps to the slot the finger is over, on that bar's own grid", () => {
    const section = sectionOf(bar(slots([], 8), 8), bar(slots([], 16), 16));
    expect(ticksForX(section, SLOT_WIDTH * 2 + 4)).toBe(2 * ticksPerSlot(8));
    // Into bar two, third slot: 768 plus two 1/16 slots.
    expect(ticksForX(section, SLOT_WIDTH * 10 + 4)).toBe(768 + 2 * ticksPerSlot(16));
  });
});

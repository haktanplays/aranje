/**
 * Drawing a bar whose grid is not the one before it (spec 5.5, 13.x, K-34).
 *
 * Two questions, and both are about not lying to the reader: is a 32-slot bar
 * drawn wider than a 16-slot one rather than squeezed into the same width,
 * and is a triplet bar told apart from a straight one.
 */
import { describe, expect, it } from "vitest";

import { SLOT_WIDTH, barWidth, slotCentre, slotsPerBeat } from "@/components/workspace/geometry";
import { gridLabelFor } from "@/components/workspace/TabCanvas";
import { RESOLUTIONS, slotCount, type Resolution } from "@/lib/music/timing";

const bars = (...grids: Resolution[]) => grids.map((resolution) => ({ resolution }));

describe("a bar is as wide as it has slots", () => {
  it("draws a finer bar wider rather than squeezing it", () => {
    const widths = RESOLUTIONS.map((resolution) =>
      barWidth(slotCount([4, 4], resolution)),
    );
    // One cell per slot at every grid, from the four of a chord chart to the
    // thirty-two of a fill.
    expect(widths).toEqual([4, 8, 12, 16, 24, 32].map((n) => n * SLOT_WIDTH));
    // Strictly increasing: nothing gets narrower as it gets denser.
    for (let i = 1; i < widths.length; i += 1) {
      expect(widths[i]).toBeGreaterThan(widths[i - 1] ?? 0);
    }
  });

  it("keeps every slot the same width, so glyphs cannot overlap", () => {
    // A fret glyph is 12px mono, so at most about 14px for two digits. The
    // slot it sits in is the same 34px on every grid.
    for (const resolution of RESOLUTIONS) {
      const count = slotCount([4, 4], resolution);
      for (let slot = 1; slot < count; slot += 1) {
        expect(slotCentre(slot) - slotCentre(slot - 1)).toBe(SLOT_WIDTH);
      }
      expect(SLOT_WIDTH).toBeGreaterThan(20);
    }
  });

  it("makes the widest bar in the contract 1088px", () => {
    // Well past any phone, which is why the tab has its own scroller and the
    // page does not (spec 13.x). The smoke test checks that for real.
    expect(barWidth(slotCount([4, 4], 32))).toBe(1088);
  });

  it("puts beat ticks three slots apart on a triplet grid", () => {
    expect(slotsPerBeat([4, 4], 12)).toBe(3);
    expect(slotsPerBeat([4, 4], 24)).toBe(6);
    expect(slotsPerBeat([4, 4], 16)).toBe(4);
    expect(slotsPerBeat([4, 4], 32)).toBe(8);
  });
});

describe("what the bar header says about the grid", () => {
  it("says nothing on a piece written on one grid", () => {
    const written = bars(16, 16, 16, 16);
    expect(written.map((_, index) => gridLabelFor(written, index))).toEqual([
      "1/16",
      null,
      null,
      null,
    ]);
  });

  it("marks the bar the counting changes on", () => {
    const written = bars(16, 16, 32, 32, 16);
    expect(written.map((_, index) => gridLabelFor(written, index))).toEqual([
      "1/16",
      null,
      "1/32",
      null,
      "1/16",
    ]);
  });

  it("marks every triplet bar, changed or not", () => {
    const written = bars(24, 24, 24);
    expect(written.map((_, index) => gridLabelFor(written, index))).toEqual([
      "1/16 üçleme",
      "1/16 üçleme",
      "1/16 üçleme",
    ]);
  });

  it("never writes a bare 1/12 or 1/24 where a reader can see it", () => {
    for (const resolution of RESOLUTIONS) {
      const label = gridLabelFor(bars(resolution), 0);
      expect(label).not.toBe("1/12");
      expect(label).not.toBe("1/24");
    }
    expect(gridLabelFor(bars(12), 0)).toBe("1/8 üçleme");
    expect(gridLabelFor(bars(24), 0)).toBe("1/16 üçleme");
  });
});

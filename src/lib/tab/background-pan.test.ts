/**
 * The gesture arbitration behind background panning (2V-B.2 §6).
 *
 * The founder's natural workflow — finish the selection at the edge, release,
 * drag the background to the next bars, carry on — failed because the staff
 * had no gesture for its own background. These pin both halves of the fix:
 * that panning is offered when it should be, and that it never takes a press
 * some other gesture needs.
 */
import { describe, expect, it } from "vitest";

import { pointerOwner, stopsPageScroll } from "@/lib/tab/pointer-ownership";
import {
  isEmptyStaffBackground,
  PAN_THRESHOLD_PX,
  type PressPlace,
} from "@/lib/ui/use-background-pan";

const base = { penArmed: false, selectionAvailable: true } as const;

describe("when a press pans the background", () => {
  it("pans on empty background while a selection is held", () => {
    expect(
      pointerOwner({ ...base, onEmptyBackground: true, hasSelection: true }),
    ).toBe("background_pan");
  });

  it("still selects on empty background when nothing is held yet", () => {
    /*
     * The first long press on an empty staff must still select, or a reader
     * could never select an empty range — which is how they write into a bar
     * that has nothing in it.
     */
    expect(
      pointerOwner({ ...base, onEmptyBackground: true, hasSelection: false }),
    ).toBe("selection");
  });

  it("never takes a press that landed on something", () => {
    expect(
      pointerOwner({ ...base, onEmptyBackground: false, hasSelection: true }),
    ).toBe("selection");
  });
});

describe("what background panning may not outrank", () => {
  const panning = { ...base, onEmptyBackground: true, hasSelection: true };

  it("loses to a recognised note-range drag", () => {
    expect(pointerOwner({ ...panning, noteRangeOwning: true })).toBe("note_range");
  });

  it("loses to a recognised bar-range drag", () => {
    expect(pointerOwner({ ...panning, barRangeOwning: true })).toBe("bar_range");
  });

  it("loses to a duration handle", () => {
    expect(pointerOwner({ ...panning, onDurationHandle: true })).toBe("duration");
  });

  it("loses to a measure header", () => {
    expect(pointerOwner({ ...panning, onMeasureHeader: true })).toBe("measure");
  });

  it("loses to an armed writing pen", () => {
    /* A reader holding a pen means to write, and the background is where they
       write. Panning must not eat that. */
    expect(pointerOwner({ ...panning, penArmed: true })).toBe("pen");
  });
});

describe("panning and the page", () => {
  it("does not take the page's scroll away", () => {
    /*
     * A pan moves the tab's own scroller, so the page moving with it is the
     * same motion rather than a competing one. Taking `touch-action` from the
     * largest surface in the editor would be the bigger hammer.
     */
    expect(stopsPageScroll("background_pan")).toBe(false);
  });

  it("still lets the drags that do need it keep it", () => {
    expect(stopsPageScroll("duration")).toBe(true);
    expect(stopsPageScroll("bar_range")).toBe(true);
    expect(stopsPageScroll("note_range")).toBe(true);
  });
});

describe("the threshold", () => {
  it("is big enough that a tap is not a pan and small enough to feel direct", () => {
    expect(PAN_THRESHOLD_PX).toBeGreaterThanOrEqual(4);
    expect(PAN_THRESHOLD_PX).toBeLessThanOrEqual(16);
  });
});

describe("what counts as staff background", () => {
  /*
   * The staff has no gaps — every position is a cell button so a tap can
   * write there — so "empty background" has to mean "a cell with no music in
   * it" rather than "between the cells".
   */
  const place = (over: Partial<PressPlace> = {}): PressPlace => ({
    onHeader: false,
    onCell: true,
    onOnset: false,
    ...over,
  });

  it("counts an empty cell", () => {
    expect(isEmptyStaffBackground(place())).toBe(true);
  });

  it("does not count a cell with a note on it", () => {
    expect(isEmptyStaffBackground(place({ onOnset: true }))).toBe(false);
  });

  it("does not count a bar header, which has its own gesture", () => {
    expect(isEmptyStaffBackground(place({ onHeader: true }))).toBe(false);
  });

  it("does not let a header pan even when it holds no note", () => {
    expect(isEmptyStaffBackground(place({ onHeader: true, onCell: false }))).toBe(
      false,
    );
  });

  it("counts the strip past the last bar", () => {
    expect(isEmptyStaffBackground(place({ onCell: false }))).toBe(true);
  });
});

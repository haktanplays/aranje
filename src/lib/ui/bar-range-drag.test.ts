import { describe, expect, it } from "vitest";

import {
  IDLE,
  dragRange,
  moveDrag,
  ownsPointer,
  pressBar,
  recogniseDrag,
  releaseDrag,
  type BarRangeDrag,
} from "@/lib/ui/bar-range-drag";
import { LONG_PRESS_MOVE_TOLERANCE_PX } from "@/lib/ui/interaction";
import { pointerOwner, stopsPageScroll } from "@/lib/tab/pointer-ownership";

const P = 7;
const held = (barIndex: number): BarRangeDrag =>
  recogniseDrag(pressBar(P, 100, 100, barIndex, "s1"), P);
/** A bar under the finger, in the section the drag started in. */
const at = (barIndex: number, sectionId = "s1") => ({ barIndex, sectionId });

describe("holding a bar and reaching across its neighbours", () => {
  it("owns nothing while the press might still be a scroll", () => {
    const pressing = pressBar(P, 100, 100, 0, "s1");
    expect(pressing.kind).toBe("pressing");
    /*
     * §8 item 1, and the reason this cannot be answered by `touch-action`.
     * The page must still scroll from a bar number, because that is what
     * most presses on one are.
     */
    expect(ownsPointer(pressing)).toBe(false);
  });

  it("takes the pointer only once the threshold has elapsed", () => {
    expect(ownsPointer(held(2))).toBe(true);
  });

  it("gives the gesture to the scroller when the finger wanders first", () => {
    const pressing = pressBar(P, 100, 100, 0, "s1");
    const moved = moveDrag(
      pressing,
      P,
      100 + LONG_PRESS_MOVE_TOLERANCE_PX,
      100,
      null,
    );
    expect(moved).toEqual(IDLE);
    /* And it does not come back if the finger settles again. */
    expect(recogniseDrag(moved, P).kind).toBe("idle");
  });

  it("survives a wobble inside the tolerance", () => {
    const pressing = pressBar(P, 100, 100, 0, "s1");
    const moved = moveDrag(pressing, P, 100 + (LONG_PRESS_MOVE_TOLERANCE_PX - 1), 100, null);
    expect(moved.kind).toBe("pressing");
    expect(ownsPointer(recogniseDrag(moved, P))).toBe(true);
  });

  it("grows the run as the finger reaches to the right", () => {
    const reached = moveDrag(held(1), P, 300, 100, at(3));
    expect(dragRange(reached)).toEqual({ startBarIndex: 1, endBarIndex: 3 });
  });

  it("grows it to the left as well, with the anchor still in it", () => {
    const reached = moveDrag(held(3), P, 40, 100, at(1));
    expect(dragRange(reached)).toEqual({ startBarIndex: 1, endBarIndex: 3 });
  });

  it("shrinks the run when the finger comes back", () => {
    const wide = moveDrag(held(1), P, 300, 100, at(4));
    expect(dragRange(wide)).toEqual({ startBarIndex: 1, endBarIndex: 4 });
    const back = moveDrag(wide, P, 150, 100, at(2));
    expect(dragRange(back)).toEqual({ startBarIndex: 1, endBarIndex: 2 });
    /* All the way back to the one bar it started on. */
    const home = moveDrag(back, P, 100, 100, at(1));
    expect(dragRange(home)).toEqual({ startBarIndex: 1, endBarIndex: 1 });
  });

  it("holds still when the finger leaves the bars entirely", () => {
    const reached = moveDrag(held(1), P, 300, 100, at(3));
    const offBars = moveDrag(reached, P, 300, 900, null);
    expect(dragRange(offBars)).toEqual({ startBarIndex: 1, endBarIndex: 3 });
  });

  it("returns the same object when the reach did not change bar", () => {
    const reached = moveDrag(held(1), P, 300, 100, at(3));
    /* Identity, not equality: a new object here re-renders the whole staff. */
    expect(moveDrag(reached, P, 305, 100, at(3))).toBe(reached);
  });

  it("ignores a second finger", () => {
    const owning = held(1);
    expect(moveDrag(owning, P + 1, 900, 100, at(5))).toBe(owning);
    expect(recogniseDrag(pressBar(P, 0, 0, 0, "s1"), P + 1).kind).toBe("pressing");
  });

  it("lets go on pointerup and on pointercancel alike", () => {
    /*
     * One release for both. A cleanup that only ran on pointerup would leave
     * the page unscrollable whenever the platform interrupted a drag, turning
     * the founder's bug into a permanent one.
     */
    expect(releaseDrag()).toEqual(IDLE);
    expect(ownsPointer(releaseDrag())).toBe(false);
  });

  it("never produces a range with a hole in it", () => {
    /*
     * Not enforced — unrepresentable. A range is an anchor and a reach, so
     * every bar between them is in it, and no validator can be forgotten.
     */
    const range = dragRange(moveDrag(held(0), P, 300, 100, at(5)));
    expect(range).toEqual({ startBarIndex: 0, endBarIndex: 5 });
  });

  it("stops at a section boundary instead of naming the wrong bar", () => {
    /*
     * Every section numbers its bars from zero, so an index alone does not
     * identify a bar. A reach into the next section must not be read as a
     * reach to that index in this one.
     */
    const reached = moveDrag(held(1), P, 300, 100, at(3));
    const across = moveDrag(reached, P, 600, 100, at(0, "s2"));
    expect(dragRange(across)).toEqual({ startBarIndex: 1, endBarIndex: 3 });
  });

  it("has no range before it owns the pointer", () => {
    expect(dragRange(pressBar(P, 0, 0, 2, "s1"))).toBeNull();
    expect(dragRange(IDLE)).toBeNull();
  });
});

describe("what the ownership means for the page", () => {
  it("outranks every other claim on the pointer once recognised", () => {
    expect(
      pointerOwner({
        barRangeOwning: true,
        onDurationHandle: true,
        onMeasureHeader: true,
        penArmed: true,
        selectionAvailable: true,
      }),
    ).toBe("bar_range");
  });

  it("is an ordinary measure press until then", () => {
    expect(
      pointerOwner({
        barRangeOwning: false,
        onMeasureHeader: true,
        penArmed: true,
        selectionAvailable: true,
      }),
    ).toBe("measure");
  });

  it("stops the page scrolling, and a plain measure press does not", () => {
    expect(stopsPageScroll("bar_range")).toBe(true);
    /* §8 item 9: the staff outside the drag still scrolls normally. */
    expect(stopsPageScroll("measure")).toBe(false);
    expect(stopsPageScroll("selection")).toBe(false);
    expect(stopsPageScroll("pen")).toBe(false);
    expect(stopsPageScroll("none")).toBe(false);
  });
});

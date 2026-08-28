import { describe, expect, it } from "vitest";

import { pointerOwner, stopsPageScroll } from "@/lib/tab/pointer-ownership";

describe("pointerOwner", () => {
  it("gives the press to the selection when nothing is held", () => {
    expect(pointerOwner({ penArmed: false, selectionAvailable: true })).toBe("selection");
  });

  /*
   * The live defect: the pen was armed, the reader held a beat, and a time
   * selection opened underneath the ghost. Both gestures had started.
   */
  it("gives the press to the pen, and takes it from the selection", () => {
    expect(pointerOwner({ penArmed: true, selectionAvailable: true })).toBe("pen");
  });

  it("is decided by what is held, not by which timer wins", () => {
    // Same inputs, same answer, every time and in any order.
    for (let run = 0; run < 3; run += 1) {
      expect(pointerOwner({ penArmed: true, selectionAvailable: true })).toBe("pen");
      expect(pointerOwner({ penArmed: false, selectionAvailable: true })).toBe("selection");
    }
  });

  it("owns nothing on a surface with neither", () => {
    expect(pointerOwner({ penArmed: false, selectionAvailable: false })).toBe("none");
    expect(pointerOwner({ penArmed: true, selectionAvailable: false })).toBe("pen");
  });
});

describe("the duration handle", () => {
  /*
   * §2.6: the founder's finger moved a duration handle and the page scrolled
   * out from under it. A gesture decided after the fact, by whoever moved
   * first, is a gesture the reader loses on a slow phone.
   */
  it("wins outright, over every tool and over the selection", () => {
    expect(
      pointerOwner({ onDurationHandle: true, penArmed: true, selectionAvailable: true }),
    ).toBe("duration");
    expect(
      pointerOwner({ onDurationHandle: true, penArmed: false, selectionAvailable: true }),
    ).toBe("duration");
  });

  it("changes nothing when the finger is not on it", () => {
    expect(
      pointerOwner({ onDurationHandle: false, penArmed: true, selectionAvailable: true }),
    ).toBe("pen");
    expect(
      pointerOwner({ onDurationHandle: false, penArmed: false, selectionAvailable: true }),
    ).toBe("selection");
  });

  /*
   * The page still scrolls. Only the handle refuses, because switching off
   * scrolling everywhere would fix one gesture by breaking the commonest one.
   */
  it("stops the page scrolling under itself and nowhere else", () => {
    expect(stopsPageScroll("duration")).toBe(true);
    expect(stopsPageScroll("pen")).toBe(false);
    expect(stopsPageScroll("selection")).toBe(false);
    expect(stopsPageScroll("none")).toBe(false);
  });
});

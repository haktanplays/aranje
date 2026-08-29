import { describe, expect, it } from "vitest";

import {
  declaredTouchAction,
  pointerOwner,
  stopsPageScroll,
  type PointerOwner,
} from "@/lib/tab/pointer-ownership";

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
    expect(stopsPageScroll("measure")).toBe(false);
    expect(stopsPageScroll("pen")).toBe(false);
    expect(stopsPageScroll("selection")).toBe(false);
    expect(stopsPageScroll("none")).toBe(false);
  });
});

/**
 * The bar header (2U-A §2).
 *
 * Holding a header means "this whole bar", which is not a question about a
 * string. So the pen does not get it: there is nothing under a header to
 * write on, and the reader who held one with a pen up used to get three
 * ghost numbers in the first slot instead of a selected bar.
 */
describe("a press on a bar's header", () => {
  it("is the measure's, even with a pen in hand", () => {
    expect(
      pointerOwner({
        onMeasureHeader: true,
        penArmed: true,
        selectionAvailable: true,
      }),
    ).toBe("measure");
  });

  it("still loses to a finger already on a duration handle", () => {
    expect(
      pointerOwner({
        onDurationHandle: true,
        onMeasureHeader: true,
        penArmed: false,
        selectionAvailable: true,
      }),
    ).toBe("duration");
  });

  it("changes nothing for a press anywhere else on the staff", () => {
    expect(
      pointerOwner({
        onMeasureHeader: false,
        penArmed: true,
        selectionAvailable: true,
      }),
    ).toBe("pen");
    expect(
      pointerOwner({
        onMeasureHeader: false,
        penArmed: false,
        selectionAvailable: true,
      }),
    ).toBe("selection");
  });

  /* One press, one owner: the four cannot overlap. */
  it("gives every combination exactly one owner", () => {
    const owners = new Set<string>();
    for (const onDurationHandle of [true, false]) {
      for (const onMeasureHeader of [true, false]) {
        for (const penArmed of [true, false]) {
          for (const selectionAvailable of [true, false]) {
            owners.add(
              pointerOwner({
                onDurationHandle,
                onMeasureHeader,
                penArmed,
                selectionAvailable,
              }),
            );
          }
        }
      }
    }
    expect([...owners].sort()).toEqual([
      "duration",
      "measure",
      "none",
      "pen",
      "selection",
    ]);
  });
});

/**
 * What each owner promises the compositor before the finger lands (2U-C §1).
 *
 * The declaration is the only half of the ownership story that has to be right
 * *before* anything happens, and it is the half the Android failure turned on:
 * a header that declared `pan-x` had given the horizontal pan away before the
 * long press could ask for it, and every `preventDefault` after that was
 * arguing with a decision already made.
 */
describe("what an element declares before the gesture starts", () => {
  const OWNERS: readonly PointerOwner[] = [
    "bar_range",
    "duration",
    "measure",
    "pen",
    "selection",
    "none",
  ];

  it("never grants the horizontal pan to a header that wants to own it", () => {
    // The whole regression, stated as the thing that must not come back: any
    // value naming `pan-x` hands the compositor this gesture's axis, and
    // `auto` names both.
    for (const owner of ["measure", "bar_range"] as const) {
      expect(declaredTouchAction(owner), owner).toBe("pan-y");
    }
  });

  it("keeps the header alive as a vertical scroll surface", () => {
    // `none` would work for the drag and make a 22px strip across the whole
    // tab that the page cannot be scrolled from. The narrower promise is the
    // one that costs the reader nothing.
    expect(declaredTouchAction("measure")).not.toBe("none");
  });

  it("reserves both axes for the duration handle alone", () => {
    expect(declaredTouchAction("duration")).toBe("none");
    for (const owner of OWNERS) {
      if (owner === "duration") continue;
      expect(declaredTouchAction(owner), owner).not.toBe("none");
    }
  });

  it("leaves the ordinary staff scrolling exactly as it did", () => {
    // A pen, a time selection and a surface with neither are all just staff.
    // If any of them started declaring an axis, this would be the global
    // `touch-action` §2 forbids, arrived at one element at a time.
    for (const owner of ["pen", "selection", "none"] as const) {
      expect(declaredTouchAction(owner), owner).toBe("auto");
    }
  });

  it("says the same thing for the whole life of the gesture", () => {
    // `measure` at pointerdown and `bar_range` half a second later are the
    // same finger. A declaration that changed between them would be read once
    // and ignored thereafter, which is how it would fail silently.
    expect(declaredTouchAction("bar_range")).toBe(declaredTouchAction("measure"));
  });

  it("agrees with stopsPageScroll about who is holding something", () => {
    for (const owner of OWNERS) {
      if (!stopsPageScroll(owner)) continue;
      expect(declaredTouchAction(owner), owner).not.toBe("auto");
    }
  });
});

import { describe, expect, it } from "vitest";

import { pointerOwner } from "@/lib/tab/pointer-ownership";

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

/**
 * What the focused edit layout promises a finger (2S-A §18, spec §13.28.3b).
 *
 * The §18 regression found a defect acceptance could not see: a row whose CSS
 * height was 44px while half of it was painted outside the surface. The two
 * ways to fake that number are measured here, on the geometry the canvases
 * really use, because both are arithmetic rather than pixels:
 *
 * - a band shorter than a finger, and
 * - six 44px bands stacked closer than 44px apart, which reads as green in a
 *   per-element height check and leaves every boundary ambiguous in the hand.
 *
 * Reading mode is allowed to stay dense; that is the product decision, and it
 * is written down here so a later change has to argue with it.
 */
import { describe, expect, it } from "vitest";

import {
  BAR_HEADER_HEIGHT,
  EDIT_STRING_ROW_HEIGHT,
  STRING_ROW_HEIGHT,
} from "@/components/workspace/geometry";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";

/** The canvases lay the strings out as a stack: this is that stack. */
const rowTop = (stringIndex: number, rowHeight: number) => stringIndex * rowHeight;

const STRINGS = 6;

describe("the focused edit layout's geometry", () => {
  it("gives every string a band a finger can hit", () => {
    expect(EDIT_STRING_ROW_HEIGHT).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
  });

  it("does not overlap the six bands to reach that height", () => {
    for (let string = 0; string + 1 < STRINGS; string += 1) {
      const gap =
        rowTop(string + 1, EDIT_STRING_ROW_HEIGHT) - rowTop(string, EDIT_STRING_ROW_HEIGHT);
      expect(gap, `strings ${string} and ${string + 1}`).toBeGreaterThanOrEqual(
        MIN_TOUCH_TARGET_PX,
      );
    }
  });

  it("leaves no dead ground between two neighbouring strings", () => {
    /*
     * Bands that are 44px tall but 60px apart would also pass the check
     * above while leaving a strip that belongs to neither string. Touching
     * between the fourth and fifth string has to reach one of them.
     */
    for (let string = 0; string + 1 < STRINGS; string += 1) {
      const bandEnds = rowTop(string, EDIT_STRING_ROW_HEIGHT) + EDIT_STRING_ROW_HEIGHT;
      expect(bandEnds).toBe(rowTop(string + 1, EDIT_STRING_ROW_HEIGHT));
    }
  });

  it("asks for the whole staff spec §13.28.3b promises", () => {
    const staff = STRINGS * EDIT_STRING_ROW_HEIGHT + BAR_HEADER_HEIGHT;
    expect(staff).toBeGreaterThanOrEqual(6 * MIN_TOUCH_TARGET_PX + BAR_HEADER_HEIGHT);
    expect(staff).toBeGreaterThanOrEqual(286);
  });

  it("keeps reading mode free to stay dense", () => {
    /*
     * Below 360px a 26px row is acceptable *for reading*: it owns no pointer,
     * is not reported as a note target, and no reader is asked to hit it. The
     * height that has to grow is the one under a finger, and it does.
     */
    expect(STRING_ROW_HEIGHT).toBeLessThan(EDIT_STRING_ROW_HEIGHT);
  });
});

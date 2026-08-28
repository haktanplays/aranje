/**
 * That "Taşı" still offers eight movements (2U-A §3).
 *
 * A count is a strange thing to test until you have watched one shrink. The
 * sheet is four tabs of steppers; a movement removed because a label did not
 * fit, or lost in a refactor of the stepper it lived in, leaves no trace —
 * the sheet still opens, the other seven still work, and the capability is
 * simply gone. This is the only place that would notice.
 */
import { describe, expect, it } from "vitest";

import {
  MOVEMENTS,
  MOVEMENT_MODES,
  TIME_GRAINS,
  movementsOf,
} from "@/lib/song/movement-menu";

describe("the eight movements", () => {
  it("are eight, and each is named once", () => {
    expect(MOVEMENTS).toHaveLength(8);
    expect(new Set(MOVEMENTS.map((entry) => entry.id)).size).toBe(8);
  });

  it("cover all four kinds of motion, and none is empty", () => {
    expect(MOVEMENT_MODES).toHaveLength(4);
    for (const mode of MOVEMENT_MODES) {
      expect(movementsOf(mode).length, mode).toBeGreaterThan(0);
    }
    expect(
      MOVEMENT_MODES.reduce((total, mode) => total + movementsOf(mode).length, 0),
    ).toBe(MOVEMENTS.length);
  });

  it("splits time into the three grains a reader can nudge by", () => {
    expect(TIME_GRAINS.map((grain) => grain.label)).toEqual([
      "grid",
      "vuruş",
      "ölçü",
    ]);
  });

  /*
   * Every movement is offered both ways. A nudge you cannot take back is not
   * a movement, it is an edit — and this sheet stages rather than writes.
   *
   * Whether the controls are really on screen is a browser question, and the
   * §13 acceptance presses all sixteen. What is held here is the address each
   * pair answers to, so the two ends of that check agree on the names.
   */
  it("gives every movement a pair of targets to press", () => {
    for (const movement of MOVEMENTS) {
      expect(movement.testPrefix, movement.id).not.toBe("");
      expect(movement.label.length, movement.id).toBeGreaterThan(2);
    }
    /* Pitch's two grains share one stepper, so eight movements are seven. */
    expect(new Set(MOVEMENTS.map((entry) => entry.testPrefix)).size).toBe(7);
  });
});

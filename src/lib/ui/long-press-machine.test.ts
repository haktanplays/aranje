/**
 * A long press must never be triggered by a scroll (spec 13.1).
 *
 * The tab is a horizontal scroller and the same finger does both jobs, so this
 * is the interaction most likely to feel broken if it is even slightly wrong.
 */
import { describe, expect, it } from "vitest";

import {
  cancelled,
  hasFired,
  IDLE,
  movedTo,
  press,
  released,
} from "@/lib/ui/long-press-machine";
import { LONG_PRESS_MOVE_TOLERANCE_PX, LONG_PRESS_MS } from "@/lib/ui/interaction";

describe("long press", () => {
  it("fires once the finger has been still for the threshold", () => {
    const state = press(100, 100, 0);
    expect(hasFired(state, LONG_PRESS_MS)).toBe(true);
  });

  it("does not fire early", () => {
    const state = press(100, 100, 0);
    expect(hasFired(state, LONG_PRESS_MS - 1)).toBe(false);
  });

  it("is abandoned by a horizontal drag, which is a tab scroll", () => {
    const state = movedTo(press(100, 100, 0), 100 + LONG_PRESS_MOVE_TOLERANCE_PX, 100);
    expect(state.kind).toBe("abandoned");
    expect(hasFired(state, LONG_PRESS_MS * 2)).toBe(false);
  });

  it("is abandoned by a vertical drag, which is a page scroll", () => {
    const state = movedTo(press(100, 100, 0), 100, 100 + LONG_PRESS_MOVE_TOLERANCE_PX);
    expect(hasFired(state, LONG_PRESS_MS * 2)).toBe(false);
  });

  it("survives a wobble that is not a drag", () => {
    const state = movedTo(press(100, 100, 0), 102, 101);
    expect(state.kind).toBe("pressing");
    expect(hasFired(state, LONG_PRESS_MS)).toBe(true);
  });

  it("does not come back after the finger wanders and settles again", () => {
    const wandered = movedTo(press(100, 100, 0), 140, 100);
    const settled = movedTo(wandered, 100, 100);
    expect(settled.kind).toBe("abandoned");
    expect(hasFired(settled, LONG_PRESS_MS * 2)).toBe(false);
  });

  it("never fires once the platform has taken the gesture", () => {
    expect(hasFired(cancelled(), LONG_PRESS_MS * 2)).toBe(false);
  });

  it("never fires from idle or after release", () => {
    expect(hasFired(IDLE, LONG_PRESS_MS * 2)).toBe(false);
    expect(hasFired(released(), LONG_PRESS_MS * 2)).toBe(false);
  });
});

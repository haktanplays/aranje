/**
 * Telling a hold apart from a scroll (2U-C §2, §3).
 *
 * The lifecycle both range gestures share, tested once where it lives rather
 * than twice through the two hooks that wrap it — a rule proved through one
 * caller is a rule the other caller can quietly stop obeying.
 */
import { describe, expect, it } from "vitest";

import { LONG_PRESS_MOVE_TOLERANCE_PX } from "@/lib/ui/interaction";
import {
  IDLE,
  beginPress,
  holding,
  ownsPress,
  recognise,
  releasePress,
  wandered,
} from "@/lib/ui/press-drag";

const P = 7;
const pressing = () => beginPress(P, 100, 100, "anchor");
const owning = () => recognise(pressing(), P);

describe("a press that might still be a scroll", () => {
  it("owns nothing while it might be", () => {
    // The whole reason this is staged: the page must keep scrolling from
    // wherever the finger landed, because that is what most presses are.
    expect(ownsPress(pressing())).toBe(false);
  });

  it("takes the pointer once the threshold has elapsed", () => {
    expect(ownsPress(owning())).toBe(true);
  });

  it("keeps what the gesture was holding across recognition", () => {
    const next = owning();
    expect(next.kind === "owning" && next.held).toBe("anchor");
  });

  it("survives a wobble inside the tolerance", () => {
    const nudge = LONG_PRESS_MOVE_TOLERANCE_PX - 1;
    expect(wandered(pressing(), 100 + nudge, 100 + nudge)).toBe(false);
  });

  it("gives the gesture up on either axis", () => {
    // Vertical too: a finger that slid down the staff is scrolling the page,
    // and a press that only watched x would take a sequence the browser has.
    expect(wandered(pressing(), 100 + LONG_PRESS_MOVE_TOLERANCE_PX, 100)).toBe(true);
    expect(wandered(pressing(), 100, 100 + LONG_PRESS_MOVE_TOLERANCE_PX)).toBe(true);
  });

  it("asks nothing of a gesture that is not pressing", () => {
    expect(wandered(IDLE, 9999, 9999)).toBe(false);
    expect(wandered(owning(), 9999, 9999)).toBe(false);
  });

  it("ignores a timer that outlived its own pointer", () => {
    // A recognition for a different pointer would claim a sequence that
    // belongs to something else.
    expect(recognise(pressing(), P + 1).kind).toBe("pressing");
    expect(recognise(IDLE, P).kind).toBe("idle");
  });

  it("does not come back once it has been let go", () => {
    expect(recognise(releasePress(), P).kind).toBe("idle");
    expect(ownsPress(releasePress())).toBe(false);
  });
});

describe("what the gesture is holding", () => {
  it("can be replaced without touching the lifecycle", () => {
    const next = holding(owning(), "reached");
    expect(next.kind).toBe("owning");
    expect(next.kind === "owning" && next.held).toBe("reached");
  });

  it("is nothing to an idle gesture", () => {
    expect(holding(IDLE, "reached")).toBe(IDLE);
  });
});

describe("which pointer owns", () => {
  it("answers for the sequence that started it and no other", () => {
    expect(ownsPress(owning(), P)).toBe(true);
    expect(ownsPress(owning(), P + 1)).toBe(false);
  });
});

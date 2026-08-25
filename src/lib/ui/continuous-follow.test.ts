/**
 * The reading anchor and who owns the view (2Q-C §5, §6, §7, §11).
 *
 * The baseline these tests exist to answer measured a surface that stood still
 * for a dozen frames and then moved up to 770 pixels in one. Every claim here
 * is about the property that replaces it: the scroll position is a function of
 * the playhead's position, so there is no state that can accumulate and no
 * jump that can be saved up.
 */
import { describe, expect, it } from "vitest";

import {
  anchorOffsetPx,
  desiredScrollLeft,
  followMode,
  followsContinuously,
  followTailPx,
  FOLLOW_ANCHOR_FRACTION,
  INITIAL_FOLLOW_STATE,
  nextFollowState,
  reducedMotionScrollLeft,
  type FollowEvent,
  type FollowState,
} from "@/lib/ui/continuous-follow";

const VIEWPORT = { widthPx: 390, contentWidthPx: 20000 } as const;
const NARROW = { widthPx: 320, contentWidthPx: 20000 } as const;

/** Where the playhead lands on screen for a given scroll position. */
const onScreen = (playheadX: number, scrollLeft: number) => playheadX - scrollLeft;

describe("236. the playhead keeps one place on the screen", () => {
  it("puts it at the anchor once the song is under way", () => {
    const x = 5000;
    const scroll = desiredScrollLeft(x, VIEWPORT);
    expect(onScreen(x, scroll)).toBeCloseTo(390 * FOLLOW_ANCHOR_FRACTION, 6);
  });

  it("keeps it there whatever the viewport is", () => {
    const x = 5000;
    for (const width of [320, 360, 390, 430, 768]) {
      const scroll = desiredScrollLeft(x, { widthPx: width, contentWidthPx: 20000 });
      expect(onScreen(x, scroll) / width).toBeCloseTo(FOLLOW_ANCHOR_FRACTION, 6);
    }
  });

  it("leaves about two thirds of the screen for what is coming", () => {
    const ahead = 1 - FOLLOW_ANCHOR_FRACTION;
    expect(ahead).toBeGreaterThan(0.6);
    expect(ahead).toBeLessThan(0.7);
  });

  it("moves exactly as far as the music does", () => {
    // The property the whole phase is for: one pixel of music is one pixel of
    // scroll, so there is nothing to accumulate into a jump.
    const a = desiredScrollLeft(5000, VIEWPORT);
    const b = desiredScrollLeft(5029, VIEWPORT);
    expect(b - a).toBeCloseTo(29, 6);
  });

  it("never asks for a scroll larger than the frame's travel", () => {
    let previous = desiredScrollLeft(0, NARROW);
    let largest = 0;
    // 30px per frame is the fastest this app can go: 1/32 at 260 BPM, 150%.
    for (let x = 30; x < 12000; x += 30) {
      const next = desiredScrollLeft(x, NARROW);
      largest = Math.max(largest, Math.abs(next - previous));
      previous = next;
    }
    // Floating point, not slack: the claim is that no frame moves further
    // than the music did in it.
    expect(largest).toBeLessThanOrEqual(30 + 1e-9);
  });
});

describe("237. the start and the end of the song are the clamp, not a rule", () => {
  it("lets the playhead cross the screen at the start", () => {
    // Nothing to the left to scroll away, so the surface stays put and the
    // playhead simply moves.
    expect(desiredScrollLeft(0, VIEWPORT)).toBe(0);
    expect(desiredScrollLeft(50, VIEWPORT)).toBe(0);
    expect(desiredScrollLeft(anchorOffsetPx(390) - 1, VIEWPORT)).toBe(0);
  });

  it("starts moving exactly when the playhead reaches the anchor", () => {
    const anchor = anchorOffsetPx(390);
    expect(desiredScrollLeft(anchor, VIEWPORT)).toBe(0);
    expect(desiredScrollLeft(anchor + 10, VIEWPORT)).toBeCloseTo(10, 6);
  });

  it("stops at the end of the content and lets the playhead run on", () => {
    const view = { widthPx: 390, contentWidthPx: 1000 };
    const max = 1000 - 390;
    expect(desiredScrollLeft(990, view)).toBe(max);
    expect(desiredScrollLeft(1000, view)).toBe(max);
    // Having stopped, the playhead is past the anchor rather than pinned to it.
    expect(onScreen(1000, max)).toBeGreaterThan(anchorOffsetPx(390));
  });

  it("never scrolls a content shorter than the viewport", () => {
    const view = { widthPx: 390, contentWidthPx: 200 };
    for (const x of [0, 50, 199, 200]) expect(desiredScrollLeft(x, view)).toBe(0);
  });

  it("adds a tail that is long enough for the last bar to reach the anchor", () => {
    // The tail is what is left of the viewport after the anchor: with it, the
    // final tick can sit where every other tick sat.
    expect(followTailPx(390) + anchorOffsetPx(390)).toBeCloseTo(390, 6);
    const musicWidth = 4000;
    const view = { widthPx: 390, contentWidthPx: musicWidth + followTailPx(390) };
    expect(onScreen(musicWidth, desiredScrollLeft(musicWidth, view))).toBeCloseTo(
      anchorOffsetPx(390),
      6,
    );
  });

  it("is a function of the position, so a seek lands in one frame", () => {
    // Seeking backward over a whole song is the same call as advancing a
    // pixel: there is no easing state that could take several frames to
    // unwind, and a loop wrap is the same seek.
    const far = desiredScrollLeft(15000, VIEWPORT);
    const back = desiredScrollLeft(120, VIEWPORT);
    expect(far).toBeGreaterThan(back);
    expect(desiredScrollLeft(120, VIEWPORT)).toBe(back);
  });
});

describe("238. who owns the horizontal position", () => {
  const after = (events: readonly FollowEvent[], from = INITIAL_FOLLOW_STATE) =>
    events.reduce<FollowState>(nextFollowState, from);

  it("follows until the reader does something", () => {
    expect(followMode(INITIAL_FOLLOW_STATE)).toBe("following");
    expect(followsContinuously(INITIAL_FOLLOW_STATE)).toBe(true);
  });

  it("hands the view over for every gesture that is the reader's", () => {
    const takeovers: readonly FollowEvent["type"][] = [
      "user_scrolled",
      "user_touched_surface",
      "bar_operation",
      "sheet_opened",
      "user_scrolled_to_section",
    ];
    for (const type of takeovers) {
      const state = after([{ type } as FollowEvent]);
      expect(followMode(state)).toBe("manual");
      expect(followsContinuously(state)).toBe(false);
    }
  });

  it("gives it back only when the reader asks for it back", () => {
    const restores: readonly FollowEvent["type"][] = [
      "playback_started",
      "playback_resumed",
      "return_to_playback",
      "explicit_seek",
    ];
    for (const type of restores) {
      const state = after([{ type: "user_scrolled" }, { type } as FollowEvent]);
      expect(followMode(state)).toBe("following");
    }
  });

  it("does not count the surface's own scroll as a takeover", () => {
    // There is no event for it, which is the point: `desiredScrollLeft` is
    // applied by the surface and produces no state change at all.
    const before = after([{ type: "playback_started" }]);
    expect(followMode(before)).toBe("following");
    expect(desiredScrollLeft(9999, VIEWPORT)).toBeGreaterThan(0);
    expect(followMode(before)).toBe("following");
  });

  it("keeps the same object when nothing changed", () => {
    // A new object every frame would re-render both surfaces sixty times a
    // second to say the same thing.
    const state = after([{ type: "user_scrolled" }]);
    expect(nextFollowState(state, { type: "user_scrolled" })).toBe(state);
    expect(
      nextFollowState(INITIAL_FOLLOW_STATE, { type: "playback_started" }),
    ).toBe(INITIAL_FOLLOW_STATE);
    expect(
      nextFollowState(INITIAL_FOLLOW_STATE, {
        type: "reduce_motion_changed",
        reduce: false,
      }),
    ).toBe(INITIAL_FOLLOW_STATE);
  });

  it("remembers the takeover underneath a reduced-motion setting", () => {
    const state = after([
      { type: "user_scrolled" },
      { type: "reduce_motion_changed", reduce: true },
    ]);
    expect(followMode(state)).toBe("reduced_motion");
    const back = nextFollowState(state, {
      type: "reduce_motion_changed",
      reduce: false,
    });
    expect(followMode(back)).toBe("manual");
  });
});

describe("239. reduced motion is fewer scrolls, not a frozen surface", () => {
  it("says so in the mode, whatever the reader has done", () => {
    const reduced = nextFollowState(INITIAL_FOLLOW_STATE, {
      type: "reduce_motion_changed",
      reduce: true,
    });
    expect(followMode(reduced)).toBe("reduced_motion");
    expect(followsContinuously(reduced)).toBe(false);
    expect(
      followsContinuously(nextFollowState(reduced, { type: "playback_started" })),
    ).toBe(false);
  });

  it("holds still while the playhead is comfortably on screen", () => {
    const scroll = 1000;
    expect(reducedMotionScrollLeft(1200, scroll, VIEWPORT)).toBeNull();
    expect(reducedMotionScrollLeft(1300, scroll, VIEWPORT)).toBeNull();
  });

  it("catches up in one move when it is about to leave", () => {
    const scroll = 1000;
    const target = reducedMotionScrollLeft(1385, scroll, VIEWPORT);
    expect(target).not.toBeNull();
    expect(onScreen(1385, target!)).toBeCloseTo(anchorOffsetPx(390), 6);
  });

  it("moves a handful of times a song rather than once a frame", () => {
    let scroll = 0;
    let moves = 0;
    for (let x = 0; x <= 12000; x += 30) {
      const target = reducedMotionScrollLeft(x, scroll, NARROW);
      if (target !== null) {
        scroll = target;
        moves += 1;
      }
    }
    // 401 frames of travel over 12000px of music at the app's top speed.
    const frames = 401;
    expect(moves).toBeGreaterThan(0);
    expect(moves).toBeLessThan(frames / 5);
    // And each one is a real move rather than a nudge: the surface holds
    // still for more than half a viewport of music between them.
    expect(12000 / moves).toBeGreaterThan(NARROW.widthPx / 2);
  });

  it("catches up when the playhead is behind the viewport too", () => {
    const target = reducedMotionScrollLeft(600, 2000, VIEWPORT);
    expect(target).not.toBeNull();
    expect(onScreen(600, target!)).toBeCloseTo(anchorOffsetPx(390), 6);
  });
});

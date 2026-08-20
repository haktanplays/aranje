import { describe, expect, it } from "vitest";

import { GUTTER_WIDTH, SLOT_WIDTH } from "@/components/workspace/geometry";
import {
  barLeft,
  barPixelWidth,
  followScrollLeft,
  playheadX,
} from "@/components/workspace/playhead";
import { positionAtTicks } from "@/lib/audio/position";
import { buildSongPlan } from "@/lib/audio/schedule";
import { PPQ } from "@/lib/music/timing";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const PLAN = buildSongPlan(SAMPLE_SONG);
const BAR_TICKS = PPQ * 4;
const BAR_PX = 8 * SLOT_WIDTH;

describe("bar geometry", () => {
  it("starts the first bar just past the gutter", () => {
    expect(barLeft(PLAN, 0)).toBe(GUTTER_WIDTH);
  });

  it("lays bars end to end", () => {
    expect(barLeft(PLAN, 1)).toBe(GUTTER_WIDTH + BAR_PX);
    expect(barLeft(PLAN, 4)).toBe(GUTTER_WIDTH + BAR_PX * 4);
  });

  it("sizes a bar from its slot count", () => {
    expect(barPixelWidth(PLAN, 0)).toBe(BAR_PX);
  });
});

describe("playhead position", () => {
  it("sits at the left edge of bar one at the start", () => {
    expect(playheadX(PLAN, positionAtTicks(PLAN, 0))).toBe(GUTTER_WIDTH);
  });

  it("advances across the bar with the transport", () => {
    const halfway = playheadX(PLAN, positionAtTicks(PLAN, BAR_TICKS / 2));
    expect(halfway).toBeCloseTo(GUTTER_WIDTH + BAR_PX / 2, 5);
  });

  it("lands exactly on the next bar line", () => {
    expect(playheadX(PLAN, positionAtTicks(PLAN, BAR_TICKS))).toBe(
      GUTTER_WIDTH + BAR_PX,
    );
  });

  it("is nowhere once the song has ended", () => {
    expect(playheadX(PLAN, positionAtTicks(PLAN, PLAN.totalTicks))).toBeNull();
  });

  it("moves monotonically through the song", () => {
    let previous = -1;
    for (let ticks = 0; ticks < PLAN.totalTicks; ticks += PPQ) {
      const x = playheadX(PLAN, positionAtTicks(PLAN, ticks)) ?? -1;
      expect(x).toBeGreaterThan(previous);
      previous = x;
    }
  });
});

describe("viewport follow", () => {
  const view = { scrollLeft: 0, clientWidth: 390 };
  const content = GUTTER_WIDTH + BAR_PX * 8;

  it("stays put while the playhead is comfortably visible", () => {
    expect(followScrollLeft(100, view, content)).toBeNull();
  });

  it("scrolls once the playhead passes the right edge", () => {
    const target = followScrollLeft(500, view, content);
    expect(target).not.toBeNull();
    expect(target).toBeGreaterThan(0);
  });

  it("never scrolls past the end of the content", () => {
    const target = followScrollLeft(content, view, content);
    expect(target).toBeLessThanOrEqual(content - view.clientWidth);
  });

  it("never scrolls to a negative position", () => {
    expect(followScrollLeft(0, { scrollLeft: 300, clientWidth: 390 }, content)).toBe(
      0,
    );
  });

  it("treats the area under the sticky gutter as not visible", () => {
    // A playhead sitting exactly at the scroll offset is hidden by the gutter.
    const hidden = followScrollLeft(
      300,
      { scrollLeft: 300, clientWidth: 390 },
      content,
    );
    expect(hidden).not.toBeNull();
  });

  it("leaves room to read ahead after a jump", () => {
    const target =
      followScrollLeft(800, { scrollLeft: 0, clientWidth: 390 }, content) ?? 0;
    expect(800 - target).toBeGreaterThan(GUTTER_WIDTH);
    expect(800 - target).toBeLessThan(390);
  });
});

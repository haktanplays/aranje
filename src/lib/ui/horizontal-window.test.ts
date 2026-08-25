/**
 * The shared horizontal window (2Q-C §3, §11).
 *
 * The claim under everything else here is arithmetic: `before + rendered +
 * after` is the axis, exactly. A window whose three parts do not add up is a
 * scroll width that disagrees with the music, and every position derived from
 * it — a playhead, a selection band, a seek — is then wrong by the difference.
 */
import { describe, expect, it } from "vitest";

import {
  directionOf,
  horizontalWindow,
  OVERSCAN_VIEWPORTS,
  sameWindow,
  type HorizontalWindowInput,
} from "@/lib/ui/horizontal-window";
import { buildSongAxis } from "@/lib/tab/song-axis";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import type { Bar, Song } from "@/lib/song/schema";

const SLOT = 34;
const axis = buildSongAxis(SAMPLE_SONG, SLOT);

const at = (
  viewportLeftPx: number,
  viewportWidthPx = 390,
  direction: HorizontalWindowInput["direction"] = "idle",
) => horizontalWindow({ axis, viewportLeftPx, viewportWidthPx, direction });

describe("233. the window covers the viewport and adds up to the axis", () => {
  it("renders the first bars at the start of the song", () => {
    const window = at(0);
    expect(window.firstBarIndex).toBe(0);
    expect(window.beforePx).toBe(0);
    expect(window.renderedBarKeys[0]).toBe(axis.bars[0]!.key);
  });

  it("adds up to the axis at every scroll position", () => {
    for (let left = 0; left <= axis.totalWidthPx; left += 97) {
      for (const direction of ["forward", "backward", "idle"] as const) {
        const window = at(left, 390, direction);
        expect(window.beforePx + window.renderedPx + window.afterPx).toBe(
          axis.totalWidthPx,
        );
        expect(window.afterPx).toBeGreaterThanOrEqual(0);
        expect(window.beforePx).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("always covers the viewport itself, whatever the overscan is", () => {
    for (let left = 0; left <= axis.totalWidthPx - 390; left += 61) {
      const window = at(left, 390, "forward");
      const first = window.bars[0]!;
      const last = window.bars[window.bars.length - 1]!;
      expect(first.leftPx).toBeLessThanOrEqual(left);
      expect(last.leftPx + last.widthPx).toBeGreaterThanOrEqual(left + 390);
    }
  });

  it("clamps at the end of the song rather than running past it", () => {
    const window = at(axis.totalWidthPx - 100, 390, "forward");
    expect(window.lastBarIndex).toBe(axis.bars.length - 1);
    expect(window.afterPx).toBe(0);
  });

  it("renders a single bar that is wider than the viewport", () => {
    const window = at(axis.bars[1]!.leftPx, 20, "idle");
    expect(window.bars.length).toBeGreaterThanOrEqual(1);
    expect(window.renderedBarKeys).toContain(axis.bars[1]!.key);
  });

  it("crosses a section boundary without noticing there is one", () => {
    const second = axis.sections[1]!;
    // A viewport straddling the boundary renders bars from both sections.
    const window = at(second.leftPx - 60, 200, "forward");
    const sections = new Set(window.bars.map((bar) => bar.sectionId));
    expect(sections.size).toBeGreaterThan(1);
  });

  it("uses stable keys, not positions in the rendered slice", () => {
    const early = at(0);
    const later = at(400, 390, "forward");
    const shared = early.renderedBarKeys.filter((key) =>
      later.renderedBarKeys.includes(key),
    );
    expect(shared.length).toBeGreaterThan(0);
    for (const key of shared) {
      // The same bar keeps the same key in both windows, whatever index it
      // happens to sit at inside the rendered slice.
      expect(key).toMatch(/^[^:]+:\d+$/);
    }
  });

  it("has no window at all for a song with no bars", () => {
    const empty = structuredClone(SAMPLE_SONG) as Song;
    for (const section of empty.sections) section.bars = [] as Bar[];
    const built = buildSongAxis(empty, SLOT);
    const window = horizontalWindow({
      axis: built,
      viewportLeftPx: 0,
      viewportWidthPx: 390,
      direction: "idle",
    });
    expect(window.firstBarIndex).toBe(-1);
    expect(window.bars).toEqual([]);
    expect(window.beforePx + window.renderedPx + window.afterPx).toBe(0);
  });
});

describe("234. overscan follows the reader's travel", () => {
  it("keeps more ahead than behind while moving forward", () => {
    const middle = Math.round(axis.totalWidthPx / 2);
    const window = at(middle, 200, "forward");
    const ahead = window.bars[window.bars.length - 1]!.leftPx +
      window.bars[window.bars.length - 1]!.widthPx -
      (middle + 200);
    const behind = middle - window.bars[0]!.leftPx;
    expect(ahead).toBeGreaterThan(behind);
  });

  it("mirrors that while moving backward", () => {
    /*
     * Scanned across the song rather than asserted at one position. A bar here
     * is 272px wide and the margins shift by less than that, so at any single
     * position the two directions can quantize onto the same bars — which is
     * correct, and would make a one-position assertion a claim about where the
     * bar lines happen to fall rather than about direction. What is true
     * everywhere is the ordering; what has to be true somewhere is that the
     * direction changes the answer at all.
     */
    let differences = 0;
    for (let left = 0; left <= axis.totalWidthPx; left += 37) {
      const backward = at(left, 200, "backward");
      const forward = at(left, 200, "forward");
      expect(backward.firstBarIndex).toBeLessThanOrEqual(forward.firstBarIndex);
      expect(backward.lastBarIndex).toBeLessThanOrEqual(forward.lastBarIndex);
      if (!sameWindow(backward, forward)) differences += 1;
    }
    expect(differences).toBeGreaterThan(0);
  });

  it("favours neither side while idle", () => {
    const middle = Math.round(axis.totalWidthPx / 2);
    const idle = at(middle, 200, "idle");
    const forward = at(middle, 200, "forward");
    // Idle keeps at least as much behind as a forward scroll does, because a
    // stationary reader has no travel to favour.
    expect(idle.firstBarIndex).toBeLessThanOrEqual(forward.firstBarIndex);
  });

  it("states the overscan in viewports, in one place", () => {
    expect(OVERSCAN_VIEWPORTS.ahead).toBeGreaterThan(0);
    expect(OVERSCAN_VIEWPORTS.behind).toBeGreaterThan(0);
    // Ahead is the direction a blank frame comes from, so it is the larger.
    expect(OVERSCAN_VIEWPORTS.ahead).toBeGreaterThanOrEqual(
      OVERSCAN_VIEWPORTS.behind,
    );
  });

  it("scales the overscan with the viewport, not with a bar count", () => {
    const middle = Math.round(axis.totalWidthPx / 2);
    const narrow = at(middle, 120, "forward");
    const wide = at(middle, 360, "forward");
    expect(wide.bars.length).toBeGreaterThan(narrow.bars.length);
  });
});

describe("235. a window changes only when the rendered bars change", () => {
  it("says two windows over the same bars are the same window", () => {
    const a = at(10);
    const b = at(12);
    expect(sameWindow(a, b)).toBe(a.firstBarIndex === b.firstBarIndex &&
      a.lastBarIndex === b.lastBarIndex);
    expect(sameWindow(a, a)).toBe(true);
  });

  it("notices when the range really moves", () => {
    const near = at(0, 200, "forward");
    const far = at(axis.totalWidthPx - 200, 200, "forward");
    expect(sameWindow(near, far)).toBe(false);
  });

  it("reads direction from movement, with a dead band for noise", () => {
    expect(directionOf(100, 140)).toBe("forward");
    expect(directionOf(140, 100)).toBe("backward");
    expect(directionOf(100, 100)).toBe("idle");
    // Subpixel wobble is not travel and must not flip the overscan.
    expect(directionOf(100, 100.2)).toBe("idle");
    expect(directionOf(100, 99.8)).toBe("idle");
  });
});

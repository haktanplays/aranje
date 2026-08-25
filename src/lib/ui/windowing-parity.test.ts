/**
 * What windowing is not allowed to change (2Q-C §8, §11.37–45).
 *
 * The surface now mounts a few bars instead of all of them, and the whole
 * safety of that rests on one claim: **the DOM is a drawing, not the source**.
 * Every gesture resolves against the axis, every command names a bar by key
 * and a slot by index, and both of those are facts about the song rather than
 * about what happens to be on screen.
 *
 * These tests are the claim, stated as arithmetic. If a future change starts
 * resolving a tap by measuring a mounted element, the answers below stop
 * agreeing with each other.
 */
import { describe, expect, it } from "vitest";

import {
  barAtTicks,
  buildSongAxis,
  pointAtX,
  slotLeftPx,
  xAtBarKey,
  xAtTicks,
} from "@/lib/tab/song-axis";
import { horizontalWindow, type HorizontalWindow } from "@/lib/ui/horizontal-window";
import { desiredScrollLeft, followTailPx } from "@/lib/ui/continuous-follow";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { buildSongPlan } from "@/lib/audio/schedule";
import { buildMidiPlan } from "@/lib/export/midi-plan";
import { exportProject } from "@/lib/project/project-file";
import { canonicalJson } from "@/lib/copilot/fingerprint";

const SLOT = 34;
const axis = buildSongAxis(SAMPLE_SONG, SLOT);

/** Every scroll position a reader could be at, a screen's width apart. */
const positions = (width: number): number[] => {
  const out: number[] = [];
  for (let left = 0; left <= axis.totalWidthPx; left += 43) out.push(left);
  return out.map((left) => Math.min(left, Math.max(0, axis.totalWidthPx - width)));
};

const windowAt = (left: number, width = 390): HorizontalWindow =>
  horizontalWindow({
    axis,
    viewportLeftPx: left,
    viewportWidthPx: width,
    direction: "forward",
  });

const mounted = (window: HorizontalWindow, key: string) =>
  window.renderedBarKeys.includes(key);

describe("242. a gesture resolves against the music, not against the DOM", () => {
  it("answers the same for a bar whether or not it is mounted", () => {
    const bar = axis.bars[axis.bars.length - 1]!;
    const x = slotLeftPx(bar, 2) + 1;

    const near = windowAt(bar.leftPx);
    const far = windowAt(0);
    expect(mounted(near, bar.key)).toBe(true);
    // Far enough away that the bar is genuinely not in the DOM.
    expect(mounted(far, bar.key)).toBe(false);

    // And the point under that x is the same fact either way, because the
    // answer never came from the DOM.
    const point = pointAtX(axis, x);
    expect(point).not.toBeNull();
    expect(point!.bar.key).toBe(bar.key);
    expect(point!.slotIndex).toBe(2);
  });

  it("gives every mounted bar the exact x the axis says it has", () => {
    for (const left of positions(390)) {
      const window = windowAt(left);
      let running = window.beforePx;
      for (const bar of window.bars) {
        // The spacer plus the bars before it: what the browser will lay this
        // bar out at. It has to equal the axis, or a tap lands on the wrong
        // note whenever the window moves.
        expect(running, `${bar.key} @ ${left}`).toBe(bar.leftPx);
        running += bar.widthPx;
      }
    }
  });

  it("never changes which bar a tick belongs to", () => {
    for (const left of positions(390)) {
      const window = windowAt(left);
      for (let ticks = 0; ticks < axis.totalTicks; ticks += 97) {
        const bar = barAtTicks(axis, ticks);
        expect(bar).not.toBeNull();
        // The window's existence is invisible to this question.
        expect(window.renderedBarKeys.length).toBeGreaterThan(0);
        expect(barAtTicks(axis, ticks)!.key).toBe(bar!.key);
      }
    }
  });

  it("keeps a bar's key stable as the window slides over it", () => {
    const seen = new Map<string, number>();
    for (const left of positions(390)) {
      for (const bar of windowAt(left).bars) {
        const previous = seen.get(bar.key);
        // Same key, same place, every time it is mounted.
        if (previous !== undefined) expect(previous).toBe(bar.leftPx);
        seen.set(bar.key, bar.leftPx);
      }
    }
    // And every bar of the song was mounted at some point on the way past.
    expect(seen.size).toBe(axis.bars.length);
  });

  it("finds a scroll target for a bar that is not mounted", () => {
    /*
     * The navigation defect this replaces: the tab used to scroll to a
     * section by looking up its bar in the DOM. Under windowing that lookup
     * finds nothing for anywhere the reader is not already, so the surface
     * would silently stay put. Geometry has the answer for every bar.
     */
    const window = windowAt(0);
    for (const bar of axis.bars) {
      const x = xAtBarKey(axis, bar.key);
      expect(x, bar.key).not.toBeNull();
      expect(x).toBe(bar.leftPx);
    }
    expect(window.renderedBarKeys.length).toBeLessThan(axis.bars.length);
  });

  it("names nothing for a position outside the song", () => {
    expect(pointAtX(axis, -1)).toBeNull();
    expect(pointAtX(axis, axis.totalWidthPx + 1)).toBeNull();
    expect(xAtBarKey(axis, "no-such-section:0")).toBeNull();
  });
});

describe("243. the three parts of the surface add up, at every position", () => {
  const contentWidth = (width: number) => axis.totalWidthPx + followTailPx(width);

  it("keeps the scroll content the same width whatever is mounted", () => {
    for (const width of [320, 390]) {
      for (const left of positions(width)) {
        const window = windowAt(left, width);
        expect(window.beforePx + window.renderedPx + window.afterPx).toBe(
          axis.totalWidthPx,
        );
      }
    }
  });

  it("puts the playhead at the same place on screen at every position", () => {
    /*
     * The property a reader experiences as "the surface does not jump": the
     * anchor is the same fraction of the screen at every tick that is far
     * enough from either end for the clamp not to bite.
     */
    const width = 390;
    const view = { widthPx: width, contentWidthPx: contentWidth(width) };
    const anchor = 0.32 * width;
    for (let ticks = 0; ticks <= axis.totalTicks; ticks += 53) {
      const x = xAtTicks(axis, ticks);
      if (x === null) continue;
      const scroll = desiredScrollLeft(x, view);
      if (scroll <= 0) continue;
      expect(x - scroll).toBeCloseTo(anchor, 6);
    }
  });

  it("keeps the playhead inside the mounted range while following", () => {
    const width = 320;
    const view = { widthPx: width, contentWidthPx: contentWidth(width) };
    for (let ticks = 0; ticks <= axis.totalTicks; ticks += 29) {
      const x = xAtTicks(axis, ticks);
      if (x === null) continue;
      const scroll = desiredScrollLeft(x, view);
      const window = horizontalWindow({
        axis,
        viewportLeftPx: scroll,
        viewportWidthPx: width,
        direction: "forward",
      });
      const first = window.bars[0]!;
      const last = window.bars[window.bars.length - 1]!;
      expect(x, `${ticks}`).toBeGreaterThanOrEqual(first.leftPx);
      expect(x, `${ticks}`).toBeLessThanOrEqual(last.leftPx + last.widthPx);
    }
  });
});

describe("244. windowing cannot reach what a song is", () => {
  /*
   * The §10 claim, stated as arithmetic rather than as a promise: run the
   * whole reading surface over a song — axis, window, follow, at every scroll
   * position — and then ask the four consumers that turn a song into bytes
   * whether anything changed.
   */
  const before = canonicalJson(SAMPLE_SONG as unknown as Record<string, unknown>);
  const plan = canonicalJson(
    buildSongPlan(SAMPLE_SONG) as unknown as Record<string, unknown>,
  );
  const midi = canonicalJson(
    buildMidiPlan(SAMPLE_SONG) as unknown as Record<string, unknown>,
  );
  const file = exportProject(SAMPLE_SONG);

  const readTheWholeSong = () => {
    const built = buildSongAxis(SAMPLE_SONG, SLOT);
    const view = { widthPx: 320, contentWidthPx: built.totalWidthPx + followTailPx(320) };
    for (let ticks = 0; ticks <= built.totalTicks; ticks += 31) {
      const x = xAtTicks(built, ticks);
      if (x === null) continue;
      const scroll = desiredScrollLeft(x, view);
      horizontalWindow({
        axis: built,
        viewportLeftPx: scroll,
        viewportWidthPx: 320,
        direction: "forward",
      });
      pointAtX(built, x);
    }
  };

  it("leaves the song byte-identical after a whole playthrough", () => {
    readTheWholeSong();
    expect(canonicalJson(SAMPLE_SONG as unknown as Record<string, unknown>)).toBe(
      before,
    );
  });

  it("leaves the playback plan byte-identical", () => {
    readTheWholeSong();
    expect(
      canonicalJson(buildSongPlan(SAMPLE_SONG) as unknown as Record<string, unknown>),
    ).toBe(plan);
  });

  it("leaves the MIDI plan byte-identical", () => {
    readTheWholeSong();
    expect(
      canonicalJson(buildMidiPlan(SAMPLE_SONG) as unknown as Record<string, unknown>),
    ).toBe(midi);
  });

  it("leaves the project file byte-identical", () => {
    readTheWholeSong();
    const after = exportProject(SAMPLE_SONG);
    expect(after.ok).toBe(true);
    expect(file.ok).toBe(true);
    if (!after.ok || !file.ok) return;
    expect(after.text).toBe(file.text);
  });

  it("carries no view fact into the exported bytes", () => {
    // The words a windowed surface would have leaked if any of it were part
    // of the song rather than part of the drawing.
    expect(file.ok).toBe(true);
    if (!file.ok) return;
    for (const word of [
      "scrollLeft",
      "viewportWidth",
      "overscan",
      "followAnchor",
      "renderedBarKeys",
      "reduceMotion",
    ]) {
      expect(file.text.includes(word), word).toBe(false);
    }
  });
});

/**
 * Which bars are worth having in the DOM right now (2Q-C §3).
 *
 * Pure arithmetic over the song axis and a scroll position. It knows nothing
 * about React, nothing about the DOM, and nothing about which surface is
 * asking — Tab and Çoklu share one window because they share one axis, and a
 * window per lane would be the same mistake as a scroller per lane.
 *
 * ## What it is not
 *
 * It is not virtualization of the *music*. A bar that is not rendered has not
 * been deleted, is not silent, and is still exactly where it was: the scroll
 * content keeps the whole axis's width, and the bars that are drawn are drawn
 * at their real place on it. Everything that reasons about the song — a
 * selection, a chain, a bar command, an export — reads the Song, never the
 * DOM, and is therefore untouched by what happens to be mounted.
 *
 * ## Overscan is measured, not assumed
 *
 * The reader is usually moving in one direction, and the cost of being wrong
 * is asymmetric: too little overscan *ahead* of the playhead is a blank frame
 * at speed, and too little *behind* is a flicker when they scroll back. So the
 * amount is expressed in viewports rather than in bars — a bar is 8 slots wide
 * on one grid and 32 on another, and "two bars" means two different distances
 * on the same screen — and the numbers themselves come from
 * `eval/continuous-follow/OVERSCAN.json` rather than from a guess.
 */
import type { SongAxis, SongAxisBar } from "@/lib/tab/song-axis";

export type ScrollDirection = "forward" | "backward" | "idle";

/** How far past the viewport to keep bars mounted, in viewport widths. */
export type OverscanViewports = {
  /** Toward the reader's travel: this is the one that prevents a blank frame. */
  readonly ahead: number;
  /** Behind them: enough that a flick back does not land on nothing. */
  readonly behind: number;
};

/**
 * The one the app ships with.
 *
 * One place, so a component cannot hold a second opinion, and one number per
 * direction because the two are not the same question. Chosen by measurement
 * rather than by "two bars ought to do": `eval/continuous-follow/OVERSCAN.json`
 * holds the candidates that were run, the blank frames each produced at the
 * app's worst case, and what each costs in mounted bars.
 */
export const OVERSCAN_VIEWPORTS: OverscanViewports = {
  ahead: 1,
  behind: 0.5,
};

export type HorizontalWindowInput = {
  readonly axis: SongAxis;
  readonly viewportLeftPx: number;
  readonly viewportWidthPx: number;
  readonly direction: ScrollDirection;
  /**
   * Only the overscan measurement passes this.
   *
   * It exists so `eval/continuous-follow/measure-overscan.ts` compares
   * candidates by running *this* function rather than a copy of it — a
   * measurement of a reimplementation would prove nothing about what ships.
   * Production never supplies it and therefore cannot hold a second opinion
   * about the overscan.
   */
  readonly overscan?: OverscanViewports;
};

export type HorizontalWindow = {
  /** Index into `axis.bars`. -1 with an empty axis, and then nothing renders. */
  readonly firstBarIndex: number;
  readonly lastBarIndex: number;
  readonly beforePx: number;
  readonly renderedPx: number;
  readonly afterPx: number;
  readonly renderedBarKeys: readonly string[];
  readonly bars: readonly SongAxisBar[];
};

const EMPTY: HorizontalWindow = {
  firstBarIndex: -1,
  lastBarIndex: -1,
  beforePx: 0,
  renderedPx: 0,
  afterPx: 0,
  renderedBarKeys: [],
  bars: [],
};

/**
 * The bars to render for this scroll position.
 *
 * An idle surface gets the same overscan on both sides: it has no travel to
 * favour, and guessing one would make a stationary reader's flick in the
 * unguessed direction the slow one.
 */
export function horizontalWindow(input: HorizontalWindowInput): HorizontalWindow {
  const { axis, viewportLeftPx, viewportWidthPx, direction } = input;
  if (axis.bars.length === 0) return EMPTY;

  const width = Math.max(0, viewportWidthPx);
  const forward = direction === "forward";
  const backward = direction === "backward";
  const overscan = input.overscan ?? OVERSCAN_VIEWPORTS;
  const aheadPx = width * overscan.ahead;
  const behindPx = width * overscan.behind;

  const leftMargin = backward ? aheadPx : forward ? behindPx : aheadPx;
  const rightMargin = backward ? behindPx : aheadPx;

  const from = viewportLeftPx - leftMargin;
  const to = viewportLeftPx + width + rightMargin;

  /*
   * A bar is in when any part of it is inside the padded range. `>` and `<`
   * rather than `>=` and `<=` on the far edges, so a bar that merely touches
   * the boundary with zero visible width is not mounted for nothing.
   */
  let firstBarIndex = -1;
  let lastBarIndex = -1;
  for (const [index, bar] of axis.bars.entries()) {
    const barRight = bar.leftPx + bar.widthPx;
    if (barRight <= from) continue;
    if (bar.leftPx >= to) break;
    if (firstBarIndex === -1) firstBarIndex = index;
    lastBarIndex = index;
  }

  /*
   * Nothing overlapped: the reader is past the end, or before the start, of a
   * song shorter than their overscan. The nearest bar is rendered rather than
   * nothing, because a surface with no bars at all has nothing to scroll and
   * would strand them.
   */
  if (firstBarIndex === -1) {
    const nearest = viewportLeftPx <= 0 ? 0 : axis.bars.length - 1;
    firstBarIndex = nearest;
    lastBarIndex = nearest;
  }

  const bars = axis.bars.slice(firstBarIndex, lastBarIndex + 1);
  const beforePx = bars[0]!.leftPx;
  const renderedPx = bars.reduce((total, bar) => total + bar.widthPx, 0);

  return {
    firstBarIndex,
    lastBarIndex,
    beforePx,
    renderedPx,
    // Subtraction rather than a second sum: the three parts have to add up to
    // the axis exactly, and a rounding difference here is a scroll width that
    // disagrees with the music.
    afterPx: axis.totalWidthPx - beforePx - renderedPx,
    renderedBarKeys: bars.map((bar) => bar.key),
    bars,
  };
}

/**
 * Whether two windows would render the same thing.
 *
 * The follow model recomputes a window every frame; React must hear about it
 * only when the answer changed. Comparing the two indices is enough and is
 * O(1) — comparing the key arrays would allocate on every frame to learn the
 * same fact.
 */
export function sameWindow(a: HorizontalWindow, b: HorizontalWindow): boolean {
  return a.firstBarIndex === b.firstBarIndex && a.lastBarIndex === b.lastBarIndex;
}

/**
 * Which way the reader is going, from one scroll position to the next.
 *
 * A dead band, because a scroll position that wobbles by a fraction of a pixel
 * is not travel and must not flip the overscan back and forth. Half a pixel:
 * below what a device pixel can show, above what subpixel noise produces.
 */
export const DIRECTION_DEAD_BAND_PX = 0.5;

export function directionOf(previousLeftPx: number, nextLeftPx: number): ScrollDirection {
  const delta = nextLeftPx - previousLeftPx;
  if (delta > DIRECTION_DEAD_BAND_PX) return "forward";
  if (delta < -DIRECTION_DEAD_BAND_PX) return "backward";
  return "idle";
}

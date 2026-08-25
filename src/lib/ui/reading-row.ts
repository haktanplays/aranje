/**
 * How wide the three parts of a reading row are (2R-A §III).
 *
 * A horizontal reading surface draws one row: empty space standing in for the
 * music before the window, the part that is really in the DOM, and empty
 * space for the rest. The row must be exactly as wide as the scroll content
 * says it is, because the scroll content's width *is* the reachable extent of
 * the music — and a row wider than it silently lengthens the song.
 *
 * ## Why this is a function and not four lines in a component
 *
 * It was four lines in a component, and they were wrong. When the kit's step
 * grid was armed, `TabCanvas` rendered it as an extra flex child *beside* the
 * reading window's lead spacer, bar list and tail rather than instead of
 * them. Flex children overflow a fixed-width parent, so the scroller's extent
 * became:
 *
 *     contentWidthPx + gridWidth − renderedPx
 *
 * On the contract's ceiling fixture that measured 24.507px against a
 * canonical axis of 16.592 — and it was not even a constant, because
 * `renderedPx` changes as the reader scrolls. The song appeared to be half as
 * long again as it is, by an amount that moved.
 *
 * The arithmetic lives here now, with a test that says the parts add up.
 */

/** What the row is made of, left to right after the origin. */
export type ReadingRow = {
  /** Empty width before the drawn part. */
  readonly leadPx: number;
  /** The part that is really in the DOM. */
  readonly drawnPx: number;
  /** Empty width after it, including the surface's own reading tail. */
  readonly tailPx: number;
  /** `originPx + lead + drawn + tail`. */
  readonly totalPx: number;
  /**
   * How much the parts exceed the content, or zero.
   *
   * The tail is clamped at zero because a negative width is not a thing the
   * DOM can draw — but clamping it silently is what let the old renderer
   * overflow by a whole section without anything noticing. So the overflow is
   * reported rather than absorbed, and `overflowPx === 0` is the invariant
   * every real input must satisfy.
   */
  readonly overflowPx: number;
};

export type ReadingRowInput = {
  /** The scroll content's full width: origin, axis and reading tail. */
  readonly contentWidthPx: number;
  /** Space before the first bar — the tab's sticky gutter, or zero. */
  readonly originPx: number;
  /** The reading window's own two numbers, from `horizontalWindow`. */
  readonly windowBeforePx: number;
  readonly windowRenderedPx: number;
  /**
   * An armed step grid that replaces the bar list, or null.
   *
   * `leadPx` is where its section starts on the shared axis, so its bar lines
   * land where the reading lane's would. When it is present the reading
   * window's numbers are not used at all: the two are alternatives, and
   * rendering both is the defect this module exists to make impossible.
   */
  readonly armedGrid: { readonly leadPx: number; readonly widthPx: number } | null;
};

export function readingRow(input: ReadingRowInput): ReadingRow {
  const leadPx = input.armedGrid ? input.armedGrid.leadPx : input.windowBeforePx;
  const drawnPx = input.armedGrid ? input.armedGrid.widthPx : input.windowRenderedPx;
  /*
   * A remainder, never a second sum. Adding up "the bars after the window"
   * plus "the reading tail" would be a second expression for a width the
   * content already knows, and two expressions for one number is how they
   * come to disagree.
   */
  const remainder = input.contentWidthPx - input.originPx - leadPx - drawnPx;
  const tailPx = Math.max(0, remainder);
  return {
    leadPx,
    drawnPx,
    tailPx,
    totalPx: input.originPx + leadPx + drawnPx + tailPx,
    overflowPx: Math.max(0, -remainder),
  };
}

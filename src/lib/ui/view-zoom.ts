/**
 * How much music fits on the screen (2V-B.3 §10, §11).
 *
 * ## A camera, and nothing else
 *
 * Zoom is the one editor control that must be *guaranteed* not to be an edit.
 * The founder's own words for what a fast `9–10–9` must not do — "müzikal
 * zaman sabit, yerel nota yoğunluğu artar; yalnız gerekirse görünüm büyür" —
 * only mean anything if growing the view is known to be free. So this module
 * holds no ticks, no bars and no Song: it converts between a magnification and
 * a scroll position, and that is the whole of it.
 *
 * The consequence worth stating, because it is what makes the guarantee
 * structural rather than a promise: **content coordinates do not depend on the
 * zoom**. The axis is built once, in its own pixels, and magnification is
 * applied at the boundary where the scroller is read and written. A note is at
 * the same x at every magnification, so "the selection kept the same tick
 * range" is not something the zoom has to remember to do — there is no code
 * path by which it could fail to.
 *
 * ## Two coordinate systems, named
 *
 * - **content px** — the axis's own units, magnification-free.
 * - **screen px** — what the scroller reports: `content × zoom`.
 *
 * Every function below says which it takes. Mixing them is the only way to
 * get this wrong, so they are never both called "px".
 */

/**
 * Small enough to see a phrase across several bars; not so small it is a smear.
 *
 * The number is set by the widest case the presets have to be able to honour:
 * four measures of a 1/16 bar is 4 × 544 content px, and putting that on a
 * 680px landscape phone needs about 0.31. A floor above that would make the
 * "4 ölçü" button quietly not do what it says.
 */
export const MIN_ZOOM = 0.25;
/** Large enough to separate four notes inside one beat on a phone. */
export const MAX_ZOOM = 3;

/** What one press of − or + does. A ratio, so the steps feel even. */
export const ZOOM_STEP = 1.25;

/** The preset measure counts the compact controls offer. */
export const ZOOM_PRESET_BARS = [1, 2, 4] as const;
export type ZoomPresetBars = (typeof ZOOM_PRESET_BARS)[number];

export function clampZoom(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export function stepZoom(zoom: number, direction: "in" | "out"): number {
  return clampZoom(direction === "in" ? zoom * ZOOM_STEP : zoom / ZOOM_STEP);
}

/** Is a further press in this direction going to do anything? */
export function canStepZoom(zoom: number, direction: "in" | "out"): boolean {
  return stepZoom(zoom, direction) !== clampZoom(zoom);
}

/**
 * The magnification at which `bars` measures fill the viewport.
 *
 * `barWidthContentPx` is one measure's own width — which differs between
 * meters and between grid resolutions, so it is measured rather than assumed.
 */
export function zoomForBars(input: {
  readonly bars: number;
  readonly barWidthContentPx: number;
  readonly viewportScreenPx: number;
}): number {
  const { bars, barWidthContentPx, viewportScreenPx } = input;
  if (bars <= 0 || barWidthContentPx <= 0 || viewportScreenPx <= 0) return 1;
  return clampZoom(viewportScreenPx / (bars * barWidthContentPx));
}

/**
 * The magnification at which a held range fills the viewport, with a margin.
 *
 * The margin is why "fit" is not "exactly": a selection whose last pixel is
 * the last pixel of the screen reads as a selection that continues off it.
 */
export function zoomToFit(input: {
  readonly rangeContentPx: number;
  readonly viewportScreenPx: number;
  readonly marginPx?: number;
}): number {
  const { rangeContentPx, viewportScreenPx, marginPx = 24 } = input;
  if (rangeContentPx <= 0 || viewportScreenPx <= 0) return 1;
  const room = Math.max(1, viewportScreenPx - marginPx * 2);
  return clampZoom(room / rangeContentPx);
}

/**
 * Where to scroll to so that a chosen moment stays where the reader left it.
 *
 * The anchor is the point the zoom happens *about*: the selection's start when
 * something is held, the pinch's midpoint during a pinch, and the middle of
 * the screen otherwise. Without it, magnifying would also be a jump, and the
 * reader would have to find their place again after every press.
 *
 * All in content px, in and out.
 */
export function scrollAfterZoom(input: {
  readonly anchorContentPx: number;
  readonly scrollContentPx: number;
  readonly previousZoom: number;
  readonly nextZoom: number;
}): number {
  const { anchorContentPx, nextZoom, previousZoom, scrollContentPx } = input;
  if (previousZoom <= 0 || nextZoom <= 0) return scrollContentPx;
  /* The anchor's distance from the left edge, in screen px, is what is being
     preserved; it is `(anchor − scroll) × zoom` before and after. */
  const offset = (anchorContentPx - scrollContentPx) * previousZoom;
  return Math.max(0, anchorContentPx - offset / nextZoom);
}

/**
 * Where the zoom should happen about, given what the reader is holding.
 *
 * A selection wins over the viewport: the founder's rule is that the held
 * range stays visible, and anchoring to the middle of the screen would let a
 * selection near an edge slide off it as the view magnified.
 */
export function zoomAnchorContentPx(input: {
  readonly selectionStartContentPx: number | null;
  readonly scrollContentPx: number;
  readonly viewportScreenPx: number;
  readonly zoom: number;
}): number {
  const { scrollContentPx, selectionStartContentPx, viewportScreenPx, zoom } = input;
  if (selectionStartContentPx !== null) return selectionStartContentPx;
  return scrollContentPx + viewportScreenPx / (2 * Math.max(zoom, MIN_ZOOM));
}

/**
 * Where a range has to be scrolled to for all of it to be on screen.
 *
 * Returns `null` when it already is, so a caller can leave the view alone —
 * scrolling to a place the reader is already looking at is a jump they did not
 * ask for.
 */
export function scrollToShow(input: {
  readonly fromContentPx: number;
  readonly toContentPx: number;
  readonly scrollContentPx: number;
  readonly viewportScreenPx: number;
  readonly zoom: number;
}): number | null {
  const { fromContentPx, scrollContentPx, toContentPx, viewportScreenPx, zoom } =
    input;
  const viewportContentPx = viewportScreenPx / Math.max(zoom, MIN_ZOOM);
  const right = scrollContentPx + viewportContentPx;
  if (fromContentPx >= scrollContentPx && toContentPx <= right) return null;
  if (fromContentPx < scrollContentPx) return Math.max(0, fromContentPx);
  /* Off the right-hand edge: bring the end into view, but never so far that
     the start leaves it — the reader is holding the whole range. */
  return Math.max(0, Math.min(fromContentPx, toContentPx - viewportContentPx));
}

/**
 * What a two-finger pinch has done so far.
 *
 * The ratio of the current span to the span the gesture started at, applied to
 * the magnification the gesture started at. Expressed against the *start* of
 * the gesture rather than frame to frame, so a pinch that goes out and comes
 * back returns to exactly where it began instead of drifting.
 */
export function pinchZoom(input: {
  readonly startZoom: number;
  readonly startSpanPx: number;
  readonly spanPx: number;
}): number {
  const { spanPx, startSpanPx, startZoom } = input;
  if (startSpanPx <= 0 || spanPx <= 0) return clampZoom(startZoom);
  return clampZoom(startZoom * (spanPx / startSpanPx));
}

/** The distance between two fingers. */
export function pinchSpan(
  a: { readonly x: number; readonly y: number },
  b: { readonly x: number; readonly y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The point a pinch is centred on, in screen coordinates. */
export function pinchCentreX(a: { readonly x: number }, b: { readonly x: number }): number {
  return (a.x + b.x) / 2;
}

/** What the reader asked the camera to do. */
export type ZoomCommand =
  | { readonly kind: "step"; readonly direction: "in" | "out" }
  | { readonly kind: "bars"; readonly bars: ZoomPresetBars }
  | { readonly kind: "fit" }
  /** A pinch, which has already worked out its own magnification and centre. */
  | {
      readonly kind: "pinch";
      readonly zoom: number;
      readonly anchorContentPx: number;
    };

/** Everything a command needs to know about the surface it is acting on. */
export type ZoomView = {
  readonly zoom: number;
  readonly scrollContentPx: number;
  readonly viewportScreenPx: number;
  /** One measure's width in content px — meter- and grid-dependent. */
  readonly barWidthContentPx: number;
  /** The held range, if there is one. */
  readonly selectionContentPx: { readonly from: number; readonly to: number } | null;
};

export type ZoomOutcome = {
  readonly zoom: number;
  readonly scrollContentPx: number;
};

/**
 * Turn a press into a magnification and a scroll position.
 *
 * Pure, and the single authority: the − and + buttons, the three measure
 * presets, "Seçime sığdır" and the pinch all come through here, so there is
 * one answer to "where does the view end up" rather than five that agree until
 * one of them is edited.
 *
 * The two rules the founder set are enforced in order. First the anchor keeps
 * the reader's place; then, if a selection is held, `scrollToShow` guarantees
 * it is still on the screen afterwards. The second can override the first,
 * and that is deliberate — a magnification that loses the thing being worked
 * on is worse than one that moves the view further than expected.
 */
export function resolveZoomCommand(
  command: ZoomCommand,
  view: ZoomView,
): ZoomOutcome {
  const nextZoom = commandZoom(command, view);
  const anchorContentPx =
    command.kind === "pinch"
      ? command.anchorContentPx
      : zoomAnchorContentPx({
          selectionStartContentPx: view.selectionContentPx?.from ?? null,
          scrollContentPx: view.scrollContentPx,
          viewportScreenPx: view.viewportScreenPx,
          zoom: view.zoom,
        });

  const held = scrollAfterZoom({
    anchorContentPx,
    scrollContentPx: view.scrollContentPx,
    previousZoom: view.zoom,
    nextZoom,
  });

  const selection = view.selectionContentPx;
  if (selection === null) return { zoom: nextZoom, scrollContentPx: held };
  const corrected = scrollToShow({
    fromContentPx: selection.from,
    toContentPx: selection.to,
    scrollContentPx: held,
    viewportScreenPx: view.viewportScreenPx,
    zoom: nextZoom,
  });
  return { zoom: nextZoom, scrollContentPx: corrected ?? held };
}

function commandZoom(command: ZoomCommand, view: ZoomView): number {
  switch (command.kind) {
    case "step":
      return stepZoom(view.zoom, command.direction);
    case "bars":
      return zoomForBars({
        bars: command.bars,
        barWidthContentPx: view.barWidthContentPx,
        viewportScreenPx: view.viewportScreenPx,
      });
    case "pinch":
      return clampZoom(command.zoom);
    case "fit": {
      const selection = view.selectionContentPx;
      /* Nothing held is not an error and not a guess: the control is disabled
         in that state, and a command that arrives anyway leaves the view as
         it is rather than inventing a range to fit. */
      if (selection === null) return clampZoom(view.zoom);
      return zoomToFit({
        rangeContentPx: selection.to - selection.from,
        viewportScreenPx: view.viewportScreenPx,
      });
    }
  }
}

/**
 * Which preset button should read as the current one.
 *
 * Approximate on purpose: after a pinch the magnification is whatever the
 * fingers left it at, and rounding that to the nearest preset would claim a
 * state the reader did not choose. Only a magnification that really does fit
 * that many measures lights up.
 */
export function activePresetBars(view: {
  readonly zoom: number;
  readonly barWidthContentPx: number;
  readonly viewportScreenPx: number;
}): ZoomPresetBars | null {
  for (const bars of ZOOM_PRESET_BARS) {
    const exact = zoomForBars({ ...view, bars });
    if (Math.abs(exact - view.zoom) < 0.001) return bars;
  }
  return null;
}

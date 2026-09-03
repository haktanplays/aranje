/**
 * The zoom is a camera (2V-B.3 §10, §11).
 *
 * Every claim here is one of the founder's rules turned into arithmetic. The
 * ones about the Song — no note moved, no undo entry, no store write — cannot
 * be made in this file, because this file has no Song to move: that is the
 * point of it being pure, and `view-zoom-isolation.test.ts` makes them where
 * they can actually be broken.
 */
import { describe, expect, it } from "vitest";

import {
  MAX_ZOOM,
  MIN_ZOOM,
  activePresetBars,
  canStepZoom,
  clampZoom,
  pinchCentreX,
  pinchSpan,
  pinchZoom,
  resolveZoomCommand,
  scrollAfterZoom,
  scrollToShow,
  stepZoom,
  zoomAnchorContentPx,
  zoomForBars,
  zoomToFit,
} from "@/lib/ui/view-zoom";

describe("what a magnification may be", () => {
  it("clamps at both ends rather than refusing", () => {
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(0.001)).toBe(MIN_ZOOM);
    expect(clampZoom(1.5)).toBe(1.5);
  });

  it("treats nonsense as no magnification at all", () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(0)).toBe(1);
    expect(clampZoom(-2)).toBe(1);
  });

  it("steps evenly by ratio, in and out", () => {
    const out = stepZoom(1, "out");
    expect(stepZoom(out, "in")).toBeCloseTo(1, 10);
  });

  it("stops stepping at the ends, and says so before it is pressed", () => {
    expect(stepZoom(MAX_ZOOM, "in")).toBe(MAX_ZOOM);
    expect(stepZoom(MIN_ZOOM, "out")).toBe(MIN_ZOOM);
    expect(canStepZoom(MAX_ZOOM, "in")).toBe(false);
    expect(canStepZoom(MAX_ZOOM, "out")).toBe(true);
    expect(canStepZoom(MIN_ZOOM, "out")).toBe(false);
  });
});

describe("the measure-count presets", () => {
  const bar = 544; /* 16 slots at 34px, the tab's own bar width. */

  it("fits exactly the number of measures it names", () => {
    const zoom = zoomForBars({ bars: 2, barWidthContentPx: bar, viewportScreenPx: 680 });
    expect(bar * 2 * zoom).toBeCloseTo(680, 6);
  });

  it("puts more music on the screen the more measures are asked for", () => {
    const one = zoomForBars({ bars: 1, barWidthContentPx: bar, viewportScreenPx: 680 });
    const four = zoomForBars({ bars: 4, barWidthContentPx: bar, viewportScreenPx: 680 });
    expect(four).toBeLessThan(one);
  });

  it("stays inside the clamp rather than producing an unreadable staff", () => {
    const many = zoomForBars({ bars: 64, barWidthContentPx: bar, viewportScreenPx: 320 });
    expect(many).toBe(MIN_ZOOM);
  });

  it("answers 1 when it has not been told the width of anything", () => {
    expect(zoomForBars({ bars: 2, barWidthContentPx: 0, viewportScreenPx: 680 })).toBe(1);
    expect(zoomForBars({ bars: 2, barWidthContentPx: 544, viewportScreenPx: 0 })).toBe(1);
  });
});

describe("fitting the selection", () => {
  it("leaves a margin, so the held range does not touch both edges", () => {
    const zoom = zoomToFit({ rangeContentPx: 400, viewportScreenPx: 800, marginPx: 24 });
    expect(400 * zoom).toBeCloseTo(752, 6);
    expect(400 * zoom).toBeLessThan(800);
  });

  it("magnifies a short selection and shrinks a long one", () => {
    expect(zoomToFit({ rangeContentPx: 100, viewportScreenPx: 800 })).toBeGreaterThan(1);
    expect(zoomToFit({ rangeContentPx: 4000, viewportScreenPx: 800 })).toBeLessThan(1);
  });
});

describe("keeping the reader's place", () => {
  it("holds the anchor at the same distance from the left edge", () => {
    const before = { anchorContentPx: 900, scrollContentPx: 700, previousZoom: 1 };
    const after = scrollAfterZoom({ ...before, nextZoom: 2 });
    /* 200 content px at zoom 1 is 200 screen px; at zoom 2 the same 200 screen
       px is 100 content px, so the scroll has to come forward by that much. */
    expect(after).toBe(800);
    expect((900 - after) * 2).toBe(200);
  });

  it("comes back to exactly where it was after a zoom out and in", () => {
    const out = scrollAfterZoom({
      anchorContentPx: 900,
      scrollContentPx: 700,
      previousZoom: 1,
      nextZoom: 0.5,
    });
    const back = scrollAfterZoom({
      anchorContentPx: 900,
      scrollContentPx: out,
      previousZoom: 0.5,
      nextZoom: 1,
    });
    expect(back).toBeCloseTo(700, 10);
  });

  it("never scrolls to a negative position", () => {
    expect(
      scrollAfterZoom({
        anchorContentPx: 10,
        scrollContentPx: 0,
        previousZoom: 1,
        nextZoom: 0.4,
      }),
    ).toBe(0);
  });

  it("anchors on the selection when there is one, and mid-screen otherwise", () => {
    expect(
      zoomAnchorContentPx({
        selectionStartContentPx: 1200,
        scrollContentPx: 0,
        viewportScreenPx: 800,
        zoom: 1,
      }),
    ).toBe(1200);
    expect(
      zoomAnchorContentPx({
        selectionStartContentPx: null,
        scrollContentPx: 400,
        viewportScreenPx: 800,
        zoom: 2,
      }),
    ).toBe(600);
  });
});

describe("bringing the selection back into view", () => {
  const view = { scrollContentPx: 500, viewportScreenPx: 800, zoom: 1 };

  it("leaves the view alone when the range is already on screen", () => {
    expect(scrollToShow({ ...view, fromContentPx: 600, toContentPx: 900 })).toBeNull();
  });

  it("goes back for a range that has fallen off the left", () => {
    expect(scrollToShow({ ...view, fromContentPx: 100, toContentPx: 300 })).toBe(100);
  });

  it("goes forward for a range past the right, keeping its start visible", () => {
    const at = scrollToShow({ ...view, fromContentPx: 1400, toContentPx: 1600 });
    expect(at).toBe(800);
    /* The start is on screen at the new position, which is the property that
       matters: a "fit" that showed the end of the selection and not the
       beginning would have lost the reader the thing they are holding. */
    expect(at!).toBeLessThanOrEqual(1400);
  });

  it("shows the start of a range too long to fit at this magnification", () => {
    expect(scrollToShow({ ...view, fromContentPx: 1400, toContentPx: 4000 })).toBe(1400);
  });

  it("accounts for the magnification when deciding what is visible", () => {
    /* At zoom 2 the same 800 screen px show only 400 content px, so a range
       that fits at 1 does not fit here. */
    expect(scrollToShow({ ...view, fromContentPx: 600, toContentPx: 1200 })).toBeNull();
    expect(
      scrollToShow({ ...view, zoom: 2, fromContentPx: 600, toContentPx: 1200 }),
    ).not.toBeNull();
  });
});

describe("the pinch", () => {
  it("magnifies by the ratio the fingers moved apart", () => {
    expect(pinchZoom({ startZoom: 1, startSpanPx: 100, spanPx: 200 })).toBe(2);
    expect(pinchZoom({ startZoom: 1, startSpanPx: 200, spanPx: 100 })).toBe(0.5);
  });

  it("is measured from the start of the gesture, so it does not drift", () => {
    const outAndBack = pinchZoom({ startZoom: 1.5, startSpanPx: 120, spanPx: 120 });
    expect(outAndBack).toBe(1.5);
  });

  it("clamps like every other way of zooming", () => {
    expect(pinchZoom({ startZoom: 2, startSpanPx: 10, spanPx: 400 })).toBe(MAX_ZOOM);
    expect(pinchZoom({ startZoom: 1, startSpanPx: 400, spanPx: 1 })).toBe(MIN_ZOOM);
  });

  it("survives a span of zero rather than producing infinity", () => {
    expect(pinchZoom({ startZoom: 1.2, startSpanPx: 0, spanPx: 50 })).toBe(1.2);
    expect(pinchZoom({ startZoom: 1.2, startSpanPx: 50, spanPx: 0 })).toBe(1.2);
  });

  it("measures the span and the centre of two fingers", () => {
    expect(pinchSpan({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(pinchCentreX({ x: 10 }, { x: 30 })).toBe(20);
  });
});

describe("one authority for every way of zooming (§10, §11)", () => {
  const BAR = 544;
  const view = {
    zoom: 1,
    scrollContentPx: 0,
    viewportScreenPx: 680,
    barWidthContentPx: BAR,
    selectionContentPx: null,
  };

  it("puts exactly the named number of measures on the screen", () => {
    for (const bars of [1, 2, 4] as const) {
      const out = resolveZoomCommand({ kind: "bars", bars }, view);
      expect(BAR * bars * out.zoom).toBeCloseTo(680, 6);
    }
  });

  it("keeps a held selection in view when the view shrinks around it", () => {
    const held = {
      ...view,
      scrollContentPx: 0,
      selectionContentPx: { from: 1200, to: 1400 },
    };
    const out = resolveZoomCommand({ kind: "bars", bars: 1 }, held);
    const right = out.scrollContentPx + 680 / out.zoom;
    expect(out.scrollContentPx).toBeLessThanOrEqual(1200);
    expect(right).toBeGreaterThanOrEqual(1400);
  });

  it("fits the selection and nothing else when asked to", () => {
    const held = { ...view, selectionContentPx: { from: 600, to: 1000 } };
    const out = resolveZoomCommand({ kind: "fit" }, held);
    expect(400 * out.zoom).toBeCloseTo(680 - 48, 6);
    const right = out.scrollContentPx + 680 / out.zoom;
    expect(out.scrollContentPx).toBeLessThanOrEqual(600);
    expect(right).toBeGreaterThanOrEqual(1000);
  });

  it("leaves the view alone when asked to fit nothing", () => {
    const out = resolveZoomCommand({ kind: "fit" }, { ...view, scrollContentPx: 300 });
    expect(out).toEqual({ zoom: 1, scrollContentPx: 300 });
  });

  it("zooms about the pinch's own centre rather than the selection", () => {
    const held = {
      ...view,
      scrollContentPx: 500,
      selectionContentPx: { from: 520, to: 560 },
    };
    const out = resolveZoomCommand(
      { kind: "pinch", zoom: 2, anchorContentPx: 540 },
      held,
    );
    expect(out.zoom).toBe(2);
    /* The pinch's centre stays where the fingers are, to within the correction
       that keeps the selection on screen — and here the selection is under the
       fingers, so there is no correction to make. */
    expect((540 - out.scrollContentPx) * 2).toBeCloseTo((540 - 500) * 1, 6);
  });

  it("does not run past the clamps whichever control asked", () => {
    const zoomed = { ...view, zoom: MAX_ZOOM };
    expect(resolveZoomCommand({ kind: "step", direction: "in" }, zoomed).zoom).toBe(
      MAX_ZOOM,
    );
    expect(
      resolveZoomCommand({ kind: "pinch", zoom: 99, anchorContentPx: 0 }, view).zoom,
    ).toBe(MAX_ZOOM);
  });

  it("lights up a preset only when the magnification really is that preset", () => {
    const at = resolveZoomCommand({ kind: "bars", bars: 2 }, view).zoom;
    expect(
      activePresetBars({ zoom: at, barWidthContentPx: BAR, viewportScreenPx: 680 }),
    ).toBe(2);
    expect(
      activePresetBars({
        zoom: at * 1.1,
        barWidthContentPx: BAR,
        viewportScreenPx: 680,
      }),
    ).toBeNull();
  });
});

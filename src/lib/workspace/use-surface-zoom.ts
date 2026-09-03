"use client";

/**
 * Binding the camera to a reading surface (2V-B.3 §10, §11).
 *
 * ## Why this is not in the canvas
 *
 * A zoom request is made where the controls are — the editor shelf — and can
 * only be answered where the geometry is: how wide is the measure under the
 * reader, how wide is the viewport, where is the held range. That answer needs
 * two effects and a gesture, and none of it is drawing. The canvas draws bars;
 * a boundary test says so, and this is the file that lets it stay true.
 *
 * ## What it can and cannot reach
 *
 * It reads the surface and writes a magnification and a scroll offset. It has
 * no Song, no commit, no history and no storage — not by discipline but by
 * construction, because none of them is passed in. A zoom that wanted to
 * change a note would have nothing to change it with.
 */
import { useCallback, useEffect } from "react";

import { usePinchZoom, type PinchZoom } from "@/lib/ui/use-pinch-zoom";
import type { ViewZoom } from "@/lib/ui/use-view-zoom";
import { activePresetBars, resolveZoomCommand } from "@/lib/ui/view-zoom";
import type { ReadingSurface } from "@/lib/workspace/use-reading-surface";

export function useSurfaceZoom(input: {
  /** The state, held with the navigation; absent on surfaces that cannot zoom. */
  readonly zoom: ViewZoom | undefined;
  readonly surface: ReadingSurface;
  /** The held range in content px, or null when nothing is held. */
  readonly selectionContentPx: { readonly from: number; readonly to: number } | null;
  readonly scrollRef: React.RefObject<HTMLElement | null>;
}): PinchZoom {
  const { scrollRef, selectionContentPx, surface, zoom } = input;
  const magnification = zoom?.zoom ?? 1;

  /*
   * A press, answered against the real geometry.
   *
   * `resolveZoomCommand` is pure and shared with the tests, so what happens
   * here is a measurement and a call: nothing is decided in this file that a
   * test cannot make without a browser.
   */
  const { pending: zoomPending, resolve: resolveZoom } = zoom ?? {};
  const { barWidthAt, measureView } = surface;
  useEffect(() => {
    if (!zoomPending || !resolveZoom) return;
    const view = measureView();
    if (!view) return;
    const barWidthContentPx = barWidthAt(view.scrollContentPx);
    const outcome = resolveZoomCommand(zoomPending, {
      ...view,
      zoom: magnification,
      barWidthContentPx,
      selectionContentPx,
    });
    resolveZoom({
      ...outcome,
      presetBars: activePresetBars({
        zoom: outcome.zoom,
        barWidthContentPx,
        viewportScreenPx: view.viewportScreenPx,
      }),
    });
  }, [
    barWidthAt,
    magnification,
    measureView,
    resolveZoom,
    selectionContentPx,
    zoomPending,
  ]);

  /*
   * And the scroll that goes with it, after the layout has taken the new
   * magnification. Before it, the scroller's position would be interpreted
   * against the old content width and land somewhere else.
   */
  const { scrollToContentPx, scrolled } = zoom ?? {};
  const { scrollTo } = surface;
  useEffect(() => {
    if (scrollToContentPx === null || scrollToContentPx === undefined) return;
    scrollTo(scrollToContentPx);
    scrolled?.();
  }, [scrollTo, scrollToContentPx, scrolled]);

  /*
   * Two fingers zoom, wherever they land.
   *
   * Unlike the background pan this is not gated on holding a selection: a
   * pinch is how every score and map on the device is magnified, and a reader
   * who has to select something before they may zoom has been given a rule to
   * remember. `staffPointerHandlers` stands the other gestures down the moment
   * it engages, so a pinch never also drags a selection across the bars it is
   * magnifying.
   */
  const requestZoom = zoom?.request;
  const onCommand = useCallback(
    (command: Parameters<NonNullable<typeof requestZoom>>[0]) =>
      requestZoom?.(command),
    [requestZoom],
  );
  return usePinchZoom({
    scrollRef,
    zoom: magnification,
    onCommand,
    enabled: requestZoom !== undefined,
  });
}

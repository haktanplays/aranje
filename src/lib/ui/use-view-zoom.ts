"use client";

/**
 * The camera's state, and the only thing in the app that holds it (§10).
 *
 * ## Why the state and the arithmetic are in different places
 *
 * The controls are in the editor shelf — in the flow in portrait, in the side
 * inspector in landscape (§8) — and the axis that knows how wide a measure is
 * lives inside the surface. Neither can see the other, so a press becomes a
 * *request* here and the surface resolves it against the real geometry on the
 * next effect, exactly as a pending scroll already does.
 *
 * That indirection buys the guarantee this feature exists to give. A request
 * is a value; resolving it produces a magnification and a scroll offset and
 * nothing else. There is no path from any of these buttons to the Song, to
 * the history, or to the project store, and there is nothing to remember not
 * to call — a zoom cannot write because it has nothing to write with.
 */
import { useCallback, useState } from "react";

import {
  clampZoom,
  type ZoomCommand,
  type ZoomOutcome,
  type ZoomPresetBars,
} from "@/lib/ui/view-zoom";

/** The surface's answer, plus which preset that answer turned out to be. */
export type ResolvedZoom = ZoomOutcome & {
  readonly presetBars: ZoomPresetBars | null;
};

export type ViewZoom = {
  /** The current magnification. 1 is the tab's own pixels. */
  readonly zoom: number;
  /** A press the surface has not resolved yet, or null. */
  readonly pending: ZoomCommand | null;
  /**
   * Where the surface should be scrolled to once the new magnification has
   * been laid out, in content px, or null when there is nothing to do.
   *
   * Applied after the render rather than with it: the scroller's own
   * `scrollLeft` is in screen px, so writing it before the content has been
   * re-laid-out would land somewhere else entirely.
   */
  readonly scrollToContentPx: number | null;
  /**
   * Which measure-count preset the current magnification is, or null.
   *
   * The surface's own answer, from the last request it resolved — it is the
   * only thing that knows how wide a measure is here, and a measure is not one
   * width. Deliberately not recomputed on a resize: what it reports is the
   * choice the reader made, and after a pinch it reports null rather than
   * rounding to the nearest button they did not press.
   */
  readonly presetBars: ZoomPresetBars | null;
  request(command: ZoomCommand): void;
  /** The surface's answer: this magnification, and then this scroll. */
  resolve(outcome: ResolvedZoom): void;
  /** The scroll has been applied. */
  scrolled(): void;
  /** Back to the tab's own pixels, for a view change or a new song. */
  reset(): void;
};

export function useViewZoom(): ViewZoom {
  const [zoom, setZoom] = useState(1);
  const [pending, setPending] = useState<ZoomCommand | null>(null);
  const [scrollToContentPx, setScrollTo] = useState<number | null>(null);
  const [presetBars, setPresetBars] = useState<ZoomPresetBars | null>(null);

  const request = useCallback((command: ZoomCommand) => {
    /*
     * The newest request wins rather than queueing. Two presses inside one
     * frame are a reader changing their mind, not two camera moves they want
     * played back in order.
     */
    setPending(command);
  }, []);

  const resolve = useCallback((outcome: ResolvedZoom) => {
    setPending(null);
    setZoom(clampZoom(outcome.zoom));
    setScrollTo(outcome.scrollContentPx);
    setPresetBars(outcome.presetBars);
  }, []);

  const scrolled = useCallback(() => setScrollTo(null), []);

  const reset = useCallback(() => {
    setPending(null);
    setScrollTo(null);
    setZoom(1);
    setPresetBars(null);
  }, []);

  return {
    zoom,
    pending,
    scrollToContentPx,
    presetBars,
    request,
    resolve,
    scrolled,
    reset,
  };
}

/** The presets a control row offers, named the way a musician says them. */
export const ZOOM_PRESET_LABELS: Readonly<Record<ZoomPresetBars, string>> = {
  1: "1 ölçü",
  2: "2 ölçü",
  4: "4 ölçü",
};

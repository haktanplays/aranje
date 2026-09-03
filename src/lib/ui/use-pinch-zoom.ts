"use client";

/**
 * Two fingers on the staff (§11).
 *
 * The gesture is bound to the same view model every other zoom control uses,
 * so a pinch and the `+` button are the same operation reached two ways. It
 * cannot reach a note, a measure or the grid resolution: it produces a
 * `ZoomCommand`, and a command is the only vocabulary the camera has.
 *
 * ## Why it takes the press away from everything else
 *
 * A second finger landing on the staff means the reader has stopped doing
 * whatever one finger was doing. If the first finger's gesture were left
 * running, the pinch would also drag a selection across the bars it magnified,
 * and the end of the pinch would arrive as a tap on whichever cell a finger
 * happened to lift over. So the pinch announces itself, the caller stands the
 * other gestures down, and the click that follows is thrown away — the same
 * treatment a long press and a bar-range drag already get.
 */
import { useCallback, useRef } from "react";

import { swallowNextClick } from "@/lib/ui/swallow-click";
import { pinchCentreX, pinchSpan, pinchZoom, type ZoomCommand } from "@/lib/ui/view-zoom";

export type PinchZoom = {
  onPointerDown(event: React.PointerEvent): void;
  onPointerMove(event: React.PointerEvent): void;
  onPointerUp(event: React.PointerEvent): void;
  onPointerCancel(event: React.PointerEvent): void;
  /** True while two fingers are down, so other gestures can stand down. */
  active(): boolean;
};

/** How much the span must change before this is a pinch and not two thumbs. */
export const PINCH_THRESHOLD_PX = 12;

export function usePinchZoom(input: {
  readonly scrollRef: React.RefObject<HTMLElement | null>;
  /** The current magnification, so a pinch is relative to where it started. */
  readonly zoom: number;
  readonly onCommand: (command: ZoomCommand) => void;
  /** Called once, when the pinch takes over from a one-finger gesture. */
  readonly onTakeOver?: () => void;
  readonly enabled?: boolean;
}): PinchZoom {
  const { enabled = true, onCommand, onTakeOver, scrollRef, zoom } = input;

  /*
   * The live gesture, in a ref: a pinch produces a magnification per frame and
   * routing every frame through React state would re-render the whole staff to
   * move it a pixel. What reaches state is the command, and only once the span
   * has really changed.
   */
  const points = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    startSpanPx: number;
    startZoom: number;
    engaged: boolean;
  } | null>(null);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!enabled) return;
      points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const [a, b] = [...points.current.values()];
      if (!a || !b) return;
      gesture.current = {
        startSpanPx: pinchSpan(a, b),
        startZoom: zoom,
        engaged: false,
      };
    },
    [enabled, zoom],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!points.current.has(event.pointerId)) return;
      points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const live = gesture.current;
      if (!live) return;
      const [a, b] = [...points.current.values()];
      if (!a || !b) return;

      const spanPx = pinchSpan(a, b);
      if (!live.engaged) {
        if (Math.abs(spanPx - live.startSpanPx) < PINCH_THRESHOLD_PX) return;
        live.engaged = true;
        onTakeOver?.();
      }

      const scroller = scrollRef.current;
      if (!scroller) return;
      const next = pinchZoom({
        startZoom: live.startZoom,
        startSpanPx: live.startSpanPx,
        spanPx,
      });
      /*
       * The musical moment between the fingers, in content px, so it can stay
       * where it is while everything around it grows. Screen x → scroll
       * position → content position, at the magnification in force *now*.
       */
      const screenX = pinchCentreX(a, b) - scroller.getBoundingClientRect().left;
      const anchorContentPx = (scroller.scrollLeft + screenX) / Math.max(zoom, 0.01);
      onCommand({ kind: "pinch", zoom: next, anchorContentPx });
    },
    [onCommand, onTakeOver, scrollRef, zoom],
  );

  const end = useCallback((event: React.PointerEvent) => {
    points.current.delete(event.pointerId);
    if (points.current.size >= 2) return;
    const engaged = gesture.current?.engaged === true;
    gesture.current = null;
    /* A pinch does not end in a tap. Without this the lifted finger writes a
       note or moves the selection on whatever cell it happened to be over. */
    if (engaged) swallowNextClick();
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: end,
    onPointerCancel: end,
    active: () => gesture.current?.engaged === true,
  };
}

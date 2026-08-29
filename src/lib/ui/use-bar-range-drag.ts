"use client";

/**
 * The bar-range gesture, wired to a real pointer (2U-B §8).
 *
 * The decisions all live in `bar-range-drag.ts`; this holds the timer, keeps
 * the browser out of the sequence once it is ours, and gives it all back
 * afterwards. Three details are worth the words:
 *
 * ## Why a non-passive `touchmove` and not `touch-action: none`
 *
 * `touch-action` is read when a gesture *begins*. Setting it after the finger
 * is already down changes nothing — the browser has decided — so it cannot
 * express "this became a selection half a second in". Setting it up front
 * would express the opposite of what §8 asks for: the page must still be
 * scrollable from a bar number, because that is what most presses on a bar
 * number are.
 *
 * So the scroll is refused per-event instead, by a `touchmove` listener
 * registered `{ passive: false }` for exactly as long as the drag owns the
 * pointer. It is on `document` because the finger will leave the bar it
 * started on — that is the entire gesture — and a listener bound to the
 * element would stop suppressing the moment the reach began. Nothing global is
 * switched off: the listener exists only between recognition and release, and
 * it asks `ownsPointer` before preventing anything.
 *
 * ## Why `pointercancel` matters more than `pointerup`
 *
 * `pointercancel` is what the platform sends when it takes a gesture over. If
 * only `pointerup` released, an interrupted drag would leave the suppressing
 * listener attached and the page unscrollable — turning the bug this fixes
 * into a permanent one. Both paths run the same release, and the listener is
 * torn down by the effect's own cleanup as well, so a component that unmounts
 * mid-drag cannot leave it behind either.
 *
 * ## Why the bar under the finger comes from `elementFromPoint`
 *
 * Because pointer capture — which the drag needs, so the sequence keeps
 * arriving after the finger leaves the header — retargets every subsequent
 * event to the captured element. `event.target` is therefore the bar the press
 * started on for the whole drag, whatever the finger is over. Hit-testing the
 * coordinates is the only honest answer to "which bar is under the finger
 * now", and it is the same answer the reader is looking at.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  IDLE,
  dragRange,
  moveDrag,
  ownsPointer,
  pressBar,
  recogniseDrag,
  releaseDrag,
  type BarRangeDrag,
} from "@/lib/ui/bar-range-drag";
import { LONG_PRESS_MS } from "@/lib/ui/interaction";

/** The attributes a surface puts on each bar so the drag can hit-test it. */
export const BAR_INDEX_ATTRIBUTE = "data-bar-drag-index";
export const BAR_SECTION_ATTRIBUTE = "data-bar-drag-section";

/**
 * Which bar is under these coordinates, or null when none is.
 *
 * The section travels with the index because an index alone does not identify
 * a bar: every section numbers its own from zero, so "bar 2" is two different
 * pieces of music depending on which one you are over.
 */
export function barAtPoint(
  x: number,
  y: number,
): { readonly barIndex: number; readonly sectionId: string } | null {
  if (typeof document === "undefined") return null;
  const found = document
    .elementFromPoint(x, y)
    ?.closest(`[${BAR_INDEX_ATTRIBUTE}]`);
  const raw = found?.getAttribute(BAR_INDEX_ATTRIBUTE);
  const sectionId = found?.getAttribute(BAR_SECTION_ATTRIBUTE);
  if (raw === null || raw === undefined || !sectionId) return null;
  const barIndex = Number(raw);
  return Number.isInteger(barIndex) ? { barIndex, sectionId } : null;
}

/**
 * A bar-range gesture, as a surface receives it.
 *
 * Structural rather than imported from the session, so a canvas can accept
 * the gesture without depending on where the selection lives.
 */
export type BarRangeGesture = {
  handlers(barIndex: number, sectionId: string): BarRangeDragHandlers;
  readonly owning: boolean;
};

/** The handlers for one bar, already bound to it. */
export type BoundBarDrag = {
  readonly handlers: BarRangeDragHandlers;
  readonly owning: boolean;
};

export type BarRangeDragHandlers = {
  onPointerDown(event: React.PointerEvent): void;
  onPointerMove(event: React.PointerEvent): void;
  onPointerUp(event: React.PointerEvent): void;
  onPointerCancel(event: React.PointerEvent): void;
};

export function useBarRangeDrag(input: {
  /** False when this surface has no bar-range gesture to offer at all. */
  readonly enabled: boolean;
  /** The press was recognised: take hold of this one bar. */
  onPress(barIndex: number, sectionId: string): void;
  /** The finger reached to another bar: the run is now these two ends. */
  onReach(startBarIndex: number, endBarIndex: number, sectionId: string): void;
}): BarRangeGesture {
  const { enabled, onPress, onReach } = input;
  const state = useRef<BarRangeDrag>(IDLE);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Mirrored into state only so the surface can draw and test the ownership. */
  const [owning, setOwning] = useState(false);

  /*
   * The callbacks, kept current without making the handlers change identity.
   *
   * Written in an effect rather than during render: a ref assigned while
   * rendering is a value React may have already read, and the linter is right
   * to refuse it. The half-second between a pointerdown and its recognition is
   * the only window in which this could be stale, and the effect closes it on
   * every commit within that window.
   */
  const latest = useRef({ onPress, onReach });
  useEffect(() => {
    latest.current = { onPress, onReach };
  });

  const stopTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const release = useCallback(() => {
    stopTimer();
    state.current = releaseDrag();
    setOwning(false);
  }, [stopTimer]);

  /*
   * The scroll suppression, alive only while the drag owns the pointer. The
   * effect's cleanup is what guarantees it cannot outlive the gesture even if
   * the component disappears mid-drag.
   */
  useEffect(() => {
    if (!owning) return;
    const block = (event: TouchEvent) => {
      if (ownsPointer(state.current)) event.preventDefault();
    };
    document.addEventListener("touchmove", block, { passive: false });
    return () => document.removeEventListener("touchmove", block);
  }, [owning]);

  useEffect(() => release, [release]);

  const handlers = useCallback(
    (barIndex: number, sectionId: string): BarRangeDragHandlers => ({
      onPointerDown(event) {
        if (!enabled) return;
        stopTimer();
        const pointerId = event.pointerId;
        state.current = pressBar(
          pointerId,
          event.clientX,
          event.clientY,
          barIndex,
          sectionId,
        );
        const target = event.currentTarget as Element;
        timer.current = setTimeout(() => {
          timer.current = null;
          const next = recogniseDrag(state.current, pointerId);
          if (next.kind !== "owning") return;
          state.current = next;
          /*
           * Capture *after* recognition, never before: capturing at
           * pointerdown would take the sequence away from the scroller before
           * the reader had said which of the two they meant.
           */
          try {
            target.setPointerCapture?.(pointerId);
          } catch {
            /* A pointer that has already ended cannot be captured; the
               release below is the only thing that had to happen anyway. */
          }
          setOwning(true);
          latest.current.onPress(next.anchorBar, next.sectionId);
        }, LONG_PRESS_MS);
      },

      onPointerMove(event) {
        const before = state.current;
        if (before.kind === "idle") return;
        const next = moveDrag(
          before,
          event.pointerId,
          event.clientX,
          event.clientY,
          before.kind === "owning" ? barAtPoint(event.clientX, event.clientY) : null,
        );
        if (next === before) return;
        state.current = next;
        if (next.kind === "idle") {
          /* The finger wandered before the threshold: it is a scroll now. */
          release();
          return;
        }
        const range = dragRange(next);
        if (range && next.kind === "owning") {
          latest.current.onReach(
            range.startBarIndex,
            range.endBarIndex,
            next.sectionId,
          );
        }
      },

      onPointerUp: release,
      onPointerCancel: release,
    }),
    [enabled, release, stopTimer],
  );

  return { handlers, owning };
}

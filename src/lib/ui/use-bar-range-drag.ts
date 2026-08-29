"use client";

/**
 * The bar-range gesture, wired to a real pointer (2U-B §8).
 *
 * The decisions all live in `bar-range-drag.ts`; this holds the timer, keeps
 * the browser out of the sequence once it is ours, and gives it all back
 * afterwards. Four details are worth the words:
 *
 * ## Two mechanisms, because one of them cannot arrive in time
 *
 * The declaration comes first, and it is the one that matters on a phone.
 * `declaredTouchAction` puts `pan-y` on the header before any finger lands, so
 * the compositor never takes the horizontal pan this gesture needs. Without
 * it there is nothing here to fix: a scroll the compositor has already
 * started belongs to the compositor, and `preventDefault` arrives to find the
 * decision made. That was the founder's Android failure (2U-C §1).
 *
 * The suppression comes second, and covers what a declaration cannot. The
 * finger leaves the header within a few hundred milliseconds — that is the
 * entire gesture — and lands on a staff that must stay scrollable when nobody
 * is dragging. So for exactly as long as the drag owns the pointer, a
 * `document` listener registered `{ passive: false }` refuses each
 * `touchmove`. Nothing global is switched off: it exists only between
 * recognition and release, and asks `ownsPointer` before preventing anything.
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
 * ## Why the click at the end has to be destroyed
 *
 * A bar block is a seek button, and a touch that ends produces a click. So
 * without `swallowNextClick` the reader holds bar 1, reaches to bar 3, lifts —
 * and the playhead jumps to whatever they lifted over and drags the view
 * there. That is the same complaint arriving one frame after the gesture
 * instead of during it, and no `touch-action` prevents it, because it is not a
 * scroll. Only a recognised drag spends its click; a press that never became
 * one is still an ordinary tap on a bar and must still seek.
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
import { swallowNextClick } from "@/lib/ui/swallow-click";

/**
 * How close to the scroller's edge the finger must get before the view
 * follows it, and how fast it then travels.
 *
 * Both matter on a phone and neither does on a desktop. A bar of sixteenth
 * notes is 578px wide; a 320px screen cannot show two of them, so without the
 * view following the finger there is no way to reach the neighbouring bar at
 * all and the whole gesture would be a desktop feature wearing touch clothes.
 * The band is a thumb's width so it can be found without aiming, and the step
 * is small enough that a bar takes about a second to cross — fast enough to be
 * worth doing, slow enough to stop on the bar you meant.
 */
const EDGE_BAND_PX = 44;
const EDGE_STEP_PX = 12;
const EDGE_TICK_MS = 16;

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
  /**
   * The platform took a drag that had already been recognised (2U-C §2).
   *
   * Separate from release because the two endings mean opposite things.
   * `pointerup` is the reader saying "these bars"; `pointercancel` is the
   * reader saying nothing at all, and leaving a range selected on their behalf
   * would put an action bar over a song they never chose to act on. So the
   * gesture takes back what it put on the screen. It fires only for a
   * recognised drag — a press that never became one has selected nothing to
   * clear.
   */
  onCancel?(): void;
}): BarRangeGesture {
  const { enabled, onCancel, onPress, onReach } = input;
  const state = useRef<BarRangeDrag>(IDLE);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The horizontal scroller the drag is happening inside, once it owns. */
  const scroller = useRef<Element | null>(null);
  const edgeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  /**
   * Where the finger was when it last reported in.
   *
   * Needed because the finger stops moving long before the gesture ends: a
   * reader reaching for the next bar puts their thumb at the edge of the
   * screen and *waits* for the view to come to them. No pointer events are
   * produced while they wait, so the reach has to be re-read against the
   * scrolling view from the tick rather than from an event that never comes.
   */
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
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
  const latest = useRef({ onCancel, onPress, onReach });
  useEffect(() => {
    latest.current = { onCancel, onPress, onReach };
  });

  const stopTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const stopEdgeScroll = useCallback(() => {
    if (edgeTimer.current !== null) clearInterval(edgeTimer.current);
    edgeTimer.current = null;
  }, []);

  /**
   * Follow the finger when it reaches the edge of the view.
   *
   * A repeating tick rather than one nudge per pointermove: a finger parked in
   * the edge band stops producing move events, and a reader holding still at
   * the right-hand edge is asking for more bars, not for the scrolling to
   * stop. The tick ends the moment the finger leaves the band or the drag
   * lets go, and it can only ever run while the drag owns the pointer.
   */
  const edgeScroll = useCallback(
    (clientX: number) => {
      const node = scroller.current;
      if (!node) return;
      const box = node.getBoundingClientRect();
      const direction =
        clientX < box.left + EDGE_BAND_PX
          ? -1
          : clientX > box.right - EDGE_BAND_PX
            ? 1
            : 0;
      if (direction === 0) {
        stopEdgeScroll();
        return;
      }
      if (edgeTimer.current !== null) return;
      edgeTimer.current = setInterval(() => {
        if (!ownsPointer(state.current) || !scroller.current) {
          stopEdgeScroll();
          return;
        }
        scroller.current.scrollLeft += direction * EDGE_STEP_PX;
        /*
         * And re-read what is now under the stationary finger. Scrolling
         * without this moved the picture and left the selection behind: the
         * next bar slid under the thumb and the range still said one bar,
         * because nothing had asked again.
         */
        const point = lastPoint.current;
        if (!point) return;
        const next = moveDrag(
          state.current,
          state.current.kind === "idle" ? -1 : state.current.pointerId,
          point.x,
          point.y,
          barAtPoint(point.x, point.y),
        );
        if (next === state.current) return;
        state.current = next;
        const range = dragRange(next);
        if (range && next.kind === "owning") {
          latest.current.onReach(range.startBarIndex, range.endBarIndex, next.sectionId);
        }
      }, EDGE_TICK_MS);
    },
    [stopEdgeScroll],
  );

  /**
   * Put everything back, and say whether the gesture had actually taken hold.
   *
   * The teardown is identical for both endings — a timer, a tick, a scroller,
   * a point and the state itself, none of which may outlive the finger — so
   * there is one function for it. What differs is what the *caller* then owes
   * the reader, and that is decided from this return value rather than from
   * the state, which by then has already been cleared.
   */
  const release = useCallback((): boolean => {
    const owned = ownsPointer(state.current);
    stopTimer();
    stopEdgeScroll();
    scroller.current = null;
    lastPoint.current = null;
    state.current = releaseDrag();
    setOwning(false);
    return owned;
  }, [stopEdgeScroll, stopTimer]);

  /* The finger lifted: the range stands, and the click it leaves is spent. */
  const finish = useCallback(() => {
    if (release()) swallowNextClick();
  }, [release]);

  /* The platform took the gesture: the range was never chosen, so it goes. */
  const abandon = useCallback(() => {
    if (release()) latest.current.onCancel?.();
  }, [release]);

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

  useEffect(() => () => void release(), [release]);

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
          scroller.current = target.closest(".overflow-x-auto");
          setOwning(true);
          latest.current.onPress(next.anchorBar, next.sectionId);
        }, LONG_PRESS_MS);
      },

      onPointerMove(event) {
        const before = state.current;
        if (before.kind === "idle") return;
        lastPoint.current = { x: event.clientX, y: event.clientY };
        if (before.kind === "owning") edgeScroll(event.clientX);
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

      onPointerUp: finish,
      onPointerCancel: abandon,
    }),
    [abandon, edgeScroll, enabled, finish, release, stopTimer],
  );

  return { handlers, owning };
}

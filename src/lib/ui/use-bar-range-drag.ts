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
  dragAnchor,
  ownsPointer,
  pressBar,
  recogniseDrag,
  releaseDrag,
  type BarRangeDrag,
} from "@/lib/ui/bar-range-drag";
import {
  useEdgeFollow,
  useScrollSuppression,
} from "@/lib/ui/drag-ownership";
import { LONG_PRESS_MS } from "@/lib/ui/interaction";
import { swallowNextClick } from "@/lib/ui/swallow-click";

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

  /** Where the reach goes, from a move or from an edge tick alike. */
  const reachTo = useCallback((x: number, y: number) => {
    const before = state.current;
    const next = moveDrag(
      before,
      before.kind === "idle" ? -1 : before.pointerId,
      x,
      y,
      before.kind === "owning" ? barAtPoint(x, y) : null,
    );
    if (next === before) return next;
    state.current = next;
    const range = dragRange(next);
    if (range && next.kind === "owning") {
      latest.current.onReach(
        range.startBarIndex,
        range.endBarIndex,
        next.held.sectionId,
      );
    }
    return next;
  }, []);

  const edge = useEdgeFollow(reachTo);
  useScrollSuppression(owning);

  const stopTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  /**
   * Put everything back, and say whether the gesture had actually taken hold.
   *
   * The teardown is identical for both endings — a timer, a tick, a scroller
   * and the state itself, none of which may outlive the finger — so there is
   * one function for it. What differs is what the *caller* then owes the
   * reader, and that is decided from this return value rather than from the
   * state, which by then has already been cleared.
   */
  const release = useCallback((): boolean => {
    const owned = ownsPointer(state.current);
    stopTimer();
    edge.stop();
    state.current = releaseDrag();
    setOwning(false);
    return owned;
  }, [edge, stopTimer]);

  /* The finger lifted: the range stands, and the click it leaves is spent. */
  const finish = useCallback(() => {
    if (release()) swallowNextClick();
  }, [release]);

  /* The platform took the gesture: the range was never chosen, so it goes. */
  const abandon = useCallback(() => {
    if (release()) latest.current.onCancel?.();
  }, [release]);

  /*
   * Only on unmount, never on a render that happened to change `release`.
   * The dependency array is empty and the current teardown is reached through
   * a ref, because an effect that re-runs its cleanup on every render releases
   * the gesture at the exact moment it takes hold.
   */
  const teardown = useRef(release);
  useEffect(() => {
    teardown.current = release;
  }, [release]);
  useEffect(() => () => void teardown.current(), []);

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
          edge.attach(target.closest(".overflow-x-auto"));
          setOwning(true);
          const anchor = dragAnchor(next);
          if (anchor) latest.current.onPress(anchor.barIndex, anchor.sectionId);
        }, LONG_PRESS_MS);
      },

      onPointerMove(event) {
        const before = state.current;
        /* A second finger is not this gesture: it neither reaches nor
           scrolls the view on the first finger's behalf. */
        if (before.kind === "idle" || before.pointerId !== event.pointerId) return;
        if (before.kind === "owning") edge.track(event.clientX, event.clientY);
        const next = reachTo(event.clientX, event.clientY);
        /* The finger wandered before the threshold: it is a scroll now. */
        if (next.kind === "idle") release();
      },

      onPointerUp: finish,
      onPointerCancel: abandon,
    }),
    [abandon, edge, enabled, finish, reachTo, release, stopTimer],
  );

  return { handlers, owning };
}

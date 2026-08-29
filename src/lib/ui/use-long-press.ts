"use client";

/**
 * A long press that never steals a scroll (spec 13.1).
 *
 * The tab is a horizontal scroller and the same finger does both jobs, so this
 * is the one gesture in the app that has to be told apart from dragging. Three
 * rules keep them separate:
 *
 * - The press only fires after the threshold has *elapsed*, so a flick is gone
 *   before it could ever count.
 * - Moving further than the tolerance cancels it outright. The gesture belongs
 *   to the scroller from that moment and does not come back if the finger
 *   settles again.
 * - `pointercancel` — which is what the browser sends when it decides the
 *   gesture is a scroll — cancels too, so a press that the platform took over
 *   never half-commits.
 *
 * Nothing here calls `preventDefault` on the pointer events themselves.
 * Blocking the default would make the tab stop scrolling under a finger that
 * was only ever going to scroll it. The *click* the browser makes afterwards
 * is a different matter — see `swallow-click.ts`, which the bar-range drag
 * needs for the same reason and therefore no longer lives here.
 */
import { useCallback, useEffect, useRef } from "react";

import { LONG_PRESS_MS } from "@/lib/ui/interaction";
import { swallowNextClick } from "@/lib/ui/swallow-click";
import { movedTo, press, type PressState } from "@/lib/ui/long-press-machine";

/**
 * The callback for a press that is turned off.
 *
 * A module-level constant rather than an inline arrow, so a component that
 * passes `undefined` for its press still gives the hook a stable identity and
 * does not rebuild its handlers on every render.
 */
export const NO_PRESS = (): void => {};

export type LongPressHandlers = {
  onPointerDown(event: React.PointerEvent): void;
  onPointerMove(event: React.PointerEvent): void;
  onPointerUp(): void;
  onPointerCancel(): void;
  onPointerLeave(): void;
};

export function useLongPress(
  onLongPress: (event: { clientX: number; clientY: number }) => void,
  options: { readonly enabled?: boolean } = {},
): LongPressHandlers {
  const enabled = options.enabled ?? true;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The decision itself lives in the pure machine; this only holds it. */
  const state = useRef<PressState>({ kind: "idle" });
  /** Whether this gesture already became a selection, so its click is spent. */
  const fired = useRef(false);

  const cancel = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    state.current = { kind: "idle" };
  }, []);

  // A press in flight when the component goes away must not fire into nothing.
  useEffect(() => cancel, [cancel]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!enabled) return;
      cancel();
      fired.current = false;
      const point = { x: event.clientX, y: event.clientY };
      state.current = press(point.x, point.y, 0);
      timer.current = setTimeout(() => {
        timer.current = null;
        if (state.current.kind !== "pressing") return;
        state.current = { kind: "idle" };
        fired.current = true;
        onLongPress({ clientX: point.x, clientY: point.y });
      }, LONG_PRESS_MS);
    },
    [cancel, enabled, onLongPress],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const next = movedTo(state.current, event.clientX, event.clientY);
      state.current = next;
      // Abandoned means the scroller has the gesture: stop the timer so a
      // finger that settles again cannot revive the press.
      if (next.kind === "abandoned") {
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = null;
      }
    },
    [],
  );

  /*
   * Lifting after a press that fired: the selection is made, so the click that
   * follows is disowned. A cancelled gesture needs none of this — the browser
   * that sends `pointercancel` is not going to send a click either.
   */
  const onPointerUp = useCallback(() => {
    const spent = fired.current;
    cancel();
    fired.current = false;
    if (spent) swallowNextClick();
  }, [cancel]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: cancel,
    onPointerLeave: onPointerUp,
  };
}

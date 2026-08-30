"use client";

/**
 * Holding a note and reaching across its slots (2U-C §3).
 *
 * The same gesture as the bar range, one level down. A long press picks up the
 * chord under the finger; without lifting, reaching right grows the run slot
 * by slot and reaching back shrinks it. Before this the reader could only get
 * there by pressing, then finding a 44px handle, then dragging that — three
 * gestures for one intention, and on a 320px screen the handle is often off
 * the side of the view.
 *
 * ## What it shares, and why
 *
 * Everything except the arithmetic. Telling the hold apart from a scroll is
 * `press-drag.ts`; refusing the page its scroll and carrying the view to a
 * finger that has run out of screen are `drag-ownership.ts`; the click at the
 * end is `swallow-click.ts`. That is deliberate: a second copy of a gesture
 * contract is how the two drift, and the founder finds the difference on a
 * phone rather than in a diff.
 *
 * ## Where the music comes from
 *
 * Nothing is held in the state — the caller resolves a point to a slot every
 * time it is asked. That is what makes the stationary-finger case work: while
 * the edge follow scrolls, the *same* client coordinate names a later slot on
 * each tick, so asking again is the whole of "keep extending while I hold
 * still at the edge". A state that remembered which slot it was on would
 * answer the same thing forever.
 *
 * ## The one honest limit
 *
 * Unlike the bar header, the staff cannot declare `touch-action` up front. It
 * is the surface every reader scrolls the tab from, so reserving its
 * horizontal axis before knowing whether this is a scroll or a selection would
 * be trading the gesture everyone uses for the one a few do — which is the
 * global `touch-action` §2 forbids, arrived at from the other direction. So
 * the staff keeps `auto` and this drag relies on refusing each `touchmove`
 * once it owns the pointer. That is sound *because* recognition requires the
 * finger to have stayed inside the tolerance for the whole threshold: a
 * gesture that never moved is a gesture no compositor has started scrolling.
 * It is nonetheless the half of §1 that a browser emulation cannot settle, and
 * it is named in the physical handoff for that reason.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useEdgeFollow, useScrollSuppression } from "@/lib/ui/drag-ownership";
import { LONG_PRESS_MS } from "@/lib/ui/interaction";
import {
  IDLE,
  beginPress,
  ownsPress,
  recognise,
  releasePress,
  wandered,
  type PressDrag,
} from "@/lib/ui/press-drag";
import { swallowNextClick } from "@/lib/ui/swallow-click";

export type NoteRangeDragHandlers = {
  onPointerDown(event: React.PointerEvent): void;
  onPointerMove(event: React.PointerEvent): void;
  onPointerUp(event: React.PointerEvent): void;
  onPointerCancel(event: React.PointerEvent): void;
};

export type NoteRangeGesture = {
  readonly handlers: NoteRangeDragHandlers;
  readonly owning: boolean;
};

export function useNoteRangeDrag(input: {
  /** False when this surface has no note-range gesture to offer at all. */
  readonly enabled: boolean;
  /** The press was recognised here: pick up the chord under this point. */
  onPress(clientX: number, clientY: number): void;
  /** The finger is here now: the run reaches to this point. */
  onReach(clientX: number, clientY: number): void;
  /** The platform took a recognised drag: nothing was chosen. */
  onCancel?(): void;
}): NoteRangeGesture {
  const { enabled, onCancel, onPress, onReach } = input;
  const state = useRef<PressDrag<null>>(IDLE);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [owning, setOwning] = useState(false);

  /*
   * The inputs, kept current without making the handlers change identity.
   *
   * `enabled` rides along with the callbacks because it is the only other
   * thing a handler reads from the render, and the alternative is four new
   * listeners on the tab's whole body every time the selection changes —
   * which is every frame of a drag.
   *
   * Written in an effect rather than during render: a ref assigned while
   * rendering is a value React may have already read.
   */
  const latest = useRef({ enabled, onCancel, onPress, onReach });
  useEffect(() => {
    latest.current = { enabled, onCancel, onPress, onReach };
  });

  /** The reach, from a move or from an edge tick alike. */
  const reachTo = useCallback((x: number, y: number) => {
    if (!ownsPress(state.current)) return;
    latest.current.onReach(x, y);
  }, []);

  const edge = useEdgeFollow(reachTo);
  useScrollSuppression(owning);

  const stopTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const release = useCallback((): boolean => {
    const owned = ownsPress(state.current);
    stopTimer();
    edge.stop();
    state.current = releasePress();
    setOwning(false);
    return owned;
  }, [edge, stopTimer]);

  const finish = useCallback(() => {
    if (release()) swallowNextClick();
  }, [release]);

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

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!latest.current.enabled) return;
      stopTimer();
      const pointerId = event.pointerId;
      state.current = beginPress(pointerId, event.clientX, event.clientY, null);
      const target = event.currentTarget as Element;
      const point = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        timer.current = null;
        const next = recognise(state.current, pointerId);
        if (next.kind !== "owning") return;
        state.current = next;
        /*
         * Capture after recognition, never before: capturing at pointerdown
         * would take the sequence away from the scroller before the reader had
         * said which of the two they meant.
         */
        try {
          target.setPointerCapture?.(pointerId);
        } catch {
          /* A pointer that has already ended cannot be captured. */
        }
        edge.attach(target.closest(".overflow-x-auto"));
        setOwning(true);
        /*
         * The point the finger went down on, not where it is now. They are
         * within the tolerance of each other by definition, but the press is a
         * claim about where the reader aimed.
         */
        latest.current.onPress(point.x, point.y);
      }, LONG_PRESS_MS);
    },
    [edge, stopTimer],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const before = state.current;
      if (before.kind === "idle" || before.pointerId !== event.pointerId) return;
      if (before.kind === "pressing") {
        /* The finger wandered before the threshold: it is a scroll now, and
           it does not become a selection again if it settles. */
        if (wandered(before, event.clientX, event.clientY)) release();
        return;
      }
      edge.track(event.clientX, event.clientY);
      reachTo(event.clientX, event.clientY);
    },
    [edge, reachTo, release],
  );

  const handlers = useMemo(
    () => ({
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: abandon,
    }),
    [abandon, finish, onPointerDown, onPointerMove],
  );

  return { handlers, owning };
}

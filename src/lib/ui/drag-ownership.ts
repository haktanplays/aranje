"use client";

/**
 * What owning a drag costs the page (2U-C §2, §4).
 *
 * Two gestures in the editor take a pointer that started as a scroll: holding
 * a bar and reaching across its neighbours, and holding a note and reaching
 * across its slots. They select different things and share every consequence,
 * so the consequences live here rather than in each of them.
 *
 * The alternative was a second copy, and a second copy of a gesture contract
 * is how the two drift: one of them learns to stop its rAF on
 * `pointercancel` and the other does not, and the reader finds out on the
 * phone six weeks later.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * How close to the scroller's edge the finger must get before the view
 * follows it, and how fast it then travels.
 *
 * Both matter on a phone and neither does on a desktop. A bar of sixteenth
 * notes is 16 slots at 34px, so 544px wide: no phone can show two of them, and
 * without the view following the finger there is no way to reach the
 * neighbouring bar at all — the whole gesture would be a desktop feature
 * wearing touch clothes. The band is a thumb's width so it can be found
 * without aiming, and the step is small enough that a bar takes about three
 * quarters of a second to cross — fast enough to be worth doing, slow enough
 * to stop on the bar you meant.
 *
 * Deliberately a constant step rather than one that grows with how far into
 * the band the finger is: acceleration that depends on a coordinate is
 * acceleration that behaves differently on every screen width, and §4 asks for
 * this to be bounded and the same every time.
 */
export const EDGE_BAND_PX = 44;
export const EDGE_STEP_PX = 12;
export const EDGE_TICK_MS = 16;

/**
 * Refuse the browser its own gestures for as long as the drag owns.
 *
 * ## Why the listener is registered before it is needed
 *
 * This was measured, and it is the second half of the same lesson `pan-y`
 * taught (2U-C §1). Chrome decides at *touchstart* which listeners may block a
 * gesture — it snapshots the blocking-listener region as part of hit-testing —
 * so a `{ passive: false }` listener added half a second later, when the long
 * press is finally recognised, is treated as passive for the rest of that
 * sequence. Its `preventDefault` does nothing, the compositor scrolls, and
 * Chrome fires `pointercancel` to say the gesture is no longer the page's.
 *
 * Measured on a 412x915 Android emulation: 20 touch moves during a recognised
 * note-range drag produced 1 pointermove and 1 pointercancel, and the range
 * never grew. Registering the same listener at mount and letting it consult
 * the ownership instead produced a move for every move.
 *
 * So the listener exists for the life of the gesture's component and asks
 * whether the drag owns the pointer before preventing anything. Nothing is
 * switched off globally: it prevents only while a recognised drag is in
 * flight, and the ref rather than a dependency is what keeps it registered
 * across the flip instead of being torn down and rebuilt at exactly the moment
 * it becomes necessary.
 *
 * `document` because the finger will leave the element it started on — that is
 * the entire gesture — and a listener bound to the element would stop
 * suppressing the moment the reach began.
 *
 * ## Three gestures, not one
 *
 * A scroll is what a touch device takes. A pointer also has two other ways of
 * being taken away, and both were measured taking it: on a mouse, dragging
 * sideways across bar numbers starts a native drag-and-drop — `dragstart`,
 * immediately followed by `pointercancel`, and the range selection died
 * mid-reach with the reader still holding the button down. Text selection is
 * the same story with a different name. Neither is anything the reader asked
 * for: a bar number is a label, and nothing on the staff is a drag payload. So
 * all three are refused, and only while a recognised drag is in flight.
 */
export function useScrollSuppression(owning: boolean): void {
  const live = useRef(owning);
  useEffect(() => {
    live.current = owning;
  }, [owning]);
  useEffect(() => {
    const block = (event: Event) => {
      if (live.current) event.preventDefault();
    };
    document.addEventListener("touchmove", block, { passive: false });
    document.addEventListener("dragstart", block);
    document.addEventListener("selectstart", block);
    return () => {
      document.removeEventListener("touchmove", block);
      document.removeEventListener("dragstart", block);
      document.removeEventListener("selectstart", block);
    };
  }, []);
}

/**
 * Make sure the gesture hears its own ending (2U-C §4).
 *
 * The handlers that end a drag are spread onto the element it started on, and
 * that element can stop existing mid-gesture: the tab windows horizontally, so
 * a reach that carries the view three bars along unmounts the bar the finger
 * went down on. React takes its listeners away with it, the `pointerup` lands
 * on nothing, and the drag never releases — measured on a 320px run as an
 * edge-follow interval still ticking after the finger had lifted, which is
 * exactly the leak §4 forbids.
 *
 * So `document` hears the ending as well. The element handlers stay the
 * primary path and fire first; this is the guarantee behind them, and it is
 * safe to double-fire because releasing twice is releasing once — the second
 * call finds nothing owned and does nothing.
 */
export function useGestureEnd(
  owning: boolean,
  ends: { onUp(): void; onCancel(): void },
): void {
  const latest = useRef(ends);
  useEffect(() => {
    latest.current = ends;
  });
  useEffect(() => {
    if (!owning) return;
    const lifted = () => latest.current.onUp();
    const taken = () => latest.current.onCancel();
    document.addEventListener("pointerup", lifted);
    document.addEventListener("pointercancel", taken);
    return () => {
      document.removeEventListener("pointerup", lifted);
      document.removeEventListener("pointercancel", taken);
    };
  }, [owning]);
}

export type EdgeFollow = {
  /** The scroller this drag is inside. Null while nothing is being dragged. */
  attach(scroller: Element | null): void;
  /** Where the finger is now. Starts the follow in the band, stops it out. */
  track(x: number, y: number): void;
  /** Everything down: no tick may outlive the pointer that started it. */
  stop(): void;
};

/**
 * Carry the view to the finger when the finger has run out of screen.
 *
 * A repeating tick rather than one nudge per pointermove, and this is the
 * whole point of it: a finger parked at the edge of the screen stops producing
 * move events, and a reader holding still at the right-hand edge is asking for
 * more bars, not for the scrolling to stop. So the tick both scrolls *and*
 * asks again what is under the stationary finger — scrolling without asking
 * moved the picture and left the selection behind, which is a gesture that
 * looks broken while working exactly as written.
 *
 * `onTick` is held in a ref rather than a dependency: it closes over the
 * selection, so it changes on every reach, and an interval rebuilt on every
 * reach is an interval whose phase resets under a finger that is holding still
 * — which is precisely the case this exists to serve.
 */
export function useEdgeFollow(onTick: (x: number, y: number) => void): EdgeFollow {
  const scroller = useRef<Element | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const point = useRef<{ x: number; y: number } | null>(null);
  const latest = useRef(onTick);
  useEffect(() => {
    latest.current = onTick;
  });

  const clear = useCallback(() => {
    if (timer.current !== null) clearInterval(timer.current);
    timer.current = null;
  }, []);

  const stop = useCallback(() => {
    clear();
    scroller.current = null;
    point.current = null;
  }, [clear]);

  /* An interval in flight when the component goes away scrolls into nothing. */
  useEffect(() => stop, [stop]);

  const track = useCallback(
    (x: number, y: number) => {
      point.current = { x, y };
      const node = scroller.current;
      if (!node) return;
      const box = node.getBoundingClientRect();
      const direction = edgeDirection(x, box.left, box.right);
      if (direction === 0) {
        clear();
        return;
      }
      if (timer.current !== null) return;
      timer.current = setInterval(() => {
        const node = scroller.current;
        const here = point.current;
        if (!node || !here || !followTick(node, here, latest.current)) clear();
      }, EDGE_TICK_MS);
    },
    [clear],
  );

  const attach = useCallback(
    (node: Element | null) => {
      scroller.current = node;
      if (!node) clear();
    },
    [clear],
  );

  /*
   * One object for the life of the hook.
   *
   * Not cosmetic. A fresh object every render makes every `useCallback` that
   * closes over it fresh too, and a teardown effect that depends on one of
   * those then runs its cleanup on *every* render rather than on unmount —
   * which is to say it releases the gesture a frame after recognising it. That
   * is exactly what happened here, and it presented as a drag that selected
   * one note and then refused to grow: the press fired, the render it caused
   * tore the ownership straight back down, and the twenty pointer moves that
   * followed were talking to a gesture that had already let go.
   */
  return useMemo(() => ({ attach, track, stop }), [attach, stop, track]);
}

/** The least a scroller has to be for one tick to work on it. */
export type Followable = {
  scrollLeft: number;
  getBoundingClientRect(): { readonly left: number; readonly right: number };
};

/**
 * One tick of the follow: move the view, then ask again what is under the
 * finger. Returns false when the finger has left the band and the tick should
 * stop.
 *
 * A function rather than a closure inside the interval, so the *pair* can be
 * tested. Scrolling without asking again is the failure that matters here and
 * it is completely invisible from the outside: the picture moves, the next bar
 * slides under the thumb, and the range still says one bar because nothing
 * asked. A test that only checked the scroll would pass on exactly that.
 */
export function followTick(
  node: Followable,
  point: { readonly x: number; readonly y: number },
  onTick: (x: number, y: number) => void,
): boolean {
  const box = node.getBoundingClientRect();
  const direction = edgeDirection(point.x, box.left, box.right);
  if (direction === 0) return false;
  node.scrollLeft += direction * EDGE_STEP_PX;
  onTick(point.x, point.y);
  return true;
}

/**
 * Which way the view should travel for a finger at `x`, or 0 for neither.
 *
 * Exported so the arithmetic can be tested without a scroller, a pointer or a
 * clock: a band that is measured from the wrong edge is a bug that only shows
 * up as "it scrolls the wrong way at 320px".
 */
export function edgeDirection(x: number, left: number, right: number): -1 | 0 | 1 {
  if (x < left + EDGE_BAND_PX) return -1;
  if (x > right - EDGE_BAND_PX) return 1;
  return 0;
}

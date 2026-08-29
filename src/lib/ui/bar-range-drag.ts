/**
 * Holding a bar and reaching across its neighbours (2U-B §8).
 *
 * ## The finding this exists for
 *
 * «Ölçüye basılı tutup sağa sürükleyerek çoklu seçim yapamıyorum; parmağı
 * hareket ettirince alttaki tab/sayfa kayıyor.» A long press selected one bar;
 * a long press on the next one *replaced* that selection rather than widening
 * it; and dragging did nothing except scroll the staff out from under the
 * finger. Multi-measure selection was reachable in principle — the arrangement
 * grew handles for it — and unreachable with the gesture a musician actually
 * tries.
 *
 * ## Why the ownership is staged rather than declared
 *
 * `pointer-ownership.ts` decides who owns a press *before* it happens, from
 * what the reader is holding. That works for a pen and for a duration handle,
 * because both are known at pointerdown. This one cannot be: at the moment the
 * finger lands, "select bars" and "scroll the tab" are the same event, and
 * committing to either would break the other. The reader has told us nothing
 * yet.
 *
 * So it is decided by *time*, in three states:
 *
 * - **pressing** — the finger is down and it might still be a scroll. Nothing
 *   is owned, nothing is prevented, and the browser may take the gesture at
 *   any moment.
 * - **owning** — the threshold elapsed with the finger still inside the
 *   tolerance. Since it did not move, no scroll has begun, so from here the
 *   sequence can be claimed without ever having interrupted one.
 * - **idle** — nothing in flight.
 *
 * The move tolerance is what makes the middle transition safe: a finger that
 * wandered has already given the gesture to the scroller, and this machine
 * abandons rather than competing for it.
 *
 * ## What it deliberately does not know
 *
 * Not the DOM, not the Song, not the selection. It answers "which bar is the
 * anchor, which bar is the reach, and does this pointer sequence belong to us"
 * — and the surface turns that into a `MeasureGesture` for
 * `resolveMeasureGesture` to answer. Contiguity is not enforced here because
 * it cannot be violated: a range is an anchor and a reach, and every bar
 * between them is in it.
 */
import { LONG_PRESS_MOVE_TOLERANCE_PX } from "@/lib/ui/interaction";

export type BarRangeDrag =
  | { readonly kind: "idle" }
  | {
      readonly kind: "pressing";
      readonly pointerId: number;
      readonly startX: number;
      readonly startY: number;
      readonly barIndex: number;
      readonly sectionId: string;
    }
  | {
      readonly kind: "owning";
      readonly pointerId: number;
      /** The bar the press landed on. It does not move for the whole drag. */
      readonly anchorBar: number;
      /** The bar the finger is over now. Either side of the anchor. */
      readonly reachBar: number;
      readonly sectionId: string;
    };

export const IDLE: BarRangeDrag = { kind: "idle" };

/** A finger went down on a bar header. Nothing is owned yet. */
export function pressBar(
  pointerId: number,
  x: number,
  y: number,
  barIndex: number,
  sectionId: string,
): BarRangeDrag {
  return { kind: "pressing", pointerId, startX: x, startY: y, barIndex, sectionId };
}

/**
 * The finger moved.
 *
 * While pressing, moving past the tolerance hands the gesture to the scroller
 * for good — a finger that settles again does not get the press back, because
 * by then the page has already moved and the reader is scrolling.
 *
 * While owning, a move is a reach: the range grows or shrinks to wherever the
 * finger is. `barUnderPointer` is null when the finger has left the bars
 * entirely, and the reach simply stays where it was rather than snapping to an
 * edge the reader did not choose.
 */
export function moveDrag(
  state: BarRangeDrag,
  pointerId: number,
  x: number,
  y: number,
  barUnderPointer: { readonly barIndex: number; readonly sectionId: string } | null,
): BarRangeDrag {
  if (state.kind === "idle" || state.pointerId !== pointerId) return state;

  if (state.kind === "pressing") {
    const wandered =
      Math.abs(x - state.startX) >= LONG_PRESS_MOVE_TOLERANCE_PX ||
      Math.abs(y - state.startY) >= LONG_PRESS_MOVE_TOLERANCE_PX;
    return wandered ? IDLE : state;
  }

  if (barUnderPointer === null) return state;
  /*
   * A reach into another section is not a wider selection — a bar index only
   * means something inside the section that numbers it, so bar 2 of the chorus
   * and bar 2 of the verse are the same number and different music. The reach
   * stays where it was rather than silently naming the wrong bar; the reader
   * sees the range stop at the boundary, which is what the boundary is.
   */
  if (barUnderPointer.sectionId !== state.sectionId) return state;
  return barUnderPointer.barIndex === state.reachBar
    ? state
    : { ...state, reachBar: barUnderPointer.barIndex };
}

/**
 * The threshold elapsed. This is the moment ownership is taken.
 *
 * Only from `pressing`, and only for the pointer that started it: a timer that
 * outlived its gesture must not claim a sequence that belongs to something
 * else.
 */
export function recogniseDrag(
  state: BarRangeDrag,
  pointerId: number,
): BarRangeDrag {
  if (state.kind !== "pressing" || state.pointerId !== pointerId) return state;
  return {
    kind: "owning",
    pointerId: state.pointerId,
    anchorBar: state.barIndex,
    reachBar: state.barIndex,
    sectionId: state.sectionId,
  };
}

/**
 * The finger lifted, or the platform took the gesture.
 *
 * One function for `pointerup` and `pointercancel` alike, because the state
 * that must be left behind is the same: none. A cleanup that only ran on
 * `pointerup` would leave the page unscrollable whenever the browser
 * interrupted a drag, which is exactly the failure mode this is meant to
 * prevent rather than cause.
 */
export function releaseDrag(): BarRangeDrag {
  return IDLE;
}

/**
 * Does this pointer sequence belong to the bar-range selection?
 *
 * The one question the surface asks before preventing a scroll. False while
 * pressing — on purpose, and this is the whole of item 1 in §8: until the
 * threshold has elapsed the reader may still be scrolling, and a page that
 * refused to move from the instant a finger touched a bar number would be a
 * worse product than one that occasionally loses a drag.
 */
export function ownsPointer(state: BarRangeDrag, pointerId?: number): boolean {
  if (state.kind !== "owning") return false;
  return pointerId === undefined || state.pointerId === pointerId;
}

/** The run being held, low index first, whichever way the finger travelled. */
export function dragRange(
  state: BarRangeDrag,
): { readonly startBarIndex: number; readonly endBarIndex: number } | null {
  if (state.kind !== "owning") return null;
  return {
    startBarIndex: Math.min(state.anchorBar, state.reachBar),
    endBarIndex: Math.max(state.anchorBar, state.reachBar),
  };
}

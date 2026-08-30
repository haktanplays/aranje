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
 * ## What is here and what is not
 *
 * Telling this hold apart from a scroll is `press-drag.ts`, because the note
 * range is told apart from a scroll in exactly the same way and two copies of
 * that rule would be two rules. What is left here is the part that is about
 * bars: which one is the anchor, which one the finger has reached to, and what
 * run those two describe.
 *
 * Not the DOM, not the Song, not the selection. The surface turns the answer
 * into a `MeasureGesture` for `resolveMeasureGesture`. Contiguity is not
 * enforced because it cannot be violated: a range is an anchor and a reach,
 * and every bar between them is in it.
 */
import {
  IDLE as PRESS_IDLE,
  beginPress,
  holding,
  ownsPress,
  recognise,
  releasePress,
  wandered,
  type PressDrag,
} from "@/lib/ui/press-drag";

/** The two ends of the run, as the gesture currently understands them. */
type BarReach = {
  /** The bar the press landed on. It does not move for the whole drag. */
  readonly anchorBar: number;
  /** The bar the finger is over now. Either side of the anchor. */
  readonly reachBar: number;
  readonly sectionId: string;
};

export type BarRangeDrag = PressDrag<BarReach>;

export const IDLE: BarRangeDrag = PRESS_IDLE;

/** A finger went down on a bar header. Nothing is owned yet. */
export function pressBar(
  pointerId: number,
  x: number,
  y: number,
  barIndex: number,
  sectionId: string,
): BarRangeDrag {
  return beginPress(pointerId, x, y, {
    anchorBar: barIndex,
    reachBar: barIndex,
    sectionId,
  });
}

/**
 * The finger moved.
 *
 * While pressing, moving past the tolerance hands the gesture to the scroller
 * for good. While owning, a move is a reach: the range grows or shrinks to
 * wherever the finger is. `barUnderPointer` is null when the finger has left
 * the bars entirely, and the reach simply stays where it was rather than
 * snapping to an edge the reader did not choose.
 */
export function moveDrag(
  state: BarRangeDrag,
  pointerId: number,
  x: number,
  y: number,
  barUnderPointer: { readonly barIndex: number; readonly sectionId: string } | null,
): BarRangeDrag {
  if (state.kind === "idle" || state.pointerId !== pointerId) return state;
  if (state.kind === "pressing") return wandered(state, x, y) ? IDLE : state;

  if (barUnderPointer === null) return state;
  /*
   * A reach into another section is not a wider selection — a bar index only
   * means something inside the section that numbers it, so bar 2 of the chorus
   * and bar 2 of the verse are the same number and different music. The reach
   * stays where it was rather than silently naming the wrong bar; the reader
   * sees the range stop at the boundary, which is what the boundary is.
   */
  if (barUnderPointer.sectionId !== state.held.sectionId) return state;
  return barUnderPointer.barIndex === state.held.reachBar
    ? state
    : holding(state, { ...state.held, reachBar: barUnderPointer.barIndex });
}

/** The threshold elapsed. This is the moment ownership is taken. */
export function recogniseDrag(
  state: BarRangeDrag,
  pointerId: number,
): BarRangeDrag {
  return recognise(state, pointerId);
}

/** The finger lifted, or the platform took the gesture. */
export function releaseDrag(): BarRangeDrag {
  return releasePress();
}

/** Does this pointer sequence belong to the bar-range selection? */
export function ownsPointer(state: BarRangeDrag, pointerId?: number): boolean {
  return ownsPress(state, pointerId);
}

/** Which bar the drag took hold of, or null before it took hold of one. */
export function dragAnchor(
  state: BarRangeDrag,
): { readonly barIndex: number; readonly sectionId: string } | null {
  if (state.kind !== "owning") return null;
  return { barIndex: state.held.anchorBar, sectionId: state.held.sectionId };
}

/** The run being held, low index first, whichever way the finger travelled. */
export function dragRange(
  state: BarRangeDrag,
): { readonly startBarIndex: number; readonly endBarIndex: number } | null {
  if (state.kind !== "owning") return null;
  return {
    startBarIndex: Math.min(state.held.anchorBar, state.held.reachBar),
    endBarIndex: Math.max(state.held.anchorBar, state.held.reachBar),
  };
}

/**
 * Telling a hold apart from a scroll (2U-C §2, §3).
 *
 * Two gestures in the editor start life indistinguishable from a scroll: a
 * finger goes down on a bar header, or on a note, and stays there. Both then
 * reach sideways to say how much music they mean. They select different
 * things and are told apart from a scroll in exactly the same way, so the
 * telling-apart lives here and each gesture keeps only its own arithmetic.
 *
 * ## Why the ownership is staged rather than declared
 *
 * `pointer-ownership.ts` decides who owns a press *before* it happens, from
 * what the reader is holding. That works for a pen and for a duration handle,
 * because both are known at pointerdown. Neither of these can be: at the
 * moment the finger lands, "select" and "scroll the tab" are the same event,
 * and committing to either would break the other. The reader has told us
 * nothing yet.
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
 * ## What it carries
 *
 * Whatever the gesture needs to remember about where it started, as an opaque
 * value. The bar range keeps its anchor and reach in there; the note range
 * keeps nothing, because it resolves the music from coordinates every time and
 * has nothing to remember. This module never looks inside it.
 */
import { LONG_PRESS_MOVE_TOLERANCE_PX } from "@/lib/ui/interaction";

export type PressDrag<T> =
  | { readonly kind: "idle" }
  | {
      readonly kind: "pressing";
      readonly pointerId: number;
      readonly startX: number;
      readonly startY: number;
      readonly held: T;
    }
  | {
      readonly kind: "owning";
      readonly pointerId: number;
      readonly held: T;
    };

export const IDLE = { kind: "idle" } as const;

/** A finger went down. Nothing is owned yet. */
export function beginPress<T>(
  pointerId: number,
  x: number,
  y: number,
  held: T,
): PressDrag<T> {
  return { kind: "pressing", pointerId, startX: x, startY: y, held };
}

/**
 * Has the finger given the gesture to the scroller?
 *
 * Only ever asked while pressing. A finger that settles again does not get the
 * press back, because by then the page has already moved and the reader is
 * scrolling — so the caller goes to idle rather than back to pressing.
 */
export function wandered<T>(state: PressDrag<T>, x: number, y: number): boolean {
  if (state.kind !== "pressing") return false;
  return (
    Math.abs(x - state.startX) >= LONG_PRESS_MOVE_TOLERANCE_PX ||
    Math.abs(y - state.startY) >= LONG_PRESS_MOVE_TOLERANCE_PX
  );
}

/**
 * The threshold elapsed. This is the moment ownership is taken.
 *
 * Only from `pressing`, and only for the pointer that started it: a timer that
 * outlived its gesture must not claim a sequence that belongs to something
 * else.
 */
export function recognise<T>(
  state: PressDrag<T>,
  pointerId: number,
): PressDrag<T> {
  if (state.kind !== "pressing" || state.pointerId !== pointerId) return state;
  return { kind: "owning", pointerId: state.pointerId, held: state.held };
}

/** Replace what the gesture is holding, without touching its lifecycle. */
export function holding<T>(state: PressDrag<T>, held: T): PressDrag<T> {
  return state.kind === "idle" ? state : { ...state, held };
}

/**
 * The finger lifted, or the platform took the gesture.
 *
 * One function for `pointerup` and `pointercancel` alike, because the state
 * that must be left behind is the same: none. A cleanup that only ran on
 * `pointerup` would leave the page unscrollable whenever the browser
 * interrupted a drag, which is exactly the failure mode this is meant to
 * prevent rather than cause. What the two endings mean to the *reader* still
 * differs, and that is the caller's to say.
 */
export function releasePress<T>(): PressDrag<T> {
  return IDLE;
}

/**
 * Does this pointer sequence belong to the gesture?
 *
 * The one question the surface asks before preventing a scroll. False while
 * pressing — on purpose: until the threshold has elapsed the reader may still
 * be scrolling, and a page that refused to move from the instant a finger
 * touched it would be a worse product than one that occasionally loses a drag.
 */
export function ownsPress<T>(state: PressDrag<T>, pointerId?: number): boolean {
  if (state.kind !== "owning") return false;
  return pointerId === undefined || state.pointerId === pointerId;
}

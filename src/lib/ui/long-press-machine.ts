/**
 * When a press becomes a selection, and when it belongs to the scroller.
 *
 * Pure, and separate from the hook, so the rule that matters most can be
 * tested without a browser: the tab is a horizontal scroller and the same
 * finger does both jobs, so a flick must never be read as a long press.
 *
 * Three transitions decide it:
 *
 * - Time alone arms the press. A flick is over long before the threshold.
 * - Moving past the tolerance on either axis cancels it, and it does not come
 *   back if the finger settles again — the gesture belongs to the scroller
 *   from that moment on.
 * - Cancellation from the platform, which is what a browser sends once it has
 *   decided the gesture is a scroll, cancels too.
 */
import { LONG_PRESS_MOVE_TOLERANCE_PX, LONG_PRESS_MS } from "@/lib/ui/interaction";

export type PressState =
  | { readonly kind: "idle" }
  | { readonly kind: "pressing"; readonly x: number; readonly y: number; readonly at: number }
  /** The scroller has it; nothing further in this gesture can select. */
  | { readonly kind: "abandoned" };

export const IDLE: PressState = { kind: "idle" };

export function press(x: number, y: number, at: number): PressState {
  return { kind: "pressing", x, y, at };
}

export function movedTo(state: PressState, x: number, y: number): PressState {
  if (state.kind !== "pressing") return state;
  const dx = Math.abs(x - state.x);
  const dy = Math.abs(y - state.y);
  if (dx >= LONG_PRESS_MOVE_TOLERANCE_PX || dy >= LONG_PRESS_MOVE_TOLERANCE_PX) {
    return { kind: "abandoned" };
  }
  return state;
}

/** True once the finger has been still and down for long enough. */
export function hasFired(state: PressState, now: number): boolean {
  return state.kind === "pressing" && now - state.at >= LONG_PRESS_MS;
}

export const released = (): PressState => IDLE;
export const cancelled = (): PressState => ({ kind: "abandoned" });

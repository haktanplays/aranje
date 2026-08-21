/**
 * Interaction constants for touch (spec 13.1).
 *
 * One source. A long-press threshold copied into three components is three
 * different feels the day someone tunes one of them, and the gesture that has
 * to be distinguished from a scroll is exactly the one that cannot afford to
 * drift.
 */

/**
 * How long a finger must stay down before a press becomes a selection.
 *
 * Long enough that a flick to scroll the tab never trips it, short enough that
 * a deliberate hold does not feel broken. 500ms is the platform convention for
 * "press and hold" on both mobile platforms.
 */
export const LONG_PRESS_MS = 500;

/**
 * How far a finger may wander during a long press before it counts as a drag.
 *
 * The tab is a horizontal scroller, so this is the number that keeps "I meant
 * to scroll" and "I meant to select" apart. Below it the press survives; at or
 * beyond it the gesture belongs to the scroller and the press is abandoned.
 */
export const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

/** The smallest comfortable touch target, in px (spec 13.1). */
export const MIN_TOUCH_TARGET_PX = 44;

/** Width of a selection handle's grab area. Meets the touch target minimum. */
export const SELECTION_HANDLE_WIDTH_PX = MIN_TOUCH_TARGET_PX;

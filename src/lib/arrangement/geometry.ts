/**
 * How wide a bar is drawn in the arrangement (spec 13.10, K-39).
 *
 * The one rule this file exists to enforce: **a bar's width is how long it
 * lasts musically, and nothing else.**
 *
 * Two things that look like they should matter do not:
 *
 * - **The grid does not.** A 4/4 bar written at 1/8 and the same bar rewritten
 *   at 1/32 are the same length of music; only the writing got finer. Drawing
 *   the second one four times wider would tell a reader that the piece slows
 *   down whenever the notation gets busy, which is not true of any piece. The
 *   tab view is where the grid shows, because there a slot *is* the unit; here
 *   the unit is the bar.
 * - **The tempo does not.** Tempo is a property of playback, not of the
 *   written music (spec 8.3, K-25). A 4/4 bar is a 4/4 bar at 69 BPM and at
 *   138 BPM; only the seconds differ, and seconds are the transport's business.
 *
 * What does matter is the meter, and it matters honestly: a 3/4 bar holds
 * three quarters of the music a 4/4 bar holds, so it is drawn three quarters
 * as wide. 6/8 is the same length as 3/4 and is drawn the same width, which is
 * correct — they are the same amount of time, counted differently.
 *
 * The arithmetic falls out of the tick contract rather than being asserted
 * here. `ticksPerBar` is `numerator * TICKS_PER_WHOLE / denominator`: the
 * resolution appears in the slot count and again in the slot length, and
 * cancels. So "width from ticks" is *already* "width independent of grid", and
 * there is no second rule to keep in step with the first.
 */
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import {
  TICKS_PER_WHOLE,
  ticksPerBar,
  type Resolution,
  type TimeSignature,
} from "@/lib/music/timing";

/**
 * Width of one whole note of music, in pixels.
 *
 * Sized so the narrowest meter in the contract still clears the touch minimum
 * with room to spare: 3/4 and 6/8 come out at 72px, 4/4 at 96px, 7/8 at 84px.
 * A bar cell is a real tap target — it navigates — so it cannot be a sliver.
 */
export const PX_PER_WHOLE = 96;

/** Height of one track's lane. A lane is tappable, so it meets the minimum. */
export const LANE_HEIGHT = 44;

/**
 * Width of the sticky track-name column on the left.
 *
 * Every pixel here is a pixel of music the reader does not see, and at 320px it
 * was taking nearly a third of the row to print an instrument name that the
 * track sheet already carries in full. The lane shows the track's *name*; what
 * it is and how it is set up is a question with a place to be answered.
 *
 * Narrow enough to give the timeline the room, wide enough that a real Turkish
 * track name — "Ritim Gitar", "Klasik Gitar" — is readable rather than three
 * letters and an ellipsis.
 */
export const TRACK_LABEL_WIDTH = 108;

/**
 * Height of the section header strip above the lanes.
 *
 * A section header is a button — it takes you to that section — so it is a
 * touch target and answers to the same minimum as every other one. It was 34px
 * until a real viewport was measured, which is exactly the kind of number that
 * looks fine in a screenshot and is not.
 */
export const SECTION_HEADER_HEIGHT = MIN_TOUCH_TARGET_PX;

/**
 * How much of a whole note this bar lasts.
 *
 * 4/4 -> 1, 3/4 -> 0.75, 6/8 -> 0.75, 7/8 -> 0.875.
 */
export function barWholeNotes(
  timeSignature: TimeSignature,
  resolution: Resolution,
): number {
  return ticksPerBar(timeSignature, resolution) / TICKS_PER_WHOLE;
}

/**
 * How wide this bar is drawn, in pixels.
 *
 * Rounded, because a bar is a box on a screen and half-pixel boxes make the
 * column lines between two lanes disagree with each other. Every supported
 * meter lands on a whole number anyway at the current scale; the rounding is
 * there so that stays true if the scale is ever retuned.
 */
export function arrangementBarWidth(
  timeSignature: TimeSignature,
  resolution: Resolution,
): number {
  return Math.round(barWholeNotes(timeSignature, resolution) * PX_PER_WHOLE);
}

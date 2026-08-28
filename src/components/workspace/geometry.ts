/**
 * Shared pixel geometry for the tab workspace.
 *
 * Rows are tight on purpose: six strings should read as one compact tab line,
 * not as a grid. Drums share the density family but keep their own row height,
 * since a lane needs more room than a string.
 */
/** The bar-header attribute both surfaces and the scroll targets share. */
export const BAR_KEY_ATTRIBUTE = "data-bar-key";

import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";

export const SLOT_WIDTH = 34;
export const STRING_ROW_HEIGHT = 26;

/**
 * How tall a string's row is while the staff is being written into (2S-A §4).
 *
 * Reading and writing want different rows. Six strings at 26px read as one
 * compact tab line, which is what the reading surface is for; but in edit mode
 * that row **is** the hit target, and 34 × 26 is under the touch minimum on
 * both axes. The drum grid met the same wall in 2Q-B and answered it the same
 * way: the row grows to the finger's height, and the width stays one slot —
 * because widening a slot would pull this lane's bar lines away from every
 * other lane's, and holding those together is the whole point of the shared
 * axis (K-57).
 *
 * The remaining 10px of width is bought the only honest way left: the cell is
 * a slot wide and the *staff* is what grew, so no two cells overlap and no tap
 * is ambiguous. That the width is still 34 is recorded rather than hidden.
 */
export const EDIT_STRING_ROW_HEIGHT = MIN_TOUCH_TARGET_PX;
export const DRUM_ROW_HEIGHT = 30;

/**
 * How tall a row is while the kit is being written into (2Q-B §5.2).
 *
 * Taller than a reading row on purpose: this row *is* the hit target, and a
 * finger needs the full touch height. It is the one dimension that can be
 * given honestly — the width stays one slot, because widening a cell would
 * pull this lane's bar lines away from every other lane's, which is the one
 * thing the Çoklu view exists to hold together.
 */
export const DRUM_STEP_ROW_HEIGHT = MIN_TOUCH_TARGET_PX;
/**
 * The strip under the staff.
 *
 * It grew from 18 to 28 in 2N-A: the beat ticks and the onset dots were all it
 * carried, and the rhythmic guide (spec 13.20 §7) needed room under them for a
 * stem, up to three beam lines and a triplet "3". It grew again to 34 in
 * 2T-B §4, when the guide became a real tail: the same stem and beams, plus a
 * dot, a tie mark, a rest with its own value, and a tuplet bracket with its
 * number under the beams rather than crowded into them.
 *
 * Vertical only — nothing here widens a bar, so the horizontal-overflow and
 * scroller counts are unchanged, and no fret digit moves by a pixel.
 */
export const RHYTHM_ROW_HEIGHT = 34;

/** How much of that row the beat ticks and onset dots use; the tail is under. */
export const RHYTHM_STRIP_HEIGHT = 14;

/** What is left for the tail itself. */
export const RHYTHM_TAIL_HEIGHT = RHYTHM_ROW_HEIGHT - RHYTHM_STRIP_HEIGHT;
export const GUTTER_WIDTH = 34;
export const BAR_HEADER_HEIGHT = 22;

/** Space above the staff, so the music sits high in the work area. */
export const STAFF_TOP_PADDING = 28;

/**
 * The multi-track view's lane geometry (2Q-A §7).
 *
 * Here rather than in the lane components, for the reason every other number
 * in this file is here: three components draw lanes and a fourth measures
 * them, and four copies of "44" is how a header stops being a touch target
 * without anything failing.
 *
 * `LANE_HEADER_HEIGHT` is the finger's minimum, not a look. The notation
 * heights are the same row heights the single-track tab uses, so a guitar
 * does not become a different instrument when it is read beside a bass.
 */
export const LANE_HEADER_HEIGHT = 44;
/** Breathing room under a lane's notation, before the next lane's header. */
export const LANE_GAP = 6;
/** A collapsed lane keeps its header and a thin digest, and never vanishes. */
export const LANE_DIGEST_HEIGHT = 14;
/** How tall a pitched lane's note field is, whatever its range. */
export const PITCHED_LANE_HEIGHT = 72;

export function barWidth(slotCount: number): number {
  return slotCount * SLOT_WIDTH;
}

/** Horizontal centre of a slot inside its bar. */
export function slotCentre(slotIndex: number): number {
  return slotIndex * SLOT_WIDTH + SLOT_WIDTH / 2;
}

/**
 * Slots per beat, used for the light beat ticks under the staff.
 *
 * Re-exported rather than recomputed: the grid arithmetic has exactly one
 * owner (spec 5.5, K-34), and a second copy here is how a triplet bar ends
 * up drawn with straight beat ticks.
 */
export { slotsPerNotatedBeat as slotsPerBeat } from "@/lib/music/timing";

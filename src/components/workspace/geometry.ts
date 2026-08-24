/**
 * Shared pixel geometry for the tab workspace.
 *
 * Rows are tight on purpose: six strings should read as one compact tab line,
 * not as a grid. Drums share the density family but keep their own row height,
 * since a lane needs more room than a string.
 */
/** The bar-header attribute both surfaces and the scroll targets share. */
export const BAR_KEY_ATTRIBUTE = "data-bar-key";

export const SLOT_WIDTH = 34;
export const STRING_ROW_HEIGHT = 26;
export const DRUM_ROW_HEIGHT = 30;
/**
 * The strip under the staff.
 *
 * It grew from 18 to 28 in 2N-A: the beat ticks and the onset dots were all it
 * carried, and the rhythmic guide (spec 13.20 §7) needs room under them for a
 * stem, up to three beam lines and a triplet "3". Vertical only — nothing here
 * widens a bar, so the horizontal-overflow and scroller counts are unchanged.
 */
export const RHYTHM_ROW_HEIGHT = 28;

/** How much of that row the beat ticks and onset dots use; the guide is under. */
export const RHYTHM_STRIP_HEIGHT = 14;
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

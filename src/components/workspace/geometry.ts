/**
 * Shared pixel geometry for the tab workspace.
 *
 * Rows are tight on purpose: six strings should read as one compact tab line,
 * not as a grid. Drums share the density family but keep their own row height,
 * since a lane needs more room than a string.
 */
export const SLOT_WIDTH = 34;
export const STRING_ROW_HEIGHT = 26;
export const DRUM_ROW_HEIGHT = 30;
export const RHYTHM_ROW_HEIGHT = 18;
export const GUTTER_WIDTH = 34;
export const BAR_HEADER_HEIGHT = 22;

/** Space above the staff, so the music sits high in the work area. */
export const STAFF_TOP_PADDING = 28;

export function barWidth(slotCount: number): number {
  return slotCount * SLOT_WIDTH;
}

/** Horizontal centre of a slot inside its bar. */
export function slotCentre(slotIndex: number): number {
  return slotIndex * SLOT_WIDTH + SLOT_WIDTH / 2;
}

/**
 * Slots per beat, used for the light beat ticks under the staff.
 * x/4 ticks every quarter, x/8 ticks every eighth.
 */
export function slotsPerBeat(
  timeSignature: readonly [number, number],
  resolution: number,
): number {
  return Math.max(1, resolution / timeSignature[1]);
}

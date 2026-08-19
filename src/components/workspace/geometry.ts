/**
 * Shared pixel geometry for the tab workspace.
 *
 * Rows are deliberately tall: in portrait the staff has to be the dominant
 * element on screen, not a strip at the top.
 */
export const SLOT_WIDTH = 40;
export const STRING_ROW_HEIGHT = 56;
export const DRUM_ROW_HEIGHT = 56;
export const RHYTHM_ROW_HEIGHT = 24;
export const GUTTER_WIDTH = 42;
export const BAR_HEADER_HEIGHT = 26;

export function barWidth(slotCount: number): number {
  return slotCount * SLOT_WIDTH;
}

/** Horizontal centre of a slot inside its bar. */
export function slotCentre(slotIndex: number): number {
  return slotIndex * SLOT_WIDTH + SLOT_WIDTH / 2;
}

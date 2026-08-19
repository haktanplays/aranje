/**
 * Where the playhead sits, in the scroll content's own coordinates.
 *
 * Derived from the plan rather than measured from the DOM, so the position is
 * known before a frame is painted and cannot disagree with the layout.
 */
import { GUTTER_WIDTH, SLOT_WIDTH } from "@/components/workspace/geometry";
import type { PlayPosition } from "@/lib/audio/position";
import type { SongPlan } from "@/lib/audio/schedule";

/** Left edge of a bar, counted from the start of the scroll content. */
export function barLeft(plan: SongPlan, barIndex: number): number {
  let x = GUTTER_WIDTH;
  for (let index = 0; index < barIndex; index += 1) {
    x += (plan.bars[index]?.slotCount ?? 0) * SLOT_WIDTH;
  }
  return x;
}

export function barPixelWidth(plan: SongPlan, barIndex: number): number {
  return (plan.bars[barIndex]?.slotCount ?? 0) * SLOT_WIDTH;
}

/** Playhead x, or null when the transport is not inside the song. */
export function playheadX(
  plan: SongPlan,
  position: PlayPosition,
): number | null {
  if (position.barIndex < 0) return null;
  return (
    barLeft(plan, position.barIndex) +
    position.barProgress * barPixelWidth(plan, position.barIndex)
  );
}

export type FollowWindow = {
  scrollLeft: number;
  clientWidth: number;
};

/**
 * Where to scroll so the playhead stays visible.
 *
 * Returns null while it is already comfortably inside the window, so the view
 * only jumps when it has to. The jump is a direct scroll position, never a
 * per-frame smooth scroll, which would lag a frame behind for ever.
 */
export function followScrollLeft(
  x: number,
  view: FollowWindow,
  contentWidth: number,
): number | null {
  // The sticky gutter covers the left edge, so the comfort zone starts after it.
  const leftEdge = view.scrollLeft + GUTTER_WIDTH;
  const rightEdge = view.scrollLeft + view.clientWidth - SLOT_WIDTH;

  if (x >= leftEdge && x <= rightEdge) return null;

  // Put the playhead a third of the way in, so there is room to read ahead.
  const target = x - GUTTER_WIDTH - view.clientWidth / 3;
  const maxScroll = Math.max(0, contentWidth - view.clientWidth);
  return Math.min(maxScroll, Math.max(0, target));
}

import { slotCentre } from "@/components/workspace/geometry";

export type PlayheadPosition = { barKey: string; slotIndex: number };

/**
 * Reserved layer for the vertical playhead.
 *
 * The transport arrives in the next checkpoint, so `position` is always null
 * for now and nothing is drawn. The layer exists so the tab body already has
 * the stacking context and the coordinate maths the playhead will use.
 */
export function PlayheadLayer({
  position,
  barKey,
  height,
}: {
  position: PlayheadPosition | null;
  barKey: string;
  height: number;
}) {
  if (!position || position.barKey !== barKey) return null;

  return (
    <div
      aria-hidden
      className="bg-steel pointer-events-none absolute top-0 w-px"
      style={{ left: slotCentre(position.slotIndex), height }}
    />
  );
}

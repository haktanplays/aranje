/**
 * The grid a bar's header announces, or nothing (spec 5.5, 13.x, K-34).
 *
 * Its own module because three renderers ask for it — the tab, the fretted
 * lane and the drum lane — and two of them were reaching into `TabCanvas` to
 * get it. A lane importing a canvas is the wrong direction: the canvas
 * composes lanes.
 */
import {
  isTripletGrid,
  resolutionLabel,
  type Resolution,
} from "@/lib/music/timing";

/**
 * Shown when the grid *changes* — a reader needs to know the counting just
 * changed, and marking every bar of a piece written on one grid would be
 * noise — and always on a triplet bar, because "three to the beat here" is
 * true whether or not the bar before it was the same.
 *
 * The label is a note value, never the raw number: "1/12" sitting next to
 * "1/16" reads as a straight grid, which is exactly what it is not.
 */
export function gridLabelFor(
  bars: readonly { resolution: Resolution }[],
  index: number,
): string | null {
  const bar = bars[index];
  if (!bar) return null;
  const previous = index > 0 ? bars[index - 1] : undefined;
  const changed = previous === undefined || previous.resolution !== bar.resolution;
  if (!changed && !isTripletGrid(bar.resolution)) return null;
  return resolutionLabel(bar.resolution);
}

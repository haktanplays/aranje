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
  readingResolution,
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
  bars: readonly { resolution: Resolution; notation?: Resolution }[],
  index: number,
): string | null {
  const bar = bars[index];
  if (!bar) return null;
  /*
   * The grid the reader is on, not the one the data is stored on (2V-B.4
   * Completion §5, §7). A bar raised to a lattice so a triplet could sit
   * beside its sixteenths is still, to the reader, a bar of sixteenths — and
   * announcing a change here would be the app telling them their measure
   * moved to a grid they never chose.
   */
  const here = readingResolution(bar);
  const previous = index > 0 ? bars[index - 1] : undefined;
  const changed = previous === undefined || readingResolution(previous) !== here;
  if (!changed && !isTripletGrid(here)) return null;
  return resolutionLabel(here);
}

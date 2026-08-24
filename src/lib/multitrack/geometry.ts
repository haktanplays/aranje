/**
 * Where each bar sits on the shared time axis (2Q-A §5, §6).
 *
 * Pure arithmetic over the model's bar list. It takes the slot width as an
 * argument rather than importing a pixel constant, which keeps the direction
 * of dependency right — a module under `lib/` does not reach into a
 * component for its numbers — and makes the axis testable in any unit.
 *
 * ## Why the width comes from slots
 *
 * A bar's width is its slot count times the slot width. That is the same rule
 * the single-track tab already uses, and it is a *musical* rule rather than a
 * temporal one: **tempo does not appear in it anywhere**, so slowing a song
 * down does not stretch its notation.
 *
 * It is deliberately not "width proportional to tick duration". Two bars of
 * the same duration written at 1/8 and at 1/32 would then be the same width,
 * and the 1/32 bar's glyphs would be a quarter of the size — unreadable, on
 * the surface whose whole purpose is reading. The tick duration is carried in
 * the model beside the slot count, so a future rule change has one place to
 * happen and nothing to recompute.
 *
 * ## Why every lane lands on the same x
 *
 * Not by agreement between lanes, and not by anything kept in step at scroll
 * time: meter and resolution belong to the **bar**, so every track written in
 * a bar has the same slot count, and the axis is computed once from the
 * section rather than once per lane.
 */
import type { MultiBar } from "@/lib/multitrack/model";

export type BarPlacement = {
  readonly key: string;
  readonly barIndex: number;
  readonly x: number;
  readonly width: number;
  readonly slotCount: number;
  readonly startTicks: number;
  readonly durationTicks: number;
};

export type TimeAxis = {
  readonly bars: readonly BarPlacement[];
  readonly width: number;
  readonly totalTicks: number;
};

/** The shared axis: one pass over the section's bars, left to right. */
export function timeAxis(
  bars: readonly MultiBar[],
  slotWidth: number,
): TimeAxis {
  let x = 0;
  const placements = bars.map((bar): BarPlacement => {
    const width = bar.slotCount * slotWidth;
    const placement: BarPlacement = {
      key: bar.key,
      barIndex: bar.barIndex,
      x,
      width,
      slotCount: bar.slotCount,
      startTicks: bar.startTicks,
      durationTicks: bar.durationTicks,
    };
    x += width;
    return placement;
  });
  const last = bars.at(-1);
  return {
    bars: placements,
    width: x,
    totalTicks: last ? last.startTicks + last.durationTicks : 0,
  };
}

/**
 * Where the playhead belongs, or null when this tick is not in this section.
 *
 * Null rather than a clamped edge on purpose: a playhead pinned to the left
 * margin while the music is two sections away is a drawn claim that is not
 * true. The caller draws nothing instead (§6).
 */
export function playheadX(
  axis: TimeAxis,
  sectionStartTicks: number,
  songTicks: number,
): number | null {
  const local = songTicks - sectionStartTicks;
  if (local < 0 || local > axis.totalTicks) return null;
  for (const bar of axis.bars) {
    const end = bar.startTicks + bar.durationTicks;
    if (local > end) continue;
    const through = bar.durationTicks === 0 ? 0 : (local - bar.startTicks) / bar.durationTicks;
    return bar.x + through * bar.width;
  }
  // Exactly at the end of the last bar.
  return axis.width;
}

/**
 * Where one slot of one bar starts. Used for a selection band and a cell.
 *
 * The slot width is taken from the bar rather than passed in: a bar's slots
 * share its width by definition, and taking a second opinion on it is how a
 * band ends up a pixel off the cell it is meant to sit under.
 */
export function slotX(bar: BarPlacement, slotIndex: number): number {
  return bar.x + slotIndex * (bar.width / Math.max(1, bar.slotCount));
}

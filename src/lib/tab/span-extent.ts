/**
 * Where a sounding note lands on the grid, bar by bar (2T-B §4).
 *
 * ## The gap this closes
 *
 * Score Truth v2 gave a note its own length, and `soundingSpans` says how long
 * that note is actually heard. Neither of those reached the screen or the
 * speakers: the tab built its spans by walking tie runs, and the audio
 * scheduler read its durations back off those spans. So a note written twice
 * as long as its slot drew one cell and played for one cell, and the whole
 * duration model was a thing the model knew and the reader never found out.
 *
 * This is the piece in between. Given a note's start and its sounding length
 * in ticks, it answers the only question the view and the scheduler actually
 * have: which slots of which bars is this note occupying, and does it run in
 * from before or out past the end?
 *
 * ## Why it is ticks in and slots out
 *
 * Bars can be on different grids, so a note crossing a bar line covers a
 * different number of slots on each side of it. Ticks are the one currency
 * both sides agree on; slots are what gets drawn. Doing the conversion once,
 * here, is what stops the tab and the scheduler from each doing their own
 * arithmetic and disagreeing in the third decimal place.
 */
import { slotCount, ticksPerSlot } from "@/lib/music/timing";
import type { Bar } from "@/lib/song/schema";
import { barOffsets } from "@/lib/song/sounding";

export type BarSlice = {
  /** Index into the bar list this was sliced against. */
  readonly barIndex: number;
  readonly startSlot: number;
  /** Inclusive, the way the tab has always counted. */
  readonly endSlot: number;
  /** Already sounding when this bar began. */
  readonly openStart: boolean;
  /** Still sounding when this bar ended. */
  readonly openEnd: boolean;
};

/**
 * The slices of grid one note covers.
 *
 * A note shorter than a slot still gets the slot it starts in — there is
 * nowhere smaller to draw it, and leaving it out would lose the note. A note
 * whose string was taken at the very instant it began has no sounding time at
 * all, and it *still* gets its own slot: it is written music, and the reader
 * has to be able to see the thing that is not being heard.
 */
export function sliceSpan(
  bars: readonly Bar[],
  startTicks: number,
  soundingTicks: number,
): readonly BarSlice[] {
  const offsets = barOffsets(bars);
  const endTicks = startTicks + Math.max(soundingTicks, 1);
  const slices: BarSlice[] = [];

  bars.forEach((bar, barIndex) => {
    const step = ticksPerSlot(bar.resolution);
    const barStart = offsets[barIndex]!;
    const barEnd = barStart + slotCount(bar.timeSignature, bar.resolution) * step;

    const from = Math.max(startTicks, barStart);
    const to = Math.min(endTicks, barEnd);
    if (to <= from) return;

    const startSlot = Math.floor((from - barStart) / step);
    const endSlot = Math.max(startSlot, Math.ceil((to - barStart) / step) - 1);
    slices.push({
      barIndex,
      startSlot,
      endSlot,
      openStart: from > startTicks,
      openEnd: to < endTicks,
    });
  });

  return slices;
}

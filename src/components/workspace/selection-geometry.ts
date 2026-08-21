/**
 * Where a time selection lands on the tab, in pixels (spec 5.5, 13.1, K-34).
 *
 * Pure, and derived from **ticks**, never from slot indices. Bars stopped
 * sharing a grid in 2H-A, so slot 8 sits a third of the way into a 1/8 bar and
 * a quarter of the way into a 1/32 one. A band positioned by index would drift
 * further from the music with every grid change in the section, and would
 * misplace itself in exactly the bars — fills, runs — where the reader is most
 * likely to be selecting something.
 *
 * One consequence worth stating: a selection crossing a bar line is one band
 * with one left edge and one right edge, not two. The bars in between are
 * covered continuously, so the reader sees a range rather than fragments.
 */
import { SLOT_WIDTH, barWidth } from "@/components/workspace/geometry";
import { slotCount, ticksPerSlot } from "@/lib/music/timing";
import type { Section } from "@/lib/song/schema";

/** Left edge and total width of each bar, plus where it starts in ticks. */
export type BarSpan = {
  readonly barIndex: number;
  readonly x: number;
  readonly width: number;
  readonly startTicks: number;
  readonly durationTicks: number;
};

export function barSpans(section: Section): BarSpan[] {
  const spans: BarSpan[] = [];
  let x = 0;
  let startTicks = 0;

  for (const [barIndex, bar] of section.bars.entries()) {
    const count = slotCount(bar.timeSignature, bar.resolution);
    const width = barWidth(count);
    const durationTicks = count * ticksPerSlot(bar.resolution);
    spans.push({ barIndex, x, width, startTicks, durationTicks });
    x += width;
    startTicks += durationTicks;
  }

  return spans;
}

/**
 * The x for a moment in the section, or null when it lies outside it.
 *
 * Interpolates inside the bar the tick falls in, so a moment halfway through a
 * slot is drawn halfway through it rather than snapped to its edge — the band
 * has to be able to show that a selection ends where a note ends.
 */
export function xForTicks(section: Section, ticks: number): number | null {
  const spans = barSpans(section);
  const last = spans[spans.length - 1];
  if (!last) return null;

  const totalTicks = last.startTicks + last.durationTicks;
  if (ticks < 0 || ticks > totalTicks) return null;
  // The very end of the section is the right edge of its last bar.
  if (ticks === totalTicks) return last.x + last.width;

  for (const span of spans) {
    if (ticks >= span.startTicks + span.durationTicks) continue;
    const into = (ticks - span.startTicks) / span.durationTicks;
    return span.x + into * span.width;
  }
  return null;
}

/** Left edge and width of a band, or null when it cannot be drawn. */
export function bandFor(
  section: Section,
  startTicks: number,
  endTicks: number,
): { readonly left: number; readonly width: number } | null {
  const left = xForTicks(section, startTicks);
  const right = xForTicks(section, endTicks);
  if (left === null || right === null) return null;
  // A zero-width band would be invisible; give the caret something to show.
  return { left, width: Math.max(right - left, SLOT_WIDTH / 8) };
}

/** The tick a horizontal position falls on, snapped down to its slot. */
export function ticksForX(section: Section, x: number): number | null {
  const spans = barSpans(section);
  for (const span of spans) {
    if (x < span.x || x >= span.x + span.width) continue;
    const bar = section.bars[span.barIndex];
    if (!bar) return null;
    const step = ticksPerSlot(bar.resolution);
    const slotIndex = Math.floor((x - span.x) / SLOT_WIDTH);
    return span.startTicks + slotIndex * step;
  }
  return null;
}

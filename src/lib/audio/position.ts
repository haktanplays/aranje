/**
 * Where the transport is, and where a loop has to begin and end.
 *
 * Everything is in ticks, the same unit the scheduler places events on, so the
 * sound, the playhead, the active bar and the loop boundaries all read from one
 * timeline. There is no separate clock for the interface.
 */
import { ticksPerSlot, type BarMarker, type SongPlan } from "@/lib/audio/schedule";

export type PlayPosition = {
  ticks: number;
  /** Index into plan.bars, or -1 when the transport is past the end. */
  barIndex: number;
  barKey: string | null;
  sectionId: string | null;
  /** Grid slot inside that bar. */
  slotIndex: number;
  /** 0 to 1 across the bar, for drawing the playhead between slots. */
  barProgress: number;
};

export const NOWHERE: PlayPosition = {
  ticks: 0,
  barIndex: -1,
  barKey: null,
  sectionId: null,
  slotIndex: 0,
  barProgress: 0,
};

function barAt(bars: readonly BarMarker[], ticks: number): number {
  if (ticks < 0) return -1;
  // Bars are contiguous and in order, so a scan is enough at this length.
  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    if (!bar) continue;
    if (ticks < bar.time + bar.durationTicks) return index;
  }
  return -1;
}

export function positionAtTicks(plan: SongPlan, ticks: number): PlayPosition {
  const barIndex = barAt(plan.bars, ticks);
  const bar = barIndex >= 0 ? plan.bars[barIndex] : undefined;
  if (!bar) return { ...NOWHERE, ticks: Math.max(0, ticks) };

  const into = ticks - bar.time;
  const step = ticksPerSlot(bar.resolution);
  const slotIndex = Math.min(bar.slotCount - 1, Math.floor(into / step));

  return {
    ticks,
    barIndex,
    barKey: bar.barKey,
    sectionId: bar.sectionId,
    slotIndex: Math.max(0, slotIndex),
    barProgress: Math.min(1, Math.max(0, into / bar.durationTicks)),
  };
}

/** First tick of a bar, for seeking. */
export function barStartTicks(plan: SongPlan, barKey: string): number | null {
  return plan.bars.find((bar) => bar.barKey === barKey)?.time ?? null;
}

/**
 * Loop boundaries for a section, snapped to whole bars by construction: the
 * start is the first tick of its first bar and the end is the tick the bar
 * after its last one begins on.
 */
export function sectionLoopBounds(
  plan: SongPlan,
  sectionId: string,
): { startTicks: number; endTicks: number } | null {
  const bars = plan.bars.filter((bar) => bar.sectionId === sectionId);
  const first = bars[0];
  const last = bars[bars.length - 1];
  if (!first || !last) return null;
  return { startTicks: first.time, endTicks: last.time + last.durationTicks };
}

/**
 * Slots per felt beat. In x/4 the beat is the quarter note. In compound time,
 * where the numerator divides by three, the beat is the dotted note, so 6/8
 * counts two beats rather than six.
 */
export function slotsPerBeat(bar: BarMarker): number {
  const [numerator, denominator] = bar.timeSignature;
  const base = bar.resolution / denominator;
  if (denominator === 8 && numerator % 3 === 0) return base * 3;
  return base;
}

export type BeatClick = { time: number; downbeat: boolean };

/** Every metronome click of the song, on the same tick timeline as the music. */
export function metronomeClicks(plan: SongPlan): BeatClick[] {
  const clicks: BeatClick[] = [];
  for (const bar of plan.bars) {
    const step = ticksPerSlot(bar.resolution);
    const perBeat = slotsPerBeat(bar);
    for (let slot = 0; slot < bar.slotCount; slot += perBeat) {
      clicks.push({ time: bar.time + slot * step, downbeat: slot === 0 });
    }
  }
  return clicks;
}

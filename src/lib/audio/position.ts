/**
 * Where the transport is, and where a loop has to begin and end.
 *
 * Everything is in ticks, the same unit the scheduler places events on, so the
 * sound, the playhead, the active bar and the loop boundaries all read from one
 * timeline. There is no separate clock for the interface.
 */
import { type BarMarker, type SongPlan } from "@/lib/audio/schedule";
import { slotsPerFeltBeat, ticksPerSlot } from "@/lib/music/timing";

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
 * The bar this plan still has that is nearest a bar key that may be gone.
 *
 * Bars can be removed and inserted (spec 13.12), so a key held across a song
 * change can name a bar that no longer exists — or, worse, one that exists and
 * means something else, because the bars behind a deleted one all shift down.
 * The answer is deliberately dumb and deliberately local: the same section if
 * it is still there, clamped to the bars it now has. Somewhere close in the
 * same part of the song is what a musician means by "where I was"; the top of
 * the song is not.
 *
 * `null` only when the plan has no bars at all.
 */
export function nearestBarKey(plan: SongPlan, barKey: string): string | null {
  if (plan.bars.some((bar) => bar.barKey === barKey)) return barKey;

  const separator = barKey.lastIndexOf(":");
  const sectionId = separator < 0 ? barKey : barKey.slice(0, separator);
  const inSection = plan.bars.filter((bar) => bar.sectionId === sectionId);
  const pool = inSection.length > 0 ? inSection : plan.bars;

  const wanted = Number(barKey.slice(separator + 1));
  const index = Number.isInteger(wanted)
    ? Math.min(Math.max(0, wanted), pool.length - 1)
    : 0;
  return pool[index]?.barKey ?? null;
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
 * Slots per felt beat, for one bar of a plan.
 *
 * The rule itself lives in the timing module with the rest of the grid
 * arithmetic (spec 5.5, K-34); this is only the plan-shaped way in.
 */
export function slotsPerBeat(bar: BarMarker): number {
  return slotsPerFeltBeat(bar.timeSignature, bar.resolution);
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

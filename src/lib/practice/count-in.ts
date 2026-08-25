/**
 * The clicks before the loop comes round (2R-A §11).
 *
 * A count-in is the difference between a loop you can start playing with and
 * one you can only chase. It is off, one bar, or two — nothing else, because
 * a number field here is a setting nobody tunes and every extra option is a
 * decision the reader has to make before they can practise.
 *
 * ## Counted from the bar the loop starts on
 *
 * Not from the song's meter, not from 4/4, and not from whatever the reader
 * last saw: from the **first bar of the range**. A 7/8 loop counts seven
 * eighths — well, two clicks, because 7/8 is felt in two — and a 6/8 loop
 * counts two, not six. That rule already exists as `slotsPerFeltBeat` and is
 * not restated here; a second copy is a second answer waiting to disagree
 * with the metronome.
 *
 * ## No fake bars
 *
 * The count-in exists in the transport's schedule and nowhere else. It does
 * not add a bar to the Song, does not appear in the tab, is not exported and
 * does not move a single bar number. A reader who counts nine bars in a
 * section of eight has been lied to by their tool.
 *
 * ## At the speed they are practising
 *
 * The clicks land at the effective tempo — the section's BPM through the
 * practice rate, and through the progressive rate when one is running. A
 * count-in at the written tempo in front of a loop at 70% is worse than none:
 * it teaches the wrong pulse in the last second before playing.
 */
import { effectiveBpm } from "@/lib/audio/practice-rate";
import { PPQ, slotCount, slotsPerFeltBeat, ticksPerSlot } from "@/lib/music/timing";
import type { Bar } from "@/lib/song/schema";

/** Off, one bar, or two. */
export type CountInBars = 0 | 1 | 2;

export const COUNT_IN_CHOICES: readonly CountInBars[] = [0, 1, 2];

export const DEFAULT_COUNT_IN: CountInBars = 0;

export function isCountInBars(value: number): value is CountInBars {
  return value === 0 || value === 1 || value === 2;
}

/** How the reader is offered it. Turkish, and about music rather than settings. */
export function countInLabel(bars: CountInBars): string {
  if (bars === 0) return "Kapalı";
  return bars === 1 ? "1 ölçü" : "2 ölçü";
}

/** One click of the count-in, on its own timeline. */
export type CountInClick = {
  /** Seconds before the loop's first tick sounds. Always positive. */
  readonly beforeSeconds: number;
  /** True on the first click of each counted bar. */
  readonly downbeat: boolean;
  /** 1-based, the number a reader would say out loud. */
  readonly beat: number;
};

/**
 * How many felt beats one bar of this meter has.
 *
 * Derived from the same grid rule the metronome uses rather than from the
 * time signature's numerator, which is wrong in compound time — 6/8 has six
 * eighths and two beats.
 */
export function feltBeatsIn(bar: Bar): number {
  const slots = slotCount(bar.timeSignature, bar.resolution);
  const perBeat = slotsPerFeltBeat(bar.timeSignature, bar.resolution);
  return Math.max(1, Math.round(slots / perBeat));
}

/** How long one felt beat of this bar lasts, in ticks. */
export function feltBeatTicks(bar: Bar): number {
  return slotsPerFeltBeat(bar.timeSignature, bar.resolution) *
    ticksPerSlot(bar.resolution);
}

export type CountInInput = {
  readonly bars: CountInBars;
  /** The first bar of the range, whose meter is counted. */
  readonly firstBar: Bar;
  /** The tempo in force where the loop starts, before the practice rate. */
  readonly bpm: number;
  /** The practice rate as a percentage, already including any automation. */
  readonly practicePercent: number;
};

/**
 * The clicks, in order, ending immediately before the loop's first tick.
 *
 * Empty when the count-in is off — an empty list rather than a null, so a
 * caller scheduling clicks does not need a branch for "no clicks".
 */
export function countInClicks(input: CountInInput): readonly CountInClick[] {
  if (input.bars === 0) return [];
  const beats = feltBeatsIn(input.firstBar);
  const perBeatTicks = feltBeatTicks(input.firstBar);
  const bpm = effectiveBpm(input.bpm, input.practicePercent);
  // Ticks to seconds through the one definition of a quarter note.
  const secondsPerTick = 60 / (bpm * PPQ);
  const total = beats * input.bars;

  const clicks: CountInClick[] = [];
  for (let index = 0; index < total; index += 1) {
    const remaining = total - index;
    clicks.push({
      beforeSeconds: remaining * perBeatTicks * secondsPerTick,
      downbeat: index % beats === 0,
      beat: (index % beats) + 1,
    });
  }
  return clicks;
}

/** How long the whole count-in lasts, for a caller that only needs the wait. */
export function countInSeconds(input: CountInInput): number {
  const clicks = countInClicks(input);
  return clicks[0]?.beforeSeconds ?? 0;
}

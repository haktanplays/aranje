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
 * last saw: from the **first bar of the range**. A 6/8 loop counts two, not
 * six, and a 7/8 loop felt `2+2+3` counts three — unevenly, because that is
 * how it is played: the third click waits a beat and a half.
 *
 * The beats come from `meterBeats` and are not restated here; a second copy
 * is a second answer waiting to disagree with the metronome (2V-D.2 §12).
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
import { meterBeats, type MeterBeat } from "@/lib/music/meter-beats";
import { PPQ, ticksPerBar, ticksPerSlot } from "@/lib/music/timing";
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

/** The beats of this bar, in order, from the feel it carries. */
export function beatsIn(bar: Bar): readonly MeterBeat[] {
  return meterBeats({
    meter: bar.timeSignature,
    resolution: bar.resolution,
    grouping: bar.grouping,
  });
}

/**
 * How many felt beats one bar of this meter has.
 *
 * From the beat list rather than from the numerator, which is wrong in
 * compound time — 6/8 has six eighths and two beats — and wrong again in an
 * asymmetric one, where 7/8 has seven eighths and three beats.
 */
export function feltBeatsIn(bar: Bar): number {
  return Math.max(1, beatsIn(bar).length);
}

/**
 * How long each beat of this bar lasts, in ticks, in order.
 *
 * A list, because an asymmetric metre's beats are not the same length: 7/8
 * felt `2+2+3` counts one, two, three with the third held half as long
 * again. Summing it gives the bar exactly.
 */
export function feltBeatTicks(bar: Bar): readonly number[] {
  const step = ticksPerSlot(bar.resolution);
  return beatsIn(bar).map((beat) => beat.slots * step);
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
  const bar = input.firstBar;
  const beats = beatsIn(bar);
  if (beats.length === 0) return [];
  const step = ticksPerSlot(bar.resolution);
  const barTicks = ticksPerBar(bar.timeSignature, bar.resolution);
  const bpm = effectiveBpm(input.bpm, input.practicePercent);
  // Ticks to seconds through the one definition of a quarter note.
  const secondsPerTick = 60 / (bpm * PPQ);
  const totalTicks = barTicks * input.bars;

  /*
   * Each click is placed by its own tick offset rather than by multiplying a
   * beat length, because the beats of an asymmetric metre differ. The last
   * click still lands exactly one beat before the loop's first tick, and the
   * first is exactly `bars` bars before it.
   */
  const clicks: CountInClick[] = [];
  for (let barIndex = 0; barIndex < input.bars; barIndex += 1) {
    beats.forEach((beat, index) => {
      const offset = barIndex * barTicks + beat.slot * step;
      clicks.push({
        beforeSeconds: (totalTicks - offset) * secondsPerTick,
        downbeat: beat.strength === "downbeat",
        beat: index + 1,
      });
    });
  }
  return clicks;
}

/** How long the whole count-in lasts, for a caller that only needs the wait. */
export function countInSeconds(input: CountInInput): number {
  const clicks = countInClicks(input);
  return clicks[0]?.beforeSeconds ?? 0;
}

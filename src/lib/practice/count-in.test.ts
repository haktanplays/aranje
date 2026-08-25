/**
 * What the count-in counts (2R-A §11, §17).
 *
 * The claims are that it counts the *loop's own* meter, at the speed the
 * reader is actually practising at, and that it exists nowhere but the
 * transport's schedule.
 */
import { describe, expect, it } from "vitest";

import {
  countInClicks,
  countInLabel,
  countInSeconds,
  COUNT_IN_CHOICES,
  DEFAULT_COUNT_IN,
  feltBeatTicks,
  feltBeatsIn,
  isCountInBars,
} from "@/lib/practice/count-in";
import { PPQ } from "@/lib/music/timing";
import { melodicBar, restSlots } from "@/lib/song/fixtures";
import type { Bar, Resolution, TimeSignature } from "@/lib/song/schema";

const bar = (meter: TimeSignature, resolution: Resolution): Bar =>
  melodicBar("gtr", restSlots((resolution / meter[1]) * meter[0]), {
    timeSignature: meter,
    resolution,
  });

const FOUR_FOUR = bar([4, 4], 8);
const THREE_FOUR = bar([3, 4], 16);
const SIX_EIGHT = bar([6, 8], 8);
const SEVEN_EIGHT = bar([7, 8], 8);

describe("251. the count-in is off, one bar or two", () => {
  it("offers exactly three choices and starts off", () => {
    expect(COUNT_IN_CHOICES).toEqual([0, 1, 2]);
    expect(DEFAULT_COUNT_IN).toBe(0);
  });

  it("names them in Turkish, about music rather than settings", () => {
    expect(countInLabel(0)).toBe("Kapalı");
    expect(countInLabel(1)).toBe("1 ölçü");
    expect(countInLabel(2)).toBe("2 ölçü");
  });

  it("recognises only those three as a count-in", () => {
    expect(isCountInBars(0)).toBe(true);
    expect(isCountInBars(2)).toBe(true);
    expect(isCountInBars(3)).toBe(false);
    expect(isCountInBars(1.5)).toBe(false);
    expect(isCountInBars(-1)).toBe(false);
  });

  it("produces no clicks at all when it is off", () => {
    const clicks = countInClicks({
      bars: 0,
      firstBar: FOUR_FOUR,
      bpm: 120,
      practicePercent: 100,
    });
    expect(clicks).toEqual([]);
    expect(countInSeconds({ bars: 0, firstBar: FOUR_FOUR, bpm: 120, practicePercent: 100 })).toBe(0);
  });
});

describe("252. it counts the loop's own meter", () => {
  it("counts four in 4/4", () => {
    expect(feltBeatsIn(FOUR_FOUR)).toBe(4);
  });

  it("counts three in 3/4, on a finer grid", () => {
    expect(feltBeatsIn(THREE_FOUR)).toBe(3);
  });

  it("counts two in 6/8, not six", () => {
    /*
     * Compound time is felt in dotted beats. A count-in that said "six" in
     * 6/8 would be counting the notation rather than the pulse, and a reader
     * coming in on it would arrive three times too often.
     */
    expect(feltBeatsIn(SIX_EIGHT)).toBe(2);
  });

  it("counts 7/8 the way the metronome clicks it", () => {
    const beats = feltBeatsIn(SEVEN_EIGHT);
    expect(beats).toBe(7);
    // And the whole bar still adds up to seven eighths.
    expect(beats * feltBeatTicks(SEVEN_EIGHT)).toBe(7 * (PPQ / 2));
  });

  it("gives one bar of 4/4 four clicks and two bars eight", () => {
    const one = countInClicks({ bars: 1, firstBar: FOUR_FOUR, bpm: 120, practicePercent: 100 });
    const two = countInClicks({ bars: 2, firstBar: FOUR_FOUR, bpm: 120, practicePercent: 100 });
    expect(one).toHaveLength(4);
    expect(two).toHaveLength(8);
  });

  it("gives two bars of 6/8 four clicks, not twelve", () => {
    const clicks = countInClicks({ bars: 2, firstBar: SIX_EIGHT, bpm: 120, practicePercent: 100 });
    expect(clicks).toHaveLength(4);
  });

  it("marks the first click of each counted bar as the downbeat", () => {
    const clicks = countInClicks({ bars: 2, firstBar: FOUR_FOUR, bpm: 120, practicePercent: 100 });
    expect(clicks.map((click) => click.downbeat)).toEqual([
      true, false, false, false,
      true, false, false, false,
    ]);
    expect(clicks.map((click) => click.beat)).toEqual([1, 2, 3, 4, 1, 2, 3, 4]);
  });
});

describe("253. it counts at the speed the reader is practising at", () => {
  it("puts every click before the loop's first tick", () => {
    const clicks = countInClicks({ bars: 2, firstBar: FOUR_FOUR, bpm: 120, practicePercent: 100 });
    expect(clicks.every((click) => click.beforeSeconds > 0)).toBe(true);
    // In order, and the last one is one beat out.
    for (let index = 1; index < clicks.length; index += 1) {
      expect(clicks[index]!.beforeSeconds).toBeLessThan(clicks[index - 1]!.beforeSeconds);
    }
    expect(clicks[clicks.length - 1]!.beforeSeconds).toBeCloseTo(0.5, 6);
  });

  it("lasts one bar of real time at the written tempo", () => {
    // 4/4 at 120 BPM is two seconds.
    expect(
      countInSeconds({ bars: 1, firstBar: FOUR_FOUR, bpm: 120, practicePercent: 100 }),
    ).toBeCloseTo(2, 6);
  });

  it("slows down with the practice rate rather than staying at the written tempo", () => {
    const written = countInSeconds({
      bars: 1, firstBar: FOUR_FOUR, bpm: 120, practicePercent: 100,
    });
    const slow = countInSeconds({
      bars: 1, firstBar: FOUR_FOUR, bpm: 120, practicePercent: 50,
    });
    /*
     * Half speed is twice the wait. A count-in that stayed at the written
     * tempo would teach the wrong pulse in the last second before playing —
     * which is the second the reader is relying on it for.
     */
    expect(slow).toBeCloseTo(written * 2, 6);
  });

  it("speeds up with it too, at the ceiling the rate allows", () => {
    const fast = countInSeconds({
      bars: 1, firstBar: FOUR_FOUR, bpm: 120, practicePercent: 150,
    });
    expect(fast).toBeCloseTo(2 / 1.5, 6);
  });

  it("uses the section's tempo, not the song's", () => {
    const atSectionTempo = countInSeconds({
      bars: 1, firstBar: FOUR_FOUR, bpm: 180, practicePercent: 100,
    });
    expect(atSectionTempo).toBeCloseTo((60 / 180) * 4, 6);
  });
});

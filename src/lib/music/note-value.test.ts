import { describe, expect, it } from "vitest";

import {
  BASE_TICKS,
  BEAMS,
  NOTE_VALUES,
  hasStem,
  noteValueOf,
  splitIntoValues,
  valueLabel,
} from "@/lib/music/note-value";
import { TICKS_PER_WHOLE, ticksPerSlot } from "@/lib/music/timing";

describe("the written rhythm vocabulary", () => {
  /*
   * The property the whole phase stands on: every value the app can write is
   * a whole number of ticks. A single non-integer here would put a rounding
   * step into playback, and a rounding step is drift.
   */
  it("is exact — every value is a whole number of ticks", () => {
    expect(NOTE_VALUES.length).toBeGreaterThan(0);
    for (const value of NOTE_VALUES) {
      expect(Number.isInteger(value.ticks), `${value.base}/${value.modifier}`).toBe(true);
      expect(value.ticks).toBeGreaterThan(0);
    }
  });

  it("carries every value §4 asks for, with the arithmetic spelled out", () => {
    const find = (base: string, modifier: string) =>
      NOTE_VALUES.find((v) => v.base === base && v.modifier === modifier)?.ticks;
    expect(find("whole", "plain")).toBe(768);
    expect(find("half", "plain")).toBe(384);
    expect(find("quarter", "plain")).toBe(192);
    expect(find("eighth", "plain")).toBe(96);
    expect(find("16th", "plain")).toBe(48);
    expect(find("32nd", "plain")).toBe(24);
    expect(find("quarter", "dotted")).toBe(288);
    expect(find("eighth", "dotted")).toBe(144);
    expect(find("16th", "dotted")).toBe(72);
    expect(find("eighth", "triplet")).toBe(64);
    expect(find("16th", "triplet")).toBe(32);
  });

  /* The grids and the vocabulary have to agree, or a slot is unnameable. */
  it("names the slot of every grid the app offers", () => {
    for (const [resolution, expected] of [
      [4, "quarter"],
      [8, "eighth"],
      [12, "eighth"],
      [16, "16th"],
      [24, "16th"],
      [32, "32nd"],
    ] as const) {
      const value = noteValueOf(ticksPerSlot(resolution));
      expect(value?.base, `1/${resolution}`).toBe(expected);
      expect(value?.modifier).toBe(resolution === 12 || resolution === 24 ? "triplet" : "plain");
    }
  });

  it("draws beams from the base, not from the dot or the bracket", () => {
    expect(BEAMS.quarter).toBe(0);
    expect(BEAMS.eighth).toBe(1);
    expect(BEAMS["16th"]).toBe(2);
    expect(BEAMS["32nd"]).toBe(3);
    expect(noteValueOf(144)).toMatchObject({ base: "eighth", modifier: "dotted" });
    expect(BEAMS[noteValueOf(144)!.base]).toBe(1);
    expect(BEAMS[noteValueOf(32)!.base]).toBe(2);
  });

  it("knows a whole note has nothing to hang a beam from", () => {
    expect(hasStem("whole")).toBe(false);
    expect(hasStem("half")).toBe(true);
  });

  /*
   * Refusing to name a duration is the honest answer. Five sixteenths is not
   * a note; it is two notes tied, and saying otherwise would draw a stem that
   * claims a value the music does not have.
   */
  it("refuses to name a duration that is not one written value", () => {
    expect(noteValueOf(48 * 5)).toBeNull();
    expect(noteValueOf(0)).toBeNull();
    expect(noteValueOf(-48)).toBeNull();
    expect(noteValueOf(48.5)).toBeNull();
  });

  it("splits a tied duration the way a copyist would", () => {
    expect(splitIntoValues(48 * 5).map((v) => v.ticks)).toEqual([192, 48]);
    expect(splitIntoValues(192).map((v) => v.ticks)).toEqual([192]);
    expect(splitIntoValues(288).map((v) => v.ticks)).toEqual([288]);
  });

  it("splits a whole bar of 4/4 into one whole note", () => {
    expect(splitIntoValues(TICKS_PER_WHOLE).map((v) => v.ticks)).toEqual([768]);
  });

  it("gives every split back exactly, with nothing lost or invented", () => {
    for (let ticks = 24; ticks <= 768; ticks += 24) {
      const parts = splitIntoValues(ticks);
      expect(parts.length, `${ticks}`).toBeGreaterThan(0);
      expect(parts.reduce((sum, v) => sum + v.ticks, 0), `${ticks}`).toBe(ticks);
    }
  });

  it("names a value for a reader", () => {
    expect(valueLabel(noteValueOf(144)!)).toBe("noktalı sekizlik");
    expect(valueLabel(noteValueOf(32)!)).toBe("on altılık triole");
    expect(valueLabel(noteValueOf(BASE_TICKS.quarter)!)).toBe("dörtlük");
  });
});

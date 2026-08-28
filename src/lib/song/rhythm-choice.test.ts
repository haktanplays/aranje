import { describe, expect, it } from "vitest";

import {
  defaultRhythmTicks,
  gridCanWrite,
  rhythmChoices,
} from "@/lib/song/rhythm-choice";
import { NOTE_VALUES } from "@/lib/music/note-value";
import { guitarTrack, melodicBar, section, song } from "@/lib/song/fixtures";
import type { MelodicSlot, Resolution, Song } from "@/lib/song/schema";

const TRACK = "gtr";

function fixture(resolution: Resolution = 16, slotCount = 16): Song {
  const slots: MelodicSlot[] = Array.from({ length: slotCount }, () => null);
  return song(
    [guitarTrack()],
    [section([melodicBar(TRACK, slots, { resolution })])],
  );
}

const target = (slotIndex = 0) => ({
  sectionId: "s1",
  barIndex: 0,
  trackId: TRACK,
  slotIndex,
});

const labels = (subject: Song, slotIndex = 0) =>
  rhythmChoices(subject, target(slotIndex)).map((choice) => choice.label);

describe("gridCanWrite", () => {
  const value = (base: string, modifier: string) =>
    NOTE_VALUES.find((entry) => entry.base === base && entry.modifier === modifier)!;

  it("writes straight values on a straight grid", () => {
    expect(gridCanWrite(value("quarter", "plain"), 16)).toBe(true);
    expect(gridCanWrite(value("eighth", "dotted"), 16)).toBe(true);
  });

  /* A sixteenth triplet is 32 ticks and a sixteenth slot is 48. Nothing on a
     straight grid can start where one ends. */
  it("keeps triplet values off a straight grid", () => {
    expect(gridCanWrite(value("eighth", "triplet"), 16)).toBe(false);
    expect(gridCanWrite(value("16th", "triplet"), 32)).toBe(false);
  });

  it("offers triplet values on a triplet grid", () => {
    expect(gridCanWrite(value("eighth", "triplet"), 12)).toBe(true);
    expect(gridCanWrite(value("16th", "triplet"), 24)).toBe(true);
  });

  it("keeps a dotted value off a triplet grid, which cannot place it", () => {
    expect(gridCanWrite(value("eighth", "dotted"), 12)).toBe(false);
  });

  it("lets a note be shorter than one grid step", () => {
    expect(gridCanWrite(value("32nd", "plain"), 16)).toBe(true);
  });
});

describe("rhythmChoices", () => {
  it("offers every value §4 names, on a sixteenth grid", () => {
    const offered = labels(fixture(16));
    for (const wanted of [
      "birlik",
      "ikilik",
      "dörtlük",
      "sekizlik",
      "on altılık",
      "otuz ikilik",
      "noktalı dörtlük",
      "noktalı sekizlik",
    ]) {
      expect(offered).toContain(wanted);
    }
  });

  it("offers the two triples on a triplet grid", () => {
    const offered = labels(fixture(12, 12));
    expect(offered).toContain("sekizlik triole");
    expect(offered).toContain("on altılık triole");
  });

  it("offers them longest first", () => {
    const ticks = rhythmChoices(fixture(), target()).map((choice) => choice.ticks);
    expect([...ticks].sort((a, b) => b - a)).toEqual(ticks);
  });

  /*
   * Greyed rather than hidden: a reader who wanted a whole note should see
   * that the bar is the reason they cannot have one here.
   */
  it("keeps a value that will not fit, and says it does not", () => {
    const near = rhythmChoices(fixture(), target(12));
    const whole = near.find((choice) => choice.label === "birlik");
    expect(whole).toBeDefined();
    expect(whole?.fits).toBe(false);
    expect(near.find((choice) => choice.label === "on altılık")?.fits).toBe(true);
  });

  /*
   * A dotted whole is 1152 ticks and a 4/4 bar is 768. It is not "greyed
   * because you are late in the bar"; it cannot be written in this meter at
   * all, and putting it at the top of the list every time teaches nothing.
   */
  it("leaves out a value longer than the bar it would go in", () => {
    expect(labels(fixture(16))).not.toContain("noktalı birlik");
    expect(labels(fixture(16))).toContain("birlik");
  });

  it("says nothing at all about a bar that is not there", () => {
    expect(rhythmChoices(fixture(), { ...target(), barIndex: 9 })).toEqual([]);
  });

  it("never shows the reader a tick count", () => {
    for (const choice of rhythmChoices(fixture(), target())) {
      expect(choice.label).not.toMatch(/\d/);
    }
  });
});

describe("defaultRhythmTicks", () => {
  it("is one step of whatever the grid is counting in", () => {
    expect(defaultRhythmTicks(fixture(16), target())).toBe(48);
    expect(defaultRhythmTicks(fixture(8, 8), target())).toBe(96);
    expect(defaultRhythmTicks(fixture(32, 32), target())).toBe(24);
  });

  it("is nothing where there is no bar", () => {
    expect(defaultRhythmTicks(fixture(), { ...target(), barIndex: 9 })).toBe(0);
  });
});

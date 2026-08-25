/**
 * The practice range's promises (2R-A §8, §10, §17).
 *
 * Two claims run through all of it. A range is **whole bars in one section**,
 * named by key rather than by index so the music it points at survives an
 * edit somewhere else. And its end is **exclusive**, so a loop plays the last
 * bar and not one tick of the next one.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  barKeyOf,
  barKeyParts,
  loopBounds,
  NO_LOOP,
  planOf,
  practiceRange,
  rangeBarCount,
  rangeBarKeys,
  rangeIsLive,
  rangeLoopBounds,
  sectionBounds,
  singleBarRange,
  type PracticeRange,
} from "@/lib/practice/range";
import { melodicBar, guitarTrack, restSlots, section, song } from "@/lib/song/fixtures";
import { PPQ } from "@/lib/music/timing";
import { songLimits } from "@/lib/limits";
import type { Bar, Resolution, Song, TimeSignature } from "@/lib/song/schema";

const bar = (meter: TimeSignature = [4, 4], resolution: Resolution = 8): Bar =>
  melodicBar("gtr", restSlots((resolution / meter[1]) * meter[0]), {
    timeSignature: meter,
    resolution,
  });

/** Two sections: four 4/4 bars, then three in 3/4 at a different grid. */
const twoSections = (): Song =>
  song(
    [guitarTrack()],
    [
      section([bar(), bar(), bar(), bar()], { id: "one", name: "Bir" }),
      section([bar([3, 4], 16), bar([3, 4], 16), bar([3, 4], 16)], {
        id: "two",
        name: "İki",
      }),
    ],
  );

const rangeOf = (source: Song, a: string, b: string): PracticeRange => {
  const result = practiceRange(source, a, b);
  if (!result.ok) throw new Error(`expected a range, got ${result.reason}`);
  return result.range;
};

describe("247. a practice range is whole bars inside one section", () => {
  it("takes two bar keys and holds the run between them", () => {
    const range = rangeOf(twoSections(), "one:1", "one:2");
    expect(range).toEqual({
      sectionId: "one",
      startBarKey: "one:1",
      endBarKey: "one:2",
    });
    expect(rangeBarKeys(range)).toEqual(["one:1", "one:2"]);
    expect(rangeBarCount(range)).toBe(2);
  });

  it("sorts a backwards drag rather than refusing it", () => {
    const forward = rangeOf(twoSections(), "one:0", "one:3");
    const backward = rangeOf(twoSections(), "one:3", "one:0");
    expect(backward).toEqual(forward);
  });

  it("refuses a pair that spans two sections", () => {
    const result = practiceRange(twoSections(), "one:3", "two:0");
    expect(result).toEqual({ ok: false, reason: "different_sections" });
  });

  it("refuses a bar the section does not have", () => {
    const result = practiceRange(twoSections(), "one:0", "one:9");
    expect(result).toEqual({ ok: false, reason: "unknown_bar" });
  });

  it("refuses a section the song does not have", () => {
    const result = practiceRange(twoSections(), "gone:0", "gone:1");
    expect(result).toEqual({ ok: false, reason: "unknown_bar" });
  });

  it("refuses a key that is not a key", () => {
    expect(practiceRange(twoSections(), "one", "one:1").ok).toBe(false);
    expect(practiceRange(twoSections(), "one:-1", "one:1").ok).toBe(false);
    expect(practiceRange(twoSections(), "one:x", "one:1").ok).toBe(false);
  });

  it("makes one bar a range of one, which is the commonest of all", () => {
    const range = rangeOf(twoSections(), "two:1", "two:1");
    const single = singleBarRange(twoSections(), "two:1");
    expect(single.ok && single.range).toEqual(range);
    expect(rangeBarCount(range)).toBe(1);
  });
});

describe("248. a bar key is the identity, and it can go stale", () => {
  it("splits a key into its section and its index", () => {
    expect(barKeyParts("intro:3")).toEqual({ sectionId: "intro", localBarIndex: 3 });
    expect(barKeyOf("intro", 3)).toBe("intro:3");
  });

  it("keeps a section id that contains a colon", () => {
    expect(barKeyParts("a:b:2")).toEqual({ sectionId: "a:b", localBarIndex: 2 });
  });

  it("calls a range live while the song still holds its bars", () => {
    const source = twoSections();
    expect(rangeIsLive(source, rangeOf(source, "one:1", "one:3"))).toBe(true);
  });

  it("calls it dead once the section is shorter than the range", () => {
    const source = twoSections();
    const range = rangeOf(source, "one:2", "one:3");
    const shortened = song(source.tracks, [
      section([bar(), bar()], { id: "one", name: "Bir" }),
      source.sections[1]!,
    ]);
    expect(rangeIsLive(shortened, range)).toBe(false);
  });

  it("calls it dead once the section is gone entirely", () => {
    const source = twoSections();
    const range = rangeOf(source, "one:0", "one:1");
    const without = song(source.tracks, [source.sections[1]!]);
    expect(rangeIsLive(without, range)).toBe(false);
  });
});

describe("249. the loop's end is exclusive", () => {
  it("stops at the first tick after the last bar, not inside the next", () => {
    const source = twoSections();
    const plan = planOf(source);
    const bounds = rangeLoopBounds(plan, rangeOf(source, "one:1", "one:2"));
    // 4/4 at 1/8 is eight slots of a quarter each: 4 * PPQ per bar.
    expect(bounds).toEqual({ startTicks: 4 * PPQ, endTicks: 12 * PPQ });
  });

  it("gives a one-bar range exactly one bar of ticks", () => {
    const source = twoSections();
    const bounds = rangeLoopBounds(planOf(source), rangeOf(source, "one:0", "one:0"));
    expect(bounds).toEqual({ startTicks: 0, endTicks: 4 * PPQ });
  });

  it("measures a 3/4 range in 3/4, not in the song's other meter", () => {
    const source = twoSections();
    const bounds = rangeLoopBounds(planOf(source), rangeOf(source, "two:0", "two:2"));
    expect(bounds).not.toBeNull();
    expect(bounds!.endTicks - bounds!.startTicks).toBe(3 * (3 * PPQ));
  });

  it("returns nothing at all when a bar of the range has gone", () => {
    const source = twoSections();
    const range = rangeOf(source, "one:2", "one:3");
    const shortened = song(source.tracks, [
      section([bar(), bar()], { id: "one", name: "Bir" }),
    ]);
    expect(rangeLoopBounds(planOf(shortened), range)).toBeNull();
  });
});

describe("250. one conversion turns a typed loop into ticks", () => {
  it("gives no bounds for no loop", () => {
    expect(loopBounds(planOf(twoSections()), NO_LOOP)).toBeNull();
  });

  it("gives a section loop the section's own extent", () => {
    const source = twoSections();
    const plan = planOf(source);
    expect(loopBounds(plan, { kind: "section", sectionId: "two" })).toEqual(
      sectionBounds(plan, "two"),
    );
    expect(sectionBounds(plan, "two")).toEqual({
      startTicks: 16 * PPQ,
      endTicks: 16 * PPQ + 9 * PPQ,
    });
  });

  it("gives a practice-range loop the range's extent", () => {
    const source = twoSections();
    const plan = planOf(source);
    const range = rangeOf(source, "one:1", "one:2");
    expect(loopBounds(plan, { kind: "practice_range", range })).toEqual(
      rangeLoopBounds(plan, range),
    );
  });

  it("never falls back to the section when the range is stale", () => {
    const source = twoSections();
    const range = rangeOf(source, "one:2", "one:3");
    const shortened = song(source.tracks, [
      section([bar(), bar()], { id: "one", name: "Bir" }),
    ]);
    /*
     * The point of the whole typed split: a dead range must stop the loop, not
     * quietly become "loop the section it used to be in". A reader who set two
     * bars and got eight would be practising music they did not choose.
     */
    expect(loopBounds(planOf(shortened), { kind: "practice_range", range })).toBeNull();
    expect(sectionBounds(planOf(shortened), "one")).not.toBeNull();
  });

  it("gives nothing for a section that is not in the song", () => {
    expect(
      loopBounds(planOf(twoSections()), { kind: "section", sectionId: "nope" }),
    ).toBeNull();
  });
});

describe("290. the range's own bounds are the contract's, not a multiple of them", () => {
  it("refuses a run longer than a section may hold, at exactly that number", () => {
    /*
     * The Song Contract will not accept a section with more bars than this,
     * so the check inside `practiceRange` can only fire on a song that got
     * past the schema. It is still the bound the transport loops over, and a
     * bound stated as "four times the limit" would be a bound in name only —
     * so the number is asserted rather than the behaviour.
     */
    const source = readFileSync("src/lib/practice/range.ts", "utf8");
    expect(source).toContain("> songLimits.barsPerSection");
    expect(source).not.toMatch(/songLimits\.barsPerSection\s*[*+]/);
    expect(songLimits.barsPerSection).toBe(8);
  });

  it("refuses to loop a range whose last bar has gone", () => {
    /*
     * Half a range is not a smaller range. If the end bar is deleted while
     * the loop is set, the honest answer is "do not loop" — falling back to
     * the end of the section, or of the song, would be the transport playing
     * music the reader never chose.
     */
    const two = song(
      [guitarTrack()],
      [section([bar(), bar(), bar()], { id: "s1" })],
    );
    const made = practiceRange(two, "s1:0", "s1:2");
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const shorter = song([guitarTrack()], [section([bar()], { id: "s1" })]);
    expect(rangeLoopBounds(planOf(shorter), made.range)).toBeNull();
  });

  it("accepts a run exactly as long as a section may hold", () => {
    const full = song(
      [guitarTrack()],
      [section(Array.from({ length: 8 }, () => bar()), { id: "s1" })],
    );
    const made = practiceRange(full, "s1:0", "s1:7");
    expect(made.ok).toBe(true);
    if (made.ok) expect(rangeBarCount(made.range)).toBe(8);
  });
});


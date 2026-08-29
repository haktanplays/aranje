/**
 * One description of a selection, whichever gesture made it (2U-A §2).
 *
 * The claim being tested is not that the numbers are right — the cores those
 * come from have their own tests. It is that a *command* can ask one question
 * and get one answer: what kind of thing is this, where is it, what does it
 * cover, and is it whole bars.
 */
import { describe, expect, it } from "vitest";

import {
  barCount,
  describeBarSelection,
  describeTimeSelection,
  eventId,
} from "@/lib/song/selection-descriptor";
import { guitarTrack, melodicBar, section, song } from "@/lib/song/fixtures";
import type { MelodicSlot, Song } from "@/lib/song/schema";

const TRACK = "gtr";
/*
 * A second instrument, because "covers every track" is unfalsifiable on a
 * one-track song: taking the first track and taking all of them give the
 * same answer, and a mutation that swapped one for the other stayed green.
 */
const OTHER = "bass";
/** One 4/4 bar on a 1/16 grid: sixteen slots of 48 ticks, 768 to the bar. */
const BAR = 768;

const note = (pitch: string, string: number, fret: number): MelodicSlot => ({
  notes: [{ pitch, position: { string, fret } }],
});

const chord = (): MelodicSlot => ({
  notes: [
    { pitch: "E2", position: { string: 0, fret: 0 } },
    { pitch: "B2", position: { string: 1, fret: 2 } },
    { pitch: "E3", position: { string: 2, fret: 2 } },
  ],
});

/** Two bars: a chord, two single notes, and a note in the second bar. */
function fixture(): Song {
  const first: MelodicSlot[] = Array.from({ length: 16 }, () => null);
  first[0] = chord();
  first[4] = note("G3", 3, 0);
  first[8] = note("A3", 3, 2);

  const second: MelodicSlot[] = Array.from({ length: 16 }, () => null);
  second[0] = note("B3", 4, 0);

  const bass: MelodicSlot[] = Array.from({ length: 16 }, () => null);
  bass[0] = note("E1", 0, 0);

  const withBass = (bar: ReturnType<typeof melodicBar>) => ({
    ...bar,
    slots: { ...bar.slots, [OTHER]: [...bass] },
  });

  return song(
    [guitarTrack({ id: TRACK }), guitarTrack({ id: OTHER })],
    [
      section([
        withBass(melodicBar(TRACK, first, { resolution: 16 })),
        withBass(melodicBar(TRACK, second, { resolution: 16 })),
      ]),
    ],
  );
}

const range = (startTicks: number, endTicks: number) => ({
  sectionId: "s1",
  trackId: TRACK,
  startTicks,
  endTicks,
});

describe("a span of time, described", () => {
  const subject = fixture();

  it("calls one note on one string a note", () => {
    const found = describeTimeSelection(subject, range(192, 240));
    expect(found?.scope).toBe("note");
    expect(found?.eventIds).toHaveLength(1);
    expect(found?.stringIndexes).toEqual([3]);
    expect(found?.onsetCount).toBe(1);
  });

  it("calls one onset with three notes a chord", () => {
    const found = describeTimeSelection(subject, range(0, 48));
    expect(found?.scope).toBe("chord");
    expect(found?.eventIds).toHaveLength(3);
    expect(found?.stringIndexes).toEqual([0, 1, 2]);
    expect(found?.onsetCount).toBe(1);
  });

  it("calls two onsets a range, however narrow the gesture was", () => {
    const found = describeTimeSelection(subject, range(192, 432));
    expect(found?.scope).toBe("range");
    expect(found?.onsetCount).toBe(2);
  });

  /* A range with nothing in it is still a range: it is where a paste goes. */
  it("calls an empty span a range and says it holds nothing", () => {
    const found = describeTimeSelection(subject, range(624, 720));
    expect(found?.scope).toBe("range");
    expect(found?.eventIds).toEqual([]);
    expect(found?.onsetCount).toBe(0);
  });

  it("acts on exactly the one track the span belongs to", () => {
    expect(describeTimeSelection(subject, range(0, BAR))?.trackIds).toEqual([TRACK]);
    /* The bass is playing in this bar and is deliberately not in the answer. */
    expect(describeTimeSelection(subject, range(0, BAR))?.trackIds).not.toContain(
      OTHER,
    );
  });

  it("knows when its edges sit on bar lines and when they do not", () => {
    expect(describeTimeSelection(subject, range(0, BAR))?.wholeBars).toBe(true);
    expect(describeTimeSelection(subject, range(0, BAR * 2))?.wholeBars).toBe(true);
    expect(describeTimeSelection(subject, range(48, BAR))?.wholeBars).toBe(false);
    expect(describeTimeSelection(subject, range(0, BAR - 48))?.wholeBars).toBe(false);
  });

  it("names the bars it touches, whole or partial", () => {
    expect(describeTimeSelection(subject, range(0, 48))?.barRange).toEqual({
      startBarIndex: 0,
      endBarIndex: 0,
    });
    expect(describeTimeSelection(subject, range(720, BAR + 48))?.barRange).toEqual({
      startBarIndex: 0,
      endBarIndex: 1,
    });
  });

  it("says nothing about a section that is not there", () => {
    expect(
      describeTimeSelection(subject, { ...range(0, 48), sectionId: "yok" }),
    ).toBeNull();
  });
});

describe("a run of bars, described", () => {
  const subject = fixture();

  it("covers every track when the scope is the whole bar", () => {
    const found = describeBarSelection(subject, {
      scope: "full",
      sectionId: "s1",
      startBarIndex: 0,
      endBarIndex: 0,
    });
    expect(found?.scope).toBe("measures");
    /* Every track in the bar, which is what `full` means. */
    expect(found?.trackIds).toEqual([TRACK, OTHER]);
    expect(found?.wholeBars).toBe(true);
    expect(found?.startTicks).toBe(0);
    expect(found?.endTicks).toBe(BAR);
  });

  it("covers one track when the scope is one track's bars", () => {
    const found = describeBarSelection(subject, {
      scope: "track",
      sectionId: "s1",
      trackId: TRACK,
      startBarIndex: 1,
      endBarIndex: 1,
    });
    expect(found?.trackIds).toEqual([TRACK]);
    expect(found?.startTicks).toBe(BAR);
    expect(found?.endTicks).toBe(BAR * 2);
  });

  it("counts two adjacent bars as two", () => {
    const found = describeBarSelection(subject, {
      scope: "full",
      sectionId: "s1",
      startBarIndex: 0,
      endBarIndex: 1,
    });
    expect(barCount(found!)).toBe(2);
    /* Four guitar onsets and the bass note in each of the two bars. */
    expect(found?.onsetCount).toBe(6);
  });

  it("says nothing about a bar that is not there", () => {
    expect(
      describeBarSelection(subject, {
        scope: "full",
        sectionId: "s1",
        startBarIndex: 0,
        endBarIndex: 9,
      }),
    ).toBeNull();
  });
});

describe("event identity", () => {
  it("is the note's address, and two notes never share one", () => {
    const subject = fixture();
    const found = describeTimeSelection(subject, range(0, 48));
    expect(new Set(found?.eventIds).size).toBe(found?.eventIds.length);
    expect(found?.eventIds).toContain(
      eventId({
        sectionId: "s1",
        barIndex: 0,
        slotIndex: 0,
        trackId: TRACK,
        stringIndex: 1,
      }),
    );
  });

  /*
   * The contract has no note ids, so identity is position — which means
   * moving music changes it. That is the honest answer, and it is why a
   * clipboard cannot carry an id and a paste cannot reuse one.
   */
  it("changes when the same note is written somewhere else", () => {
    const subject = fixture();
    const here = describeTimeSelection(subject, range(192, 240))?.eventIds ?? [];
    const there = describeTimeSelection(subject, range(384, 432))?.eventIds ?? [];
    expect(here).not.toEqual(there);
    expect(here).toHaveLength(1);
    expect(there).toHaveLength(1);
  });
});

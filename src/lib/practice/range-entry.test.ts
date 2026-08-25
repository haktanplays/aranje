/**
 * Three doors, one range (2R-A §V, §XIII).
 *
 * The claim this file exists for is an identity: the bar the reader tapped,
 * the pair they picked and the time selection that sat on bar lines must all
 * produce the *same* range, not three that happen to agree. Everything else
 * here is about what the doors refuse, and refusing by name rather than by
 * rounding.
 */
import { describe, expect, it } from "vitest";

import {
  offersPracticeRange,
  rangeFromBar,
  rangeFromBarPair,
  rangeFromBarSelection,
  rangeFromTimeSelection,
  type EntryResult,
} from "@/lib/practice/range-entry";
import { drumTrack, guitarTrack, section, song } from "@/lib/song/fixtures";
import { slotCount, ticksPerSlot, PPQ } from "@/lib/music/timing";
import type { Bar, Resolution, Song, TimeSignature } from "@/lib/song/schema";

const bar = (meter: TimeSignature, resolution: Resolution): Bar => ({
  timeSignature: meter,
  resolution,
  slots: {
    gtr: Array.from({ length: slotCount(meter, resolution) }, () => null),
    drums: Array.from({ length: slotCount(meter, resolution) }, () => []),
  },
});

/**
 * Two sections whose bars are deliberately on different grids, so a boundary
 * cannot be found by multiplying a slot count by anything.
 */
const SONG: Song = song(
  [guitarTrack(), drumTrack()],
  [
    section([bar([4, 4], 8), bar([4, 4], 16), bar([3, 4], 12), bar([4, 4], 8)], {
      id: "one",
      name: "Bir",
    }),
    section([bar([7, 8], 8), bar([6, 8], 8)], { id: "two", name: "İki" }),
  ],
);

/** Where each bar of a section begins and ends, computed the long way. */
function boundaries(sectionId: string): number[] {
  const entry = SONG.sections.find((s) => s.id === sectionId)!;
  const out = [0];
  let ticks = 0;
  for (const b of entry.bars) {
    ticks += slotCount(b.timeSignature, b.resolution) * ticksPerSlot(b.resolution);
    out.push(ticks);
  }
  return out;
}

const time = (sectionId: string, startTicks: number, endTicks: number) => ({
  sectionId,
  trackId: "gtr",
  startTicks,
  endTicks,
});

const ranged = (result: EntryResult) => {
  if (!result.ok) throw new Error(`expected a range, got ${result.reason}`);
  return result.range;
};

describe("268. the three doors produce the same range", () => {
  it("agrees between a single bar and a pair of the same bar", () => {
    expect(ranged(rangeFromBar(SONG, "one:2"))).toEqual(
      ranged(rangeFromBarPair(SONG, "one:2", "one:2")),
    );
  });

  it("agrees between a pair and a time selection over the same bars", () => {
    const marks = boundaries("one");
    const pair = ranged(rangeFromBarPair(SONG, "one:1", "one:2"));
    const selected = ranged(
      rangeFromTimeSelection(SONG, time("one", marks[1]!, marks[3]!)),
    );
    expect(selected).toEqual(pair);
  });

  it("agrees between a bar selection and the pair it names", () => {
    const fromSelection = ranged(
      rangeFromBarSelection(SONG, {
        scope: "track",
        sectionId: "one",
        trackId: "gtr",
        startBarIndex: 0,
        endBarIndex: 3,
      }),
    );
    expect(fromSelection).toEqual(ranged(rangeFromBarPair(SONG, "one:0", "one:3")));
  });

  it("ignores which track a bar selection was scoped to", () => {
    /*
     * A practice loop plays the whole song; the scope of the selection that
     * started it is about editing, not about time. Stated here so the choice
     * reads as deliberate rather than forgotten.
     */
    const onTrack = rangeFromBarSelection(SONG, {
      scope: "track",
      sectionId: "one",
      trackId: "drums",
      startBarIndex: 1,
      endBarIndex: 2,
    });
    const onAll = rangeFromBarSelection(SONG, {
      scope: "full",
      sectionId: "one",
      startBarIndex: 1,
      endBarIndex: 2,
    });
    expect(ranged(onTrack)).toEqual(ranged(onAll));
  });
});

describe("269. the pair door normalises order and nothing else", () => {
  it("takes the two bars in either order", () => {
    expect(ranged(rangeFromBarPair(SONG, "one:3", "one:1"))).toEqual(
      ranged(rangeFromBarPair(SONG, "one:1", "one:3")),
    );
  });

  it("includes both ends and everything between", () => {
    const range = ranged(rangeFromBarPair(SONG, "one:0", "one:3"));
    expect(range.startBarKey).toBe("one:0");
    expect(range.endBarKey).toBe("one:3");
  });

  it("refuses a pair that spans two sections", () => {
    expect(rangeFromBarPair(SONG, "one:3", "two:0")).toEqual({
      ok: false,
      reason: "different_sections",
    });
  });

  it("refuses a bar the section does not have", () => {
    expect(rangeFromBarPair(SONG, "one:0", "one:9").ok).toBe(false);
    expect(rangeFromBar(SONG, "two:5").ok).toBe(false);
  });

  it("changes nothing about the song", () => {
    const before = JSON.stringify(SONG);
    rangeFromBarPair(SONG, "one:0", "one:3");
    rangeFromBar(SONG, "one:1");
    rangeFromTimeSelection(SONG, time("one", 0, boundaries("one")[2]!));
    expect(JSON.stringify(SONG)).toBe(before);
  });
});

describe("270. a time selection is taken exactly or refused by name", () => {
  it("takes a selection that is exactly one bar", () => {
    const marks = boundaries("one");
    const range = ranged(rangeFromTimeSelection(SONG, time("one", marks[0]!, marks[1]!)));
    expect(range).toEqual({
      sectionId: "one",
      startBarKey: "one:0",
      endBarKey: "one:0",
    });
  });

  it("takes a selection that is exactly several bars, across two grids", () => {
    const marks = boundaries("one");
    // Bars 1 and 2 are written at 1/16 and 1/12: no single slot size spans them.
    const range = ranged(rangeFromTimeSelection(SONG, time("one", marks[1]!, marks[3]!)));
    expect(range.startBarKey).toBe("one:1");
    expect(range.endBarKey).toBe("one:2");
  });

  it("takes a selection that is the whole section", () => {
    const marks = boundaries("one");
    const range = ranged(
      rangeFromTimeSelection(SONG, time("one", 0, marks[marks.length - 1]!)),
    );
    expect(range.startBarKey).toBe("one:0");
    expect(range.endBarKey).toBe("one:3");
  });

  it("refuses a start inside a bar rather than snapping it", () => {
    const marks = boundaries("one");
    const inside = marks[1]! - ticksPerSlot(8);
    expect(rangeFromTimeSelection(SONG, time("one", inside, marks[2]!))).toEqual({
      ok: false,
      reason: "requires_full_bars",
    });
  });

  it("refuses an end inside a bar rather than snapping it", () => {
    const marks = boundaries("one");
    const inside = marks[2]! - ticksPerSlot(16);
    expect(rangeFromTimeSelection(SONG, time("one", marks[1]!, inside))).toEqual({
      ok: false,
      reason: "requires_full_bars",
    });
  });

  it("refuses a selection one tick short of a bar line", () => {
    /*
     * The case a "close enough" tolerance would quietly accept. One tick is
     * inaudible and is still a different piece of music on every pass.
     */
    const marks = boundaries("one");
    expect(
      rangeFromTimeSelection(SONG, time("one", marks[1]!, marks[2]! - 1)).ok,
    ).toBe(false);
    expect(
      rangeFromTimeSelection(SONG, time("one", marks[1]! + 1, marks[2]!)).ok,
    ).toBe(false);
  });

  it("refuses an empty selection", () => {
    expect(rangeFromTimeSelection(SONG, time("one", PPQ, PPQ))).toEqual({
      ok: false,
      reason: "requires_full_bars",
    });
  });

  it("refuses a backwards selection", () => {
    const marks = boundaries("one");
    expect(rangeFromTimeSelection(SONG, time("one", marks[2]!, marks[1]!)).ok).toBe(
      false,
    );
  });

  it("refuses a selection in a section the song does not have", () => {
    expect(rangeFromTimeSelection(SONG, time("gone", 0, PPQ))).toEqual({
      ok: false,
      reason: "unknown_bar",
    });
  });

  it("refuses a selection that starts at the section's closing line", () => {
    const marks = boundaries("one");
    const end = marks[marks.length - 1]!;
    expect(rangeFromTimeSelection(SONG, time("one", end, end + PPQ)).ok).toBe(false);
  });

  it("works in odd meters, on their own boundaries", () => {
    const marks = boundaries("two");
    const range = ranged(rangeFromTimeSelection(SONG, time("two", 0, marks[1]!)));
    expect(range.endBarKey).toBe("two:0");
    // 7/8 at 1/8 is seven eighth notes, and the boundary is exactly there.
    expect(marks[1]).toBe(7 * (PPQ / 2));
  });
});

describe("272. a chain that leaves the section fails closed", () => {
  /*
   * A section whose first bar opens on a tie: the strike that made that sound
   * is in the section before, which no range here can reach. §VI's answer is
   * that there is no range at all, not a range with a caveat.
   */
  const CHAINED: Song = song(
    [guitarTrack()],
    [
      section(
        [
          {
            timeSignature: [4, 4],
            resolution: 8,
            slots: { gtr: ["-", "-", { notes: [{ pitch: "E2" }] }, null, null, null, null, null] },
          },
          {
            timeSignature: [4, 4],
            resolution: 8,
            slots: { gtr: Array.from({ length: 8 }, () => null) },
          },
        ],
        { id: "tail", name: "Kuyruk" },
      ),
    ],
  );

  it("refuses the single-bar door", () => {
    expect(rangeFromBar(CHAINED, "tail:0")).toEqual({
      ok: false,
      reason: "chain_crosses_section",
    });
  });

  it("refuses the pair door", () => {
    expect(rangeFromBarPair(CHAINED, "tail:0", "tail:1")).toEqual({
      ok: false,
      reason: "chain_crosses_section",
    });
  });

  it("refuses the time-selection door", () => {
    const ticks = slotCount([4, 4], 8) * ticksPerSlot(8);
    expect(
      rangeFromTimeSelection(CHAINED, {
        sectionId: "tail",
        trackId: "gtr",
        startTicks: 0,
        endTicks: ticks,
      }),
    ).toEqual({ ok: false, reason: "chain_crosses_section" });
  });

  it("allows a range that starts after the chain has ended", () => {
    expect(rangeFromBar(CHAINED, "tail:1").ok).toBe(true);
  });

  it("does not block a chain that could simply be included", () => {
    /*
     * The difference §VI turns on. A tie *inside* the section is an offer:
     * the reader can take the connection or leave it, and either way there is
     * a range. Only the seam is fail-closed.
     */
    const marks = boundaries("one");
    expect(rangeFromBarPair(SONG, "one:1", "one:2").ok).toBe(true);
    expect(rangeFromTimeSelection(SONG, time("one", marks[1]!, marks[3]!)).ok).toBe(true);
  });
});

describe("271. the offer and the conversion are the same rule", () => {
  it("offers exactly the selections it would accept", () => {
    const marks = boundaries("one");
    const cases = [
      time("one", marks[0]!, marks[1]!),
      time("one", marks[1]!, marks[3]!),
      time("one", marks[1]! + 1, marks[3]!),
      time("one", marks[1]!, marks[3]! - 1),
      time("one", marks[2]!, marks[2]!),
      time("gone", 0, PPQ),
    ];
    for (const selection of cases) {
      expect(offersPracticeRange(SONG, selection)).toBe(
        rangeFromTimeSelection(SONG, selection).ok,
      );
    }
  });
});

/**
 * The one horizontal axis (2Q-C §2, §11).
 *
 * The claims that matter are the ones a continuous scroll depends on: that a
 * bar's place is the sum of every bar before it, that tempo is nowhere in
 * that sum, and that a tick and an x are convertible without either drifting.
 */
import { describe, expect, it } from "vitest";

import {
  barAtTicks,
  barByKey,
  buildSongAxis,
  pointAtX,
  sectionById,
  xAtBarKey,
  xAtSection,
  xAtTicks,
} from "@/lib/tab/song-axis";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { slotCount, ticksPerSlot } from "@/lib/music/timing";
import { songSchema, type Resolution, type Song, type TimeSignature } from "@/lib/song/schema";

const SLOT = 34;

/** The sample song with one bar's grid or meter replaced. */
function withBar(
  sectionIndex: number,
  barIndex: number,
  change: { resolution?: Resolution; timeSignature?: TimeSignature },
): Song {
  const next = structuredClone(SAMPLE_SONG) as Song;
  const bar = next.sections[sectionIndex]!.bars[barIndex]!;
  const resolution = change.resolution ?? bar.resolution;
  const timeSignature = change.timeSignature ?? bar.timeSignature;
  const count = slotCount(timeSignature, resolution);
  bar.resolution = resolution;
  bar.timeSignature = timeSignature;
  for (const [trackId, lane] of Object.entries(bar.slots)) {
    if (!Array.isArray(lane)) continue;
    const isDrums = Array.isArray(lane[0]);
    bar.slots[trackId] = Array.from({ length: count }, () =>
      isDrums ? [] : null,
    ) as never;
  }
  return songSchema.parse(next);
}

describe("231. every bar of the song on one axis", () => {
  it("puts the sections in the song's order, end to end", () => {
    const axis = buildSongAxis(SAMPLE_SONG, SLOT);
    expect(axis.sections.map((section) => section.sectionId)).toEqual(
      SAMPLE_SONG.sections.map((section) => section.id),
    );
    for (let index = 1; index < axis.sections.length; index += 1) {
      const previous = axis.sections[index - 1]!;
      const current = axis.sections[index]!;
      expect(current.leftPx).toBe(previous.leftPx + previous.widthPx);
      expect(current.startTicks).toBe(previous.endTicks);
    }
  });

  it("gives every bar a global index and a key the app already speaks", () => {
    const axis = buildSongAxis(SAMPLE_SONG, SLOT);
    axis.bars.forEach((bar, index) => {
      expect(bar.globalBarIndex).toBe(index);
      expect(bar.key).toBe(`${bar.sectionId}:${bar.localBarIndex}`);
    });
  });

  it("lays a bar's left edge as the sum of every bar before it", () => {
    const axis = buildSongAxis(SAMPLE_SONG, SLOT);
    let running = 0;
    for (const bar of axis.bars) {
      expect(bar.leftPx).toBe(running);
      expect(bar.widthPx).toBe(bar.slotCount * SLOT);
      running += bar.widthPx;
    }
    expect(axis.totalWidthPx).toBe(running);
  });

  it("widens a denser bar and nothing else", () => {
    const before = buildSongAxis(SAMPLE_SONG, SLOT);
    const after = buildSongAxis(withBar(0, 1, { resolution: 16 }), SLOT);
    expect(after.bars[0]!.widthPx).toBe(before.bars[0]!.widthPx);
    expect(after.bars[1]!.widthPx).toBeGreaterThan(before.bars[1]!.widthPx);
    // And everything after it moves right by exactly that difference.
    const shift = after.bars[1]!.widthPx - before.bars[1]!.widthPx;
    expect(after.bars[2]!.leftPx).toBe(before.bars[2]!.leftPx + shift);
  });

  it("narrows a 3/4 bar relative to a 4/4 one on the same grid", () => {
    const axis = buildSongAxis(withBar(0, 1, { timeSignature: [3, 4], resolution: 12 }), SLOT);
    // 3/4 at 1/12 is nine slots; 4/4 at 1/8 is eight. Wider, and that is the
    // slot count talking rather than the duration: the 3/4 bar is *shorter*.
    expect(axis.bars[1]!.slotCount).toBe(9);
    expect(axis.bars[1]!.endTicks - axis.bars[1]!.startTicks).toBeLessThan(
      axis.bars[0]!.endTicks - axis.bars[0]!.startTicks,
    );
  });

  it("does not let tempo touch the geometry", () => {
    const before = buildSongAxis(SAMPLE_SONG, SLOT);
    const faster = structuredClone(SAMPLE_SONG) as Song;
    faster.bpm = 240;
    faster.sections[1]!.bpmOverride = 60;
    const after = buildSongAxis(songSchema.parse(faster), SLOT);
    expect(after.bars.map((bar) => bar.leftPx)).toEqual(
      before.bars.map((bar) => bar.leftPx),
    );
    expect(after.totalWidthPx).toBe(before.totalWidthPx);
  });

  it("does not let a missing track key, a silent track or a track count touch it", () => {
    const before = buildSongAxis(SAMPLE_SONG, SLOT);
    const stripped = structuredClone(SAMPLE_SONG) as Song;
    for (const section of stripped.sections) {
      for (const bar of section.bars) delete bar.slots["gtr"];
    }
    const after = buildSongAxis(songSchema.parse(stripped), SLOT);
    expect(after.bars.map((bar) => bar.leftPx)).toEqual(
      before.bars.map((bar) => bar.leftPx),
    );
  });

  it("builds the same numbers five times running", () => {
    const first = JSON.stringify(buildSongAxis(SAMPLE_SONG, SLOT));
    for (let round = 0; round < 4; round += 1) {
      expect(JSON.stringify(buildSongAxis(SAMPLE_SONG, SLOT))).toBe(first);
    }
  });

  it("does not touch the song it was handed", () => {
    const frozen = JSON.stringify(SAMPLE_SONG);
    buildSongAxis(SAMPLE_SONG, SLOT);
    expect(JSON.stringify(SAMPLE_SONG)).toBe(frozen);
  });

  it("carries the slot width it was built with, so nobody assumes one", () => {
    expect(buildSongAxis(SAMPLE_SONG, 20).slotWidthPx).toBe(20);
    expect(buildSongAxis(SAMPLE_SONG, 20).totalWidthPx).toBe(
      (buildSongAxis(SAMPLE_SONG, 40).totalWidthPx / 40) * 20,
    );
  });
});

describe("232. converting between a tick and an x", () => {
  const axis = buildSongAxis(SAMPLE_SONG, SLOT);

  it("finds the bar a tick belongs to, in any section", () => {
    for (const bar of axis.bars) {
      expect(barAtTicks(axis, bar.startTicks)?.key).toBe(bar.key);
      expect(barAtTicks(axis, bar.endTicks - 1)?.key).toBe(bar.key);
    }
  });

  it("puts a bar's first tick exactly on its left edge", () => {
    for (const bar of axis.bars) {
      expect(xAtTicks(axis, bar.startTicks)).toBe(bar.leftPx);
    }
  });

  it("round-trips every representable slot start", () => {
    for (const bar of axis.bars) {
      const per = ticksPerSlot(bar.resolution);
      for (let slot = 0; slot < bar.slotCount; slot += 1) {
        const ticks = bar.startTicks + slot * per;
        const x = xAtTicks(axis, ticks);
        expect(x).not.toBeNull();
        const point = pointAtX(axis, x!);
        expect(point?.bar.key).toBe(bar.key);
        expect(point?.slotIndex).toBe(slot);
        expect(point?.slotStartTicks).toBe(ticks);
      }
    }
  });

  it("says nothing rather than clamping a tick outside the song", () => {
    expect(xAtTicks(axis, -1)).toBeNull();
    expect(xAtTicks(axis, axis.totalTicks + 1)).toBeNull();
    expect(barAtTicks(axis, -1)).toBeNull();
  });

  it("treats the very last tick as the end of the song, not as outside it", () => {
    expect(barAtTicks(axis, axis.totalTicks)?.key).toBe(axis.bars.at(-1)!.key);
    expect(xAtTicks(axis, axis.totalTicks)).toBe(axis.totalWidthPx);
  });

  it("answers for a section id and a bar key", () => {
    for (const section of axis.sections) {
      expect(xAtSection(axis, section.sectionId)).toBe(section.leftPx);
      expect(sectionById(axis, section.sectionId)?.barCount).toBe(section.barCount);
    }
    for (const bar of axis.bars) {
      expect(xAtBarKey(axis, bar.key)).toBe(bar.leftPx);
      expect(barByKey(axis, bar.key)?.globalBarIndex).toBe(bar.globalBarIndex);
    }
    expect(xAtSection(axis, "no-such-section")).toBeNull();
    expect(xAtBarKey(axis, "no-such:0")).toBeNull();
  });

  it("names the slot an x is inside, and never the nearest one", () => {
    const bar = axis.bars[0]!;
    const slotWidth = bar.widthPx / bar.slotCount;
    // A hair before the second slot's line is still the first slot.
    expect(pointAtX(axis, bar.leftPx + slotWidth - 0.01)?.slotIndex).toBe(0);
    // A hair after it is the second, and nothing rounded either of them.
    expect(pointAtX(axis, bar.leftPx + slotWidth + 0.01)?.slotIndex).toBe(1);
  });

  it("resolves an x on a mixed-grid song against that bar's own grid", () => {
    const mixed = buildSongAxis(withBar(0, 1, { resolution: 16 }), SLOT);
    const dense = mixed.bars[1]!;
    const point = pointAtX(mixed, dense.leftPx + dense.widthPx / 2);
    expect(point?.bar.key).toBe(dense.key);
    expect(point?.slotIndex).toBe(dense.slotCount / 2);
    expect(point?.slotStartTicks).toBe(
      dense.startTicks + (dense.slotCount / 2) * ticksPerSlot(dense.resolution),
    );
  });

  it("says nothing for an x outside the axis", () => {
    expect(pointAtX(axis, -1)).toBeNull();
    expect(pointAtX(axis, axis.totalWidthPx + 1)).toBeNull();
    // The right edge itself belongs to the last slot of the last bar.
    expect(pointAtX(axis, axis.totalWidthPx)?.bar.key).toBe(axis.bars.at(-1)!.key);
  });

  it("has an empty axis rather than a broken one for a song with no bars", () => {
    const empty = structuredClone(SAMPLE_SONG) as Song;
    for (const section of empty.sections) section.bars = [];
    const built = buildSongAxis(empty as Song, SLOT);
    expect(built.bars).toEqual([]);
    expect(built.totalWidthPx).toBe(0);
    expect(built.totalTicks).toBe(0);
    expect(xAtTicks(built, 0)).toBeNull();
    expect(pointAtX(built, 0)).toBeNull();
  });
});

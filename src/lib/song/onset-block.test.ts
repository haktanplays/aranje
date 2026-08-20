/**
 * The unit a musician picks up (spec 13.1, phase 2E).
 */
import { describe, expect, it } from "vitest";

import {
  blockContaining,
  canonicalRefs,
  sectionOnsetBlocks,
  sectionSlotStream,
} from "@/lib/song/onset-block";
import {
  REST,
  TIE,
  bar,
  emptyBar,
  note,
  sectionOf,
  slots,
  song,
} from "@/test/move-fixtures";
import type { MelodicSlot } from "@/lib/song/schema";

describe("the flat slot stream", () => {
  it("counts each bar by its own metre, not by a fixed slot count", () => {
    const stream = sectionSlotStream(
      sectionOf(song([bar(slots([note("A3", 1, 12)])), bar(slots([]), 16)])),
      "gtr",
    );

    expect(stream).toHaveLength(8 + 16);
    expect(stream[8]).toMatchObject({ barIndex: 1, slotIndex: 0 });
  });

  it("keeps the positions of a bar the track is not written in, as holes", () => {
    const stream = sectionSlotStream(
      sectionOf(song([bar(slots([note("A3", 1, 12)])), emptyBar()])),
      "gtr",
    );

    expect(stream).toHaveLength(16);
    expect(stream[8]).toMatchObject({ barIndex: 1, writable: false, slot: undefined });
  });
});

describe("onset blocks", () => {
  it("makes a single note a block of one slot", () => {
    const blocks = sectionOnsetBlocks(
      sectionOf(song([bar(slots([note("A3", 1, 12)]))])),
      "gtr",
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ start: { barIndex: 0, slotIndex: 0 }, length: 1 });
    expect(blocks[0]?.tail).toEqual([]);
  });

  it("keeps a whole chord in one block, however many strings it uses", () => {
    const chord: MelodicSlot = {
      notes: [
        { pitch: "E3", position: { string: 0, fret: 12 } },
        { pitch: "B3", position: { string: 1, fret: 14 } },
        { pitch: "E4", position: { string: 2, fret: 14 } },
      ],
    };
    const blocks = sectionOnsetBlocks(sectionOf(song([bar(slots([chord]))])), "gtr");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.length).toBe(1);
  });

  it("takes the whole tie run with the chord", () => {
    const blocks = sectionOnsetBlocks(
      sectionOf(song([bar(slots([note("A3", 1, 12), TIE, TIE]))])),
      "gtr",
    );

    expect(blocks[0]?.length).toBe(3);
    expect(blocks[0]?.tail).toEqual([
      { barIndex: 0, slotIndex: 1 },
      { barIndex: 0, slotIndex: 2 },
    ]);
  });

  it("follows a tie across the bar line", () => {
    const first = [
      REST, REST, REST, REST, REST, REST, REST, note("A3", 1, 12),
    ] as MelodicSlot[];
    const blocks = sectionOnsetBlocks(
      sectionOf(song([bar(first), bar([TIE, TIE, ...slots([]).slice(2)])])),
      "gtr",
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.length).toBe(3);
    expect(blocks[0]?.tail).toEqual([
      { barIndex: 1, slotIndex: 0 },
      { barIndex: 1, slotIndex: 1 },
    ]);
  });

  it("stops a tie run at a bar the track is not written in", () => {
    const first = [
      REST, REST, REST, REST, REST, REST, REST, note("A3", 1, 12),
    ] as MelodicSlot[];
    const blocks = sectionOnsetBlocks(
      sectionOf(song([bar(first), emptyBar()])),
      "gtr",
    );

    expect(blocks[0]?.length).toBe(1);
  });

  it("knows the block that ends at the section's last slot", () => {
    const slots = [
      REST, REST, REST, REST, REST, note("A3", 1, 12), TIE, TIE,
    ] as MelodicSlot[];
    const blocks = sectionOnsetBlocks(sectionOf(song([bar(slots)])), "gtr");

    expect(blocks[0]).toMatchObject({ start: { barIndex: 0, slotIndex: 5 }, length: 3 });
  });
});

describe("what a tap resolves to", () => {
  const fixture = song([bar(slots([note("A3", 1, 12), TIE, TIE, note("C4", 1, 15)]))]);
  const blocks = sectionOnsetBlocks(sectionOf(fixture), "gtr");

  it("resolves any slot of a block to the block itself", () => {
    for (const slotIndex of [0, 1, 2]) {
      expect(blockContaining(blocks, { barIndex: 0, slotIndex })?.start).toEqual({
        barIndex: 0,
        slotIndex: 0,
      });
    }
  });

  it("does not turn a tie into a block of its own", () => {
    const tie = blockContaining(blocks, { barIndex: 0, slotIndex: 1 });
    expect(tie?.start.slotIndex).toBe(0);
    expect(blocks.some((block) => block.start.slotIndex === 1)).toBe(false);
  });

  it("resolves a rest to nothing at all", () => {
    expect(blockContaining(blocks, { barIndex: 0, slotIndex: 5 })).toBeNull();
  });
});

describe("canonical selections", () => {
  it("sorts by bar then slot and drops repeats", () => {
    expect(
      canonicalRefs([
        { barIndex: 1, slotIndex: 2 },
        { barIndex: 0, slotIndex: 4 },
        { barIndex: 1, slotIndex: 2 },
        { barIndex: 0, slotIndex: 1 },
      ]),
    ).toEqual([
      { barIndex: 0, slotIndex: 1 },
      { barIndex: 0, slotIndex: 4 },
      { barIndex: 1, slotIndex: 2 },
    ]);
  });
});

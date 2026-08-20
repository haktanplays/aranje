/**
 * Moving music between bars that do not share a grid (spec 13.1, 5.5, K-34).
 *
 * The rule the phase asked for, in one sentence: a move works in musical time,
 * not in slot indices, and if the moment it would land on does not exist on
 * the target bar's grid the move is refused rather than rounded to the nearest
 * slot. Rounding would put the musician's note somewhere they did not ask for
 * and give them nothing to notice it by.
 *
 * A refusal is total. No block moves, no tie is orphaned, and the song comes
 * back untouched — the same atomicity phase 2E established, now with one more
 * reason to say no.
 */
import { describe, expect, it } from "vitest";

import { applyMoveOnsetGroup, type OnsetMovement } from "@/lib/song/move";
import { buildSongPlan } from "@/lib/audio/schedule";
import { sectionBarStartTicks, sectionSlotStream } from "@/lib/song/onset-block";
import { ticksPerSlot } from "@/lib/music/timing";
import { REST, TIE, bar, note, readBar, slots, song } from "@/test/move-fixtures";
import type { Song } from "@/lib/song/schema";
import type { OnsetRef } from "@/lib/song/onset-block";

const A3 = () => note("A3", 1, 12);

const move = (
  target: Song,
  origins: readonly OnsetRef[],
  movement: OnsetMovement,
) =>
  applyMoveOnsetGroup(target, {
    kind: "move_onset_group",
    sectionId: "s1",
    trackId: "gtr",
    origins,
    movement,
  });

const at = (barIndex: number, slotIndex: number): OnsetRef => ({ barIndex, slotIndex });

describe("the slot stream knows what time each slot is", () => {
  it("gives every slot its own bar's tick length", () => {
    const fixture = song([bar(slots([], 16), 16), bar(slots([], 32), 32)]);
    const section = fixture.sections[0];
    if (!section) throw new Error("no section");
    const stream = sectionSlotStream(section, "gtr");

    expect(stream).toHaveLength(48);
    expect(stream[0]?.durationTicks).toBe(ticksPerSlot(16));
    expect(stream[16]?.durationTicks).toBe(ticksPerSlot(32));
    // Bar two starts one whole 4/4 bar in, whatever grid either bar is on.
    expect(stream[16]?.startTicks).toBe(768);
    expect(sectionBarStartTicks(section)).toEqual([0, 768]);
  });

  it("counts up in whole ticks with no gaps", () => {
    const fixture = song([
      bar(slots([], 16), 16),
      bar(slots([], 24), 24),
      bar(slots([], 8), 8),
    ]);
    const section = fixture.sections[0];
    if (!section) throw new Error("no section");
    const stream = sectionSlotStream(section, "gtr");
    let expected = 0;
    for (const entry of stream) {
      expect(entry.startTicks).toBe(expected);
      expect(Number.isInteger(entry.startTicks)).toBe(true);
      expected += entry.durationTicks;
    }
    expect(expected).toBe(768 * 3);
  });
});

describe("a bar move keeps the moment, not the slot index", () => {
  it("lands on the slot that is the same moment on a finer grid", () => {
    // Beat three of a 1/16 bar is slot 8; on a 1/32 bar it is slot 16.
    const fixture = song([
      bar(slots([...Array.from({ length: 8 }, () => REST), A3()], 16), 16),
      bar(slots([], 32), 32),
    ]);
    const result = move(fixture, [at(0, 8)], "next_bar");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const landed = readBar(result.song, 1);
    expect(landed[16]).toBe("A3");
    // Not slot 8, which on this grid would be beat two.
    expect(landed[8]).toBe(".");
    expect(result.origins).toEqual([at(1, 16)]);
  });

  it("lands on the slot that is the same moment on a coarser grid", () => {
    const fixture = song([
      bar(slots([], 8), 8),
      bar(slots([...Array.from({ length: 16 }, () => REST), A3()], 32), 32),
    ]);
    // Slot 16 of a 1/32 bar is beat three, which a 1/8 bar has as slot 4.
    const result = move(fixture, [at(1, 16)], "previous_bar");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Expressible, but one 1/8 slot is four 1/32 slots long, so the note
    // would quadruple. Refused rather than rounded or stretched.
    expect(result.error.code).toBe("target_grid_incompatible");
  });

  it("moves when the moment exists and the length is unchanged", () => {
    // The same block written as four 1/32 slots is one 1/8 slot long; moving
    // it into an 1/8 bar keeps both the moment and the duration.
    const fixture = song([
      bar(slots([], 8), 8),
      bar(
        slots(
          [...Array.from({ length: 16 }, () => REST), A3(), TIE, TIE, TIE],
          32,
        ),
        32,
      ),
    ]);
    const result = move(fixture, [at(1, 16)], "previous_bar");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 0)[4]).toBe("A3");
    expect(readBar(result.song, 1)[16]).toBe(".");
  });
});

describe("a block re-notated on another grid still sounds the same", () => {
  it("becomes two 1/32 slots when it was one 1/16 slot", () => {
    const fixture = song([
      bar(slots([...Array.from({ length: 8 }, () => REST), A3()], 16), 16),
      bar(slots([], 32), 32),
    ]);
    const before = buildSongPlan(fixture).events.filter((e) => e.kind === "note");
    const result = move(fixture, [at(0, 8)], "next_bar");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Onset plus one tie: the same length written on a finer grid.
    const landed = readBar(result.song, 1);
    expect(landed[16]).toBe("A3");
    expect(landed[17]).toBe("-");
    expect(landed[18]).toBe(".");

    const after = buildSongPlan(result.song).events.filter((e) => e.kind === "note");
    expect(after).toHaveLength(1);
    expect(after[0]?.durationTicks).toBe(before[0]?.durationTicks);
  });

  it("collapses four 1/32 slots into one 1/8 slot", () => {
    const fixture = song([
      bar(slots([], 8), 8),
      bar(
        slots(
          [...Array.from({ length: 16 }, () => REST), A3(), TIE, TIE, TIE],
          32,
        ),
        32,
      ),
    ]);
    const before = buildSongPlan(fixture).events.filter((e) => e.kind === "note");
    const result = move(fixture, [at(1, 16)], "previous_bar");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const landed = readBar(result.song, 0);
    expect(landed[4]).toBe("A3");
    expect(landed[5]).toBe(".");

    const after = buildSongPlan(result.song).events.filter((e) => e.kind === "note");
    expect(after[0]?.durationTicks).toBe(before[0]?.durationTicks);
  });
});

describe("a moment that does not exist on the target grid", () => {
  it("is refused rather than rounded to the nearest slot", () => {
    // Slot 1 of a 1/16 bar is 48 ticks in. A 1/8 bar's slots are 96 ticks
    // apart, so there is nothing at 48 — and slot 0 and slot 1 are both
    // "nearest" in the way that rounding would silently pick one.
    const fixture = song([
      bar(slots([], 8), 8),
      bar(slots([REST, A3()], 16), 16),
    ]);
    const result = move(fixture, [at(1, 1)], "previous_bar");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("target_grid_incompatible");
    expect(result.error.message).toContain("yuvarlanmadı");
  });

  it("is refused between two grids that do not divide each other", () => {
    // A 1/16-triplet slot is 32 ticks; a 1/32 slot is 24. Slot 1 of the
    // triplet bar is 32 ticks in, and 32 is not a multiple of 24.
    const fixture = song([
      bar(slots([], 32), 32),
      bar(slots([REST, A3()], 24), 24),
    ]);
    const result = move(fixture, [at(1, 1)], "previous_bar");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("target_grid_incompatible");
  });

  it("leaves the song exactly as it was", () => {
    const fixture = song([
      bar(slots([], 8), 8),
      bar(slots([REST, A3()], 16), 16),
    ]);
    const before = JSON.stringify(fixture);
    const result = move(fixture, [at(1, 1)], "previous_bar");

    expect(result.ok).toBe(false);
    expect(JSON.stringify(fixture)).toBe(before);
  });

  it("refuses the whole selection when only one block cannot land", () => {
    const fixture = song([
      bar(slots([], 8), 8),
      bar(slots([A3(), note("C4", 1, 15)], 16), 16),
    ]);
    // Slot 0 lands fine on the 1/8 bar; slot 1 does not.
    const result = move(fixture, [at(1, 0), at(1, 1)], "previous_bar");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("target_grid_incompatible");
    // And nothing partial happened: the first block did not move either.
    expect(readBar(fixture, 1)[0]).toBe("A3");
  });
});

describe("slot moves across a grid change", () => {
  it("still refuses to change a block's length", () => {
    // The last slot of a 1/16 bar stepping into the first slot of a 1/8 bar
    // would double the note's length; that is a duration change, not a move.
    const fixture = song([
      bar(slots([...Array.from({ length: 15 }, () => REST), A3()], 16), 16),
      bar(slots([], 8), 8),
    ]);
    const result = move(fixture, [at(0, 15)], "next_slot");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("target_grid_incompatible");
  });

  it("moves normally inside one grid", () => {
    const fixture = song([
      bar(slots([...Array.from({ length: 20 }, () => REST), A3()], 32), 32),
      bar(slots([], 8), 8),
    ]);
    const result = move(fixture, [at(0, 20)], "next_slot");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 0)[21]).toBe("A3");
  });
});

describe("what a refusal is not allowed to do", () => {
  it("never leaves an orphan tie behind", () => {
    const fixture = song([
      bar(slots([], 8), 8),
      bar(slots([REST, A3(), TIE, TIE], 16), 16),
    ]);
    const result = move(fixture, [at(1, 1)], "previous_bar");
    expect(result.ok).toBe(false);
    // The tie run is still attached to its onset, in the song that came back.
    expect(readBar(fixture, 1).slice(1, 4)).toEqual(["A3", "-", "-"]);
  });

  it("uses a code a caller can tell apart from a collision", () => {
    const grid = song([bar(slots([], 8), 8), bar(slots([REST, A3()], 16), 16)]);
    const gridResult = move(grid, [at(1, 1)], "previous_bar");

    const occupied = song([
      bar(slots([REST, note("C4", 1, 15)], 16), 16),
      bar(slots([REST, A3()], 16), 16),
    ]);
    const occupiedResult = move(occupied, [at(1, 1)], "previous_bar");

    expect(gridResult.ok).toBe(false);
    expect(occupiedResult.ok).toBe(false);
    if (gridResult.ok || occupiedResult.ok) return;
    expect(gridResult.error.code).toBe("target_grid_incompatible");
    expect(occupiedResult.error.code).toBe("validation_failed");
  });
});

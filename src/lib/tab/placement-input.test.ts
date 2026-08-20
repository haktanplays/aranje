/**
 * The reading of tie, rest and carry the placement engine is handed.
 *
 * These are the three ways the engine could be told the wrong story about a
 * track without the search itself being wrong (spec 5.5, 9.2, K-19).
 */
import { describe, expect, it } from "vitest";

import { trackPlacementInput } from "@/lib/tab/placement-input";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { songSchema, type Bar, type MelodicSlot, type Song } from "@/lib/song/schema";

const GUITAR = SAMPLE_SONG.tracks.find((track) => track.id === "gtr");
if (!GUITAR) throw new Error("demo song has no guitar");

function bar(slots: Record<string, MelodicSlot[]>): Bar {
  return { timeSignature: [4, 4], resolution: 8, slots };
}

/** One section of the given bars, guitar only. */
function song(bars: readonly Bar[]): Song {
  const parsed = songSchema.safeParse({
    version: 2,
    title: "placement input",
    bpm: 120,
    key: "E minor",
    tracks: [GUITAR],
    sections: [{ id: "s1", name: "S1", status: "fixed", bars }],
  });
  if (!parsed.success) throw new Error("fixture does not parse");
  return parsed.data;
}

const note = (pitch: string): MelodicSlot => ({ notes: [{ pitch }] });
const rest = null as unknown as MelodicSlot;
const tie = "-" as MelodicSlot;

/** Eight slots: one struck note and seven of whatever follows it. */
function held(pitch: string): MelodicSlot[] {
  return [note(pitch), tie, tie, tie, tie, tie, tie, tie];
}

function silences(input: ReturnType<typeof trackPlacementInput>): boolean[] {
  return input.bars.map((entry) => entry.silent);
}

describe("what counts as an onset", () => {
  it("does not count a tie as a new onset", () => {
    const input = trackPlacementInput(song([bar({ gtr: held("A3") })]), "gtr");

    expect(input.onsets).toHaveLength(1);
    expect(input.onsets[0]?.slotIndex).toBe(0);
  });

  it("counts each struck slot once, in playing order", () => {
    const input = trackPlacementInput(
      song([
        bar({ gtr: [note("A3"), tie, note("C4"), rest, note("E4"), tie, tie, rest] }),
      ]),
      "gtr",
    );

    expect(input.onsets.map((onset) => onset.slotIndex)).toEqual([0, 2, 4]);
  });

  it("keys an onset by section, bar and slot", () => {
    const input = trackPlacementInput(
      song([bar({ gtr: held("A3") }), bar({ gtr: held("C4") })]),
      "gtr",
    );

    expect(input.onsets.map((onset) => onset.key)).toEqual(["s1:0:0", "s1:1:0"]);
    expect(input.onsets.map((onset) => onset.barNumber)).toEqual([1, 2]);
  });

  it("has nothing to say about a track that is not in the song", () => {
    const input = trackPlacementInput(song([bar({ gtr: held("A3") })]), "bass");

    expect(input.onsets).toEqual([]);
    expect(silences(input)).toEqual([true]);
  });
});

describe("which bars the hand gets to itself", () => {
  it("does not call a bar filled by a held note silent", () => {
    const input = trackPlacementInput(
      song([
        bar({ gtr: held("A3") }),
        bar({ gtr: [tie, tie, tie, tie, tie, tie, tie, tie] }),
        bar({ gtr: held("C4") }),
      ]),
      "gtr",
    );

    expect(silences(input)).toEqual([false, false, false]);
  });

  it("calls a bar of rests silent", () => {
    const input = trackPlacementInput(
      song([
        bar({ gtr: held("A3") }),
        bar({ gtr: [rest, rest, rest, rest, rest, rest, rest, rest] }),
        bar({ gtr: held("C4") }),
      ]),
      "gtr",
    );

    expect(silences(input)).toEqual([false, true, false]);
  });

  it("calls a bar the track is not written in silent", () => {
    const input = trackPlacementInput(
      song([bar({ gtr: held("A3") }), bar({}), bar({ gtr: held("C4") })]),
      "gtr",
    );

    expect(silences(input)).toEqual([false, true, false]);
  });

  it("ends the carry at a bar the track is not written in", () => {
    // Bar 1 holds a note to its end, bar 2 does not mention the track at all,
    // bar 3 is nothing but ties. Nothing sounds across bar 2 (spec 5.5), so
    // bar 3 has nothing left over and the hand is free there too.
    const input = trackPlacementInput(
      song([
        bar({ gtr: held("A3") }),
        bar({}),
        bar({ gtr: [tie, tie, tie, tie, tie, tie, tie, tie] }),
        bar({ gtr: held("C4") }),
      ]),
      "gtr",
    );

    expect(silences(input)).toEqual([false, true, true, false]);
  });

  it("ends the carry at a rest, so the rest of the bar is still not silent", () => {
    const input = trackPlacementInput(
      song([
        bar({ gtr: [note("A3"), tie, tie, rest, rest, rest, rest, rest] }),
        bar({ gtr: [rest, rest, rest, rest, rest, rest, rest, rest] }),
      ]),
      "gtr",
    );

    expect(silences(input)).toEqual([false, true]);
  });
});

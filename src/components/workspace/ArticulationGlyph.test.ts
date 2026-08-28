/**
 * The mark beside a fret number (spec 13.9).
 */
import { describe, expect, it } from "vitest";

import { articulationMark } from "@/components/workspace/ArticulationGlyph";
import { risingAt } from "@/components/workspace/FrettedBarBlock";
import type { FrettedBar } from "@/lib/tab/timeline";
import { articulationSchema } from "@/lib/song/schema";
import { EXPRESSIVE_ARTICULATIONS } from "@/lib/audio/expression";

describe("marks", () => {
  it("gives every pilot articulation a mark of its own", () => {
    const marks = EXPRESSIVE_ARTICULATIONS.map((articulation) =>
      articulationMark(articulation),
    );
    expect(marks.every((mark) => mark !== null && mark.length > 0)).toBe(true);
    expect(new Set(marks).size).toBe(marks.length);
  });

  it("uses the marks the spec names", () => {
    expect(articulationMark("accent")).toBe(">");
    expect(articulationMark("palm_mute")).toBe("PM");
    expect(articulationMark("vibrato")).toBe("~");
    expect(articulationMark("bend_half")).toBe("b½");
    expect(articulationMark("bend_full")).toBe("b1");
    expect(articulationMark("hammer_on")).toBe("h");
    expect(articulationMark("pull_off")).toBe("p");
  });

  it("leans a slide the way the music goes", () => {
    expect(articulationMark("slide", true)).toBe("/");
    expect(articulationMark("slide", false)).toBe("\\");
    // With nothing to compare against it still shows something.
    expect(articulationMark("slide")).toBe("/");
  });

  it("says nothing about the values that were never expression", () => {
    for (const articulation of ["normal", "sustain", "staccato"] as const) {
      expect(articulationMark(articulation)).toBeNull();
    }
  });

  it("covers every value the schema allows, one way or the other", () => {
    for (const articulation of articulationSchema.options) {
      const mark = articulationMark(articulation);
      const expected = (EXPRESSIVE_ARTICULATIONS as readonly string[]).includes(
        articulation,
      );
      expect(mark !== null).toBe(expected);
    }
  });
});

describe("which way a slide leans", () => {
  const span = (
    stringIndex: number,
    pitch: string,
    startSlot: number,
    fret: number | null,
  ) => ({
    stringIndex,
    fret,
    pitch,
    startSlot,
    endSlot: startSlot,
    writtenTicks: 96,
    openStart: false,
    openEnd: false,
  });

  const barOf = (spans: ReturnType<typeof span>[]): FrettedBar => ({
    key: "s1:0",
    sectionId: "s1",
    sectionName: "S1",
    sectionStatus: "fixed",
    isSectionStart: true,
    barIndex: 0,
    barNumber: 1,
    timeSignature: [4, 4],
    resolution: 8,
    slotCount: 8,
    silent: false,
    spans,
    rests: [],
  });

  it("leans up when the pitch goes up and down when it goes down", () => {
    const up = [span(1, "G3", 0, 10), span(1, "B3", 1, 14)];
    const down = [span(1, "B3", 0, 14), span(1, "G3", 1, 10)];

    expect(risingAt(barOf(up), up[1]!)).toBe(true);
    expect(risingAt(barOf(down), down[1]!)).toBe(false);
  });

  it("reads the pitch, not the fret, so an unplaced note still leans right", () => {
    // A note the placement search could not resolve has no fret, but it is
    // still a pitch and the ear still hears which way the hand went.
    const spans = [span(1, "B3", 0, null), span(1, "G3", 1, null)];
    expect(risingAt(barOf(spans), spans[1]!)).toBe(false);
  });

  it("says nothing when there is nothing on that string to lean away from", () => {
    const spans = [span(0, "E3", 0, 12), span(1, "A3", 1, 12)];
    expect(risingAt(barOf(spans), spans[1]!)).toBeUndefined();
  });

  it("says nothing when the pitch does not move at all", () => {
    const spans = [span(1, "A3", 0, 12), span(1, "A3", 1, 12)];
    expect(risingAt(barOf(spans), spans[1]!)).toBeUndefined();
  });
});

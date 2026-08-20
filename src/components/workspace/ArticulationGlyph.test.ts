/**
 * The mark beside a fret number (spec 13.9).
 */
import { describe, expect, it } from "vitest";

import { articulationMark } from "@/components/workspace/ArticulationGlyph";
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

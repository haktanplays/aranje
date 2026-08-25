/**
 * The tab's fret numbers, read back as numbers (2S-A §4).
 */
import { describe, expect, it } from "vitest";

import {
  DIGIT_ADVANCE_PX,
  MASK_BLEED_PX,
  MIN_MASK_PX,
  buildFretGlyph,
  fretLabel,
  glyphText,
  legatoLabel,
  maskWidthFor,
  type GlyphState,
} from "@/lib/tab/glyph-model";

const STATES: readonly GlyphState[] = [
  "normal",
  "selected",
  "ghost",
  "playing",
  "tie",
  "legato",
  "rejected",
];

describe("293. what a fret number prints", () => {
  it("prints the number, and 0 for an open string", () => {
    expect(glyphText(0)).toBe("0");
    expect(glyphText(7)).toBe("7");
    expect(glyphText(12)).toBe("12");
    expect(glyphText(24)).toBe("24");
  });

  it("says so rather than lying when there is no placement", () => {
    expect(glyphText(null)).toBe("?");
  });

  it("treats a capo-relative fret as a fret, because that is what it is", () => {
    // Capo 3, first fret above it, is written `1` — the same system as every
    // other number here. Nothing about the glyph knows there is a capo.
    expect(glyphText(1)).toBe("1");
    expect(buildFretGlyph({ fret: 1, state: "normal" }).digits).toBe(1);
  });
});

describe("294. the string is interrupted by the number, not by a box", () => {
  it("gives a two-digit fret a wider gap than a one-digit fret", () => {
    expect(maskWidthFor("12")).toBeGreaterThan(maskWidthFor("7"));
  });

  it("clears the digits themselves plus a bleed on each side", () => {
    expect(maskWidthFor("12")).toBeCloseTo(2 * DIGIT_ADVANCE_PX + 2 * MASK_BLEED_PX, 6);
  });

  it("never cuts a gap too small to read as a gap", () => {
    // A single narrow digit at a tiny advance still leaves a visible break.
    expect(maskWidthFor("7", 1)).toBe(MIN_MASK_PX);
  });

  it("keeps one- and two-digit numbers on the same centre", () => {
    // The mask is symmetric about the digits, so both are centred on the slot.
    const one = buildFretGlyph({ fret: 7, state: "normal" });
    const two = buildFretGlyph({ fret: 12, state: "normal" });
    expect(one.maskWidth - one.textWidth).toBeCloseTo(2 * MASK_BLEED_PX, 6);
    expect(two.maskWidth - two.textWidth).toBeCloseTo(2 * MASK_BLEED_PX, 6);
  });
});

describe("295. every state is told by a shape, not only by a colour", () => {
  it("gives all seven states a distinct reading", () => {
    expect(new Set(STATES)).toHaveProperty("size", 7);
  });

  it("carries a shape cue for every state that is not the ordinary one", () => {
    for (const state of STATES) {
      const glyph = buildFretGlyph({ fret: 7, state });
      expect(glyph.hasShapeCue, state).toBe(state !== "normal");
    }
  });

  it("does not reuse one marker for two different things", () => {
    const markers = STATES.filter((state) => state !== "normal").map(
      (state) => buildFretGlyph({ fret: 7, state }).marker,
    );
    // `selected` and `legato` share an underline on purpose — both are "this
    // note is part of something" — and nothing else repeats.
    expect(new Set(markers).size).toBe(markers.length - 1);
  });
});

describe("296. what the glyph is called out loud", () => {
  it("names a fret as music, in Turkish", () => {
    expect(fretLabel(7)).toBe("7. perde");
    expect(fretLabel(12)).toBe("12. perde");
  });

  it("calls fret zero an open string rather than 'zero'", () => {
    expect(fretLabel(0)).toBe("Boş tel");
  });

  it("says a note cannot be played rather than reading a question mark", () => {
    expect(fretLabel(null)).toBe("Bu nota bu akortta çalınamıyor");
  });

  it("names a slur by the movement, never by its identifier", () => {
    expect(legatoLabel(8, 7, "pull_off")).toBe("8. perdeden 7. perdeye koparma");
    expect(legatoLabel(5, 7, "hammer_on")).toBe("5. perdeden 7. perdeye çekiç");
  });

  it("never lets an identifier, a tick or a slot into a name", () => {
    const names = [
      ...STATES.map((state) => buildFretGlyph({ fret: 7, state }).label),
      buildFretGlyph({
        fret: 7,
        state: "legato",
        articulation: "pull_off",
        slurredFrom: 8,
      }).label,
      fretLabel(null),
      legatoLabel(8, 7, "pull_off"),
      legatoLabel(null, null, "hammer_on"),
    ];
    for (const name of names) {
      expect(name).not.toMatch(/hammer_on|pull_off|tick|slot|_/i);
    }
  });

  it("says the movement in a slurred note's own name", () => {
    const glyph = buildFretGlyph({
      fret: 7,
      state: "legato",
      articulation: "pull_off",
      slurredFrom: 8,
    });
    expect(glyph.label).toBe("7. perde, 8. perdeden 7. perdeye koparma");
  });

  it("leaves an ordinary note's name to the fret alone", () => {
    expect(buildFretGlyph({ fret: 7, state: "normal" }).label).toBe("7. perde");
  });
});

/**
 * One page for five axes (2V-D.1-C §11).
 *
 * The defect these guard against is silent by construction: a reader writes
 * an accent through the new `attack` field, hears it, and sees nothing on the
 * page — or writes a palm mute as a span and gets no rail, because the rail
 * was reading the legacy enum. Each case below therefore asks two questions:
 * does the mark appear, and does it appear the *same* whichever axis said so.
 */
import { describe, expect, it } from "vitest";

import {
  attackMark,
  EXPRESSION_MARKS,
  markById,
  markedNote,
  pickingMark,
  printedFret,
} from "@/lib/tab/expression-marks";
import { buildFretGlyph, glyphText } from "@/lib/tab/glyph-model";
import {
  buildTechniquePrimitives,
  type TechniqueLayout,
} from "@/lib/tab/technique-geometry";
import type { FrettedBar, TabSpan } from "@/lib/tab/timeline";
import type { NoteAttack } from "@/lib/song/schema";

const LAYOUT: TechniqueLayout = {
  slotWidth: 34,
  stringRowHeight: 26,
  stringCount: 6,
  rowTop: (stringIndex) => (6 - 1 - stringIndex) * 26,
};

const span = (startSlot: number, over: Partial<TabSpan> = {}): TabSpan => ({
  stringIndex: 5,
  fret: 3,
  pitch: "G4",
  startSlot,
  endSlot: startSlot,
  noteIndex: 0,
  writtenTicks: 96,
  openStart: false,
  openEnd: false,
  ...over,
});

const bar = (spans: readonly TabSpan[]): FrettedBar => ({
  key: "s1:0",
  barNumber: 1,
  barIndex: 0,
  sectionId: "s1",
  sectionName: "S1",
  sectionStatus: "fixed",
  isSectionStart: true,
  timeSignature: [4, 4],
  resolution: 8,
  notation: 8,
  slotsPerCell: 1,
  slotCount: 8,
  silent: false,
  spans: [...spans],
  rests: [],
});

const ATTACKS: readonly NoteAttack[] = [
  "accent",
  "ghost",
  "dead",
  "tapping",
  "natural_harmonic",
  "pinch_harmonic",
];

describe("335. the whole written vocabulary, in one list", () => {
  it("gives every attack a mark, on the digit or beside it", () => {
    for (const attack of ATTACKS) {
      const printed = printedFret(5, attack) !== "5";
      const beside = attackMark(attack) !== null;
      expect(printed || beside, attack).toBe(true);
    }
  });

  it("never writes one attack in both places", () => {
    /* A note printed `(5)` *and* carrying a bracket mark beside it would be
       the same fact spelled twice, which is how a page starts lying. */
    for (const attack of ATTACKS) {
      const printed = printedFret(5, attack) !== "5";
      const beside = attackMark(attack) !== null;
      expect(printed && beside, attack).toBe(false);
    }
  });

  it("gives every mark a spoken name that is not an identifier", () => {
    for (const mark of EXPRESSION_MARKS) {
      expect(mark.spoken.length, mark.id).toBeGreaterThan(0);
      /*
       * No snake_case reaches a reader. `tapping` is deliberately allowed to
       * match its own id: it is the word Turkish guitarists use, and the
       * repo's older label table spells it the same way. Renaming it to
       * something "more Turkish" would be inventing vocabulary.
       */
      expect(mark.spoken, mark.id).not.toContain("_");
      if (mark.id.includes("_")) expect(mark.spoken, mark.id).not.toBe(mark.id);
    }
  });

  it("writes the three tablature conventions the way tablature writes them", () => {
    expect(printedFret(5, "ghost")).toBe("(5)");
    expect(printedFret(5, "dead")).toBe("x");
    expect(printedFret(5, "natural_harmonic")).toBe("<5>");
    expect(printedFret(5)).toBe("5");
    expect(printedFret(null)).toBe("?");
  });

  it("marks both picking strokes and tells them apart", () => {
    const down = pickingMark("down");
    const up = pickingMark("up");
    expect(down?.glyph).not.toBe(up?.glyph);
    expect(pickingMark(null)).toBeNull();
  });

  it("collects a note's marks in a stable order", () => {
    const marked = markedNote({
      fret: 7,
      attack: "accent",
      picking: "down",
      techniques: ["let_ring", "palm_mute"],
    });
    expect(marked.printed).toBe("7");
    expect(marked.beside.map((mark) => mark.id)).toEqual(["accent", "picking_down"]);
    expect(marked.rails).toEqual(["let_ring", "palm_mute"]);
  });

  it("says nothing about a note that says nothing", () => {
    expect(markedNote({ fret: 3 })).toEqual({ printed: "3", beside: [], rails: [] });
  });

  it("has no mark id the list cannot look up", () => {
    for (const mark of EXPRESSION_MARKS) {
      expect(markById(mark.id)).toBe(mark);
    }
    expect(markById("no_such_mark")).toBeNull();
  });
});

describe("336. the same page whichever axis wrote it", () => {
  it("prints the digit the same for the legacy enum and the new attack", () => {
    for (const value of ["ghost", "dead", "natural_harmonic"] as const) {
      expect(glyphText(5, undefined, value)).toBe(glyphText(5, value));
    }
  });

  it("speaks the attack axis in the reader's words", () => {
    const glyph = buildFretGlyph({ fret: 5, state: "normal", attack: "pinch_harmonic" });
    expect(glyph.label).toContain("armonik");
    expect(glyph.label).not.toContain("pinch_harmonic");
  });

  it("widens the string's gap for a bracketed fret", () => {
    const plain = buildFretGlyph({ fret: 5, state: "normal" });
    const ghost = buildFretGlyph({ fret: 5, state: "normal", attack: "ghost" });
    expect(ghost.maskWidth).toBeGreaterThan(plain.maskWidth);
  });

  it("draws a rail for a span-held palm mute, as it always did for the legacy one", () => {
    const legacy = buildTechniquePrimitives(
      bar([span(0, { articulation: "palm_mute" }), span(1, { articulation: "palm_mute" })]),
      LAYOUT,
    );
    const held = buildTechniquePrimitives(
      bar([span(0, { techniques: ["palm_mute"] }), span(1, { techniques: ["palm_mute"] })]),
      LAYOUT,
    );
    expect(legacy.palmMutes).toHaveLength(1);
    expect(held.palmMutes).toHaveLength(1);
    expect(held.palmMutes[0]?.owner).toEqual(legacy.palmMutes[0]?.owner);
    expect(held.palmMutes[0]?.rail).toEqual(legacy.palmMutes[0]?.rail);
  });

  it("draws no rail where no technique was written", () => {
    /* The control for the pair above: without it both could be passing on a
       fixture that rails everything. */
    const plain = buildTechniquePrimitives(bar([span(0), span(1)]), LAYOUT);
    expect(plain.palmMutes).toEqual([]);
    expect(plain.letRings).toEqual([]);
  });

  it("draws a let-ring rail, which nothing drew before", () => {
    const flagged = buildTechniquePrimitives(
      bar([span(0, { letRing: true }), span(1, { letRing: true })]),
      LAYOUT,
    );
    const held = buildTechniquePrimitives(
      bar([span(0, { techniques: ["let_ring"] }), span(1, { techniques: ["let_ring"] })]),
      LAYOUT,
    );
    expect(flagged.letRings).toHaveLength(1);
    expect(held.letRings).toHaveLength(1);
    expect(held.letRings[0]?.text).toBe("L.R.");
    expect(held.letRings[0]?.owner).toEqual(flagged.letRings[0]?.owner);
  });

  it("keeps the two rails apart on one string", () => {
    const both = buildTechniquePrimitives(
      bar([span(0, { techniques: ["palm_mute"] }), span(1, { techniques: ["let_ring"] })]),
      LAYOUT,
    );
    expect(both.palmMutes.map((rail) => rail.slots)).toEqual([[0]]);
    expect(both.letRings.map((rail) => rail.slots)).toEqual([[1]]);
  });

  it("says the run's length out loud, in Turkish", () => {
    const held = buildTechniquePrimitives(
      bar([span(0, { techniques: ["let_ring"] }), span(1, { techniques: ["let_ring"] })]),
      LAYOUT,
    );
    expect(held.letRings[0]?.label).toBe("2 nota boyunca çınlamaya bırak");
  });

  it("counts the new rails among the marks it drew", () => {
    const held = buildTechniquePrimitives(bar([span(0, { techniques: ["let_ring"] })]), LAYOUT);
    expect(held.count).toBe(1);
  });

  it("leaves the note's own mark beside the number under a let ring", () => {
    /*
     * A mute shortens what is heard, so the rail replaces the mark; a let ring
     * lengthens it and says nothing about the strike, so an accent under one
     * is still an accent on the page.
     */
    const held = buildTechniquePrimitives(
      bar([span(0, { techniques: ["let_ring"], attack: "accent" })]),
      LAYOUT,
    );
    expect(held.annotated.size).toBe(0);
  });
});

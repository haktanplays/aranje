/**
 * The grammar a guitarist already reads (2V-C.3 §2, §5).
 *
 * The founder's reference shows three behaviours: a bare slash for a slide
 * whose target is struck again, a slash under a slur for one continuous
 * sound, and two of them stacked when a shape moves. C.1 wrote `s/` for the
 * first, which is a private convention on a page whose job is to be readable
 * without one. These tests are the ban and the replacement.
 */
import { describe, expect, it } from "vitest";

import {
  buildTechniquePrimitives,
  type TechniqueLayout,
} from "@/lib/tab/technique-geometry";
import { connectionReading } from "@/lib/music/gesture-language";
import { resolveExpression } from "@/lib/music/expression-resolver";
import type { FrettedBar, TabSpan } from "@/lib/tab/timeline";
import type { NoteConnection } from "@/lib/song/schema";

const LAYOUT: TechniqueLayout = {
  slotWidth: 34,
  stringRowHeight: 26,
  stringCount: 6,
  rowTop: (stringIndex) => (6 - 1 - stringIndex) * 26,
};

const span = (
  startSlot: number,
  stringIndex: number,
  fret: number,
  pitch: string,
  connection?: NoteConnection,
): TabSpan => ({
  stringIndex,
  fret,
  pitch,
  startSlot,
  endSlot: startSlot,
  noteIndex: 0,
  writtenTicks: 96,
  openStart: false,
  openEnd: false,
  ...(connection === undefined ? {} : { connection }),
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

const geometryOf = (spans: readonly TabSpan[]) =>
  buildTechniquePrimitives(bar(spans), LAYOUT);

/** Two notes on one string, joined however the caller says. */
const pair = (connection: NoteConnection) => [
  span(0, 2, 5, "G3"),
  span(1, 2, 7, "A3", connection),
];

describe("115. one leaning stroke, and the slur is the difference", () => {
  it("draws a stroke for a shift slide and no arc", () => {
    const marks = geometryOf(pair({ kind: "shift_slide" })).slides;
    expect(marks).toHaveLength(1);
    expect(marks[0]!.slur).toBe(false);
    expect(marks[0]!.slurPath).toBe("");
  });

  it("draws the same stroke for a legato slide, with an arc", () => {
    const shift = geometryOf(pair({ kind: "shift_slide" })).slides[0]!;
    const legato = geometryOf(pair({ kind: "legato_slide" })).slides[0]!;
    /* The stroke itself is identical — that is the point of the grammar. */
    expect([legato.x1, legato.y1, legato.x2, legato.y2]).toEqual([
      shift.x1,
      shift.y1,
      shift.x2,
      shift.y2,
    ]);
    expect(legato.slur).toBe(true);
    expect(legato.slurPath.length).toBeGreaterThan(0);
  });

  it("leans by the sounding pitch, not the fret number", () => {
    /* The stroke follows the ear rather than the digits. */
    const mark = geometryOf([
      span(0, 2, 7, "A3"),
      span(1, 2, 5, "G3", { kind: "shift_slide" }),
    ]).slides[0]!;
    expect(mark.rising).toBe(false);
  });

  it("says which slide it is in words, without naming a field", () => {
    const shift = geometryOf(pair({ kind: "shift_slide" })).slides[0]!;
    const legato = geometryOf(pair({ kind: "legato_slide" })).slides[0]!;
    expect(legato.label).toContain("bağlı");
    expect(shift.label).toContain("yeniden vurulur");
    for (const label of [shift.label, legato.label]) {
      expect(label).not.toMatch(/shift_slide|legato_slide|connection|cent/);
    }
  });

  it("keeps the arc above the stroke, so it never sits on the string line", () => {
    const legato = geometryOf(pair({ kind: "legato_slide" })).slides[0]!;
    const ys = [...legato.slurPath.matchAll(/-?\d+(?:\.\d+)?/g)]
      .map((match) => Number(match[0]))
      .filter((_, index) => index % 2 === 1);
    expect(ys.length).toBeGreaterThan(0);
    /* Smaller y is higher on the page. */
    expect(Math.max(...ys)).toBeLessThan(Math.max(legato.y1, legato.y2));
  });

  it("writes no letter of our own anywhere in the reading", () => {
    for (const kind of ["shift_slide", "legato_slide"] as const) {
      const read = connectionReading(
        resolveExpression({ connection: { kind } }).connection,
        true,
      );
      expect(read.mark).toBe("/");
      expect(read.mark).not.toContain("s");
      expect(read.mark).not.toContain("L");
    }
  });

  it("still draws nothing at all for a hammer-on", () => {
    /* A join is not a slide. The leaning stroke has to mean one thing. */
    const marks = geometryOf(pair({ kind: "hammer_on" })).slides;
    expect(marks).toHaveLength(0);
  });
});

describe("116. a chain of slides is a chain of real transitions", () => {
  /** The reference's `4\\2\\0`: two descending legato slides in a row. */
  const chained = () => [
    span(0, 2, 4, "F#3"),
    span(1, 2, 2, "E3", { kind: "legato_slide" }),
    span(2, 2, 0, "D3", { kind: "legato_slide" }),
  ];

  it("draws two descending connectors, not one long line", () => {
    const marks = geometryOf(chained()).slides;
    expect(marks).toHaveLength(2);
    expect(marks.every((mark) => mark.rising === false)).toBe(true);
    /* Two separate strokes at two separate places. */
    expect(marks[0]!.x1).not.toBe(marks[1]!.x1);
  });

  it("keeps every step legato, so nothing in the middle is re-struck", () => {
    const marks = geometryOf(chained()).slides;
    expect(marks.every((mark) => mark.slur)).toBe(true);
    expect(marks.every((mark) => mark.slurPath.length > 0)).toBe(true);
  });

  it("keeps each connector inside its own pair of notes", () => {
    const marks = geometryOf(chained()).slides;
    const [first, second] = marks;
    expect(first!.owner.right).toBeLessThanOrEqual(second!.owner.right);
    expect(first!.x2).toBeLessThanOrEqual(second!.x1);
  });
});

describe("117. a shape moves as parallel strokes", () => {
  const shapeSong = () => [
    span(0, 2, 5, "G3"),
    span(0, 3, 5, "C4"),
    span(1, 2, 7, "A3", { kind: "shift_slide" }),
    span(1, 3, 7, "D4", { kind: "shift_slide" }),
  ];

  it("gives each moving string its own connector", () => {
    const marks = geometryOf(shapeSong()).slides;
    expect(marks).toHaveLength(2);
    expect(new Set(marks.map((mark) => mark.stringIndex)).size).toBe(2);
  });

  it("aligns them in the same travel window, so they read as one hand", () => {
    const marks = geometryOf(shapeSong()).slides;
    expect(marks[0]!.x1).toBe(marks[1]!.x1);
    expect(marks[0]!.x2).toBe(marks[1]!.x2);
  });

  it("keeps them on their own strings rather than one line over the chord", () => {
    const marks = geometryOf(shapeSong()).slides;
    expect(marks[0]!.y1).not.toBe(marks[1]!.y1);
  });

  it("leans them the same way, because a shape moves as one", () => {
    const marks = geometryOf(shapeSong()).slides;
    expect(new Set(marks.map((mark) => mark.rising)).size).toBe(1);
  });
});

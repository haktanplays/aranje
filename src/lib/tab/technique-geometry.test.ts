/**
 * The technique notation grammar, as geometry (Technique Notation Grammar v1).
 *
 * Everything a reader is meant to see about *how* a note is played is decided
 * here, before anything draws it: which notes belong to one gesture, where the
 * mark for that gesture goes, and how far it is allowed to reach. The render
 * layer places what these functions return and decides nothing.
 */
import { describe, expect, it } from "vitest";

import {
  annotationLane,
  buildTechniquePrimitives,
  digitBounds,
  ownerSlot,
  type TechniqueLayout,
} from "@/lib/tab/technique-geometry";
import type { FrettedBar, TabSpan } from "@/lib/tab/timeline";
import type { Articulation } from "@/lib/song/schema";

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
  articulation?: Articulation,
  endSlot = startSlot,
): TabSpan => ({
  stringIndex,
  fret,
  pitch,
  startSlot,
  endSlot,
  openStart: false,
  openEnd: false,
  ...(articulation === undefined ? {} : { articulation }),
});

const bar = (
  spans: readonly TabSpan[],
  extra: Partial<FrettedBar> = {},
): FrettedBar => ({
  key: "s1:0",
  barNumber: 1,
  barIndex: 0,
  sectionId: "s1",
  sectionName: "S1",
  sectionStatus: "fixed",
  isSectionStart: true,
  timeSignature: [4, 4],
  resolution: 8,
  slotCount: 8,
  silent: false,
  spans: [...spans],
  rests: [],
  ...extra,
});

/** `5 h 7 h 8 p 7 p 5` on one string: one gesture, four transitions. */
const RUN = bar([
  span(0, 2, 5, "C4"),
  span(1, 2, 7, "D4", "hammer_on"),
  span(2, 2, 8, "D#4", "hammer_on"),
  span(3, 2, 7, "D4", "pull_off"),
  span(4, 2, 5, "C4", "pull_off"),
]);

describe("the shared geometry contract", () => {
  it("takes the owner slot from the midpoints of the neighbouring onsets", () => {
    /*
     * A technique mark belongs to one note, so the room it may use is the room
     * between that note and the notes either side of it — not a fixed box, and
     * not the whole bar. The midpoints are what neither neighbour can dispute.
     */
    const slot = ownerSlot(RUN, RUN.spans[2] as TabSpan, LAYOUT);
    // Centres are 51, 85, 119; midpoints 68 and 102; then a 4px inset.
    expect(slot.left).toBe(72);
    expect(slot.right).toBe(98);
  });

  it("stops the outermost owner slots at the measure boundaries", () => {
    const first = ownerSlot(RUN, RUN.spans[0] as TabSpan, LAYOUT);
    const last = ownerSlot(RUN, RUN.spans[4] as TabSpan, LAYOUT);
    expect(first.left).toBe(4);
    expect(last.right).toBe(8 * 34 - 4);
  });

  it("keeps the annotation lane clear of both string lines", () => {
    /*
     * The lane lives in the gap that is already there between a string and the
     * one above it. It never opens that gap: the numbers here are derived from
     * the row height the staff already uses.
     */
    const lane = annotationLane(2, LAYOUT);
    const lineY = LAYOUT.rowTop(2) + 26 / 2;
    const above = LAYOUT.rowTop(3) + 26 / 2;
    expect(lane.bottom).toBeLessThanOrEqual(lineY - 4);
    expect(lane.top).toBeGreaterThanOrEqual(above + 4);
  });

  it("gives the top string a lane out of the staff's own top padding", () => {
    const lane = annotationLane(5, LAYOUT);
    const lineY = LAYOUT.rowTop(5) + 26 / 2;
    expect(lane.bottom).toBeLessThanOrEqual(lineY - 4);
    expect(lineY - lane.top).toBeLessThanOrEqual(26);
  });

  it("measures a digit's bounds from the glyph model, not from the slot", () => {
    const one = digitBounds(span(0, 2, 5, "C4"), LAYOUT);
    const two = digitBounds(span(0, 2, 12, "G4"), LAYOUT);
    expect(two.right - two.left).toBeGreaterThan(one.right - one.left);
    expect((one.left + one.right) / 2).toBe(17);
  });
});

describe("hammer-on and pull-off read as one gesture", () => {
  it("draws one arc over a whole run, source note included", () => {
    const { legato } = buildTechniquePrimitives(RUN, LAYOUT);
    expect(legato).toHaveLength(1);
    expect(legato[0]?.slots).toEqual([0, 1, 2, 3, 4]);
  });

  it("reaches slightly past the first and last note of the run", () => {
    const { legato } = buildTechniquePrimitives(RUN, LAYOUT);
    const phrase = legato[0];
    expect(phrase?.extent.left).toBeLessThan(17);
    expect(phrase?.extent.right).toBeGreaterThan(4 * 34 + 17);
  });

  it("puts an H or a P at each transition's own centre and nowhere else", () => {
    const { legato } = buildTechniquePrimitives(RUN, LAYOUT);
    const marks = legato[0]?.marks ?? [];
    expect(marks.map((mark) => mark.text)).toEqual(["H", "H", "P", "P"]);
    expect(marks.map((mark) => mark.x)).toEqual([34, 68, 102, 136]);
  });

  it("draws no endpoints, hooks or dots", () => {
    const { legato } = buildTechniquePrimitives(RUN, LAYOUT);
    expect(legato[0]).not.toHaveProperty("endpoints");
    // One curve, not four: a single move and a single quadratic.
    expect((legato[0]?.path.match(/Q/g) ?? []).length).toBe(1);
  });

  it("breaks the run where the string is picked again", () => {
    const picked = bar([
      span(0, 2, 5, "C4"),
      span(1, 2, 7, "D4", "hammer_on"),
      span(2, 2, 9, "E4"),
      span(3, 2, 10, "F4", "hammer_on"),
    ]);
    const { legato } = buildTechniquePrimitives(picked, LAYOUT);
    expect(legato.map((phrase) => phrase.slots)).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it("breaks the run over a rest", () => {
    const rested = bar([
      span(0, 2, 5, "C4"),
      span(2, 2, 7, "D4", "hammer_on"),
    ]);
    expect(buildTechniquePrimitives(rested, LAYOUT).legato).toEqual([]);
  });

  it("breaks the run at a change of string", () => {
    const crossed = bar([
      span(0, 2, 5, "C4"),
      span(1, 3, 7, "G4", "hammer_on"),
    ]);
    expect(buildTechniquePrimitives(crossed, LAYOUT).legato).toEqual([]);
  });

  it("still believes the sounding pitch over the fret number", () => {
    const wrong = bar([
      span(0, 1, 5, "B3"),
      span(1, 1, 7, "A3", "hammer_on"),
    ]);
    expect(buildTechniquePrimitives(wrong, LAYOUT).legato).toEqual([]);
  });

  it("draws nothing across a bar line", () => {
    const carried = bar([
      { ...span(0, 2, 5, "C4"), openStart: true },
      span(1, 2, 7, "D4", "hammer_on"),
    ]);
    expect(buildTechniquePrimitives(carried, LAYOUT).legato).toEqual([]);
  });
});

describe("a slide is a movement between two numbers", () => {
  const rising = bar([span(0, 2, 5, "C4"), span(1, 2, 7, "D4", "slide")]);
  const falling = bar([span(0, 2, 7, "D4"), span(1, 2, 5, "C4", "slide")]);

  it("leaves both fret digits on their own string line", () => {
    const { slides } = buildTechniquePrimitives(rising, LAYOUT);
    const lineY = LAYOUT.rowTop(2) + 13;
    const mark = slides[0];
    expect(mark).toBeDefined();
    // The connector tilts; the digits it joins are untouched, so its midpoint
    // sits exactly on the line the two numbers are written on.
    expect(((mark?.y1 ?? 0) + (mark?.y2 ?? 0)) / 2).toBe(lineY);
  });

  it("leans up for a rise and down for a fall", () => {
    const up = buildTechniquePrimitives(rising, LAYOUT).slides[0];
    const down = buildTechniquePrimitives(falling, LAYOUT).slides[0];
    expect(up?.rising).toBe(true);
    expect(down?.rising).toBe(false);
    expect((up?.y2 ?? 0) < (up?.y1 ?? 0)).toBe(true);
    expect((down?.y2 ?? 0) > (down?.y1 ?? 0)).toBe(true);
  });

  it("never crosses either numeral", () => {
    const { slides } = buildTechniquePrimitives(rising, LAYOUT);
    const from = digitBounds(rising.spans[0] as TabSpan, LAYOUT);
    const to = digitBounds(rising.spans[1] as TabSpan, LAYOUT);
    expect(slides[0]?.x1).toBeGreaterThanOrEqual(from.right);
    expect(slides[0]?.x2).toBeLessThanOrEqual(to.left);
  });

  it("writes no letter and no sentence into the tab", () => {
    const { slides } = buildTechniquePrimitives(rising, LAYOUT);
    expect(slides[0]).not.toHaveProperty("text");
    expect(slides[0]?.label).not.toMatch(/[Ss]/);
  });
});

describe("a bend says its amount in words, not in length", () => {
  const half = bar([span(0, 2, 7, "D4", "bend_half")]);
  const full = bar([span(0, 2, 7, "D4", "bend_full")]);

  it("draws the same arrow whatever the amount is", () => {
    const a = buildTechniquePrimitives(half, LAYOUT).bends[0];
    const b = buildTechniquePrimitives(full, LAYOUT).bends[0];
    expect(a?.path).toBe(b?.path);
    expect(a?.head).toBe(b?.head);
    expect(a?.amount).toBe("½");
    expect(b?.amount).toBe("1");
  });

  it("stays inside its own owner slot and annotation lane", () => {
    const crowded = bar([
      span(0, 2, 7, "D4", "bend_full"),
      span(1, 2, 5, "C4"),
    ]);
    const mark = buildTechniquePrimitives(crowded, LAYOUT).bends[0];
    const slot = ownerSlot(crowded, crowded.spans[0] as TabSpan, LAYOUT);
    const lane = annotationLane(2, LAYOUT);
    const xs = [...(mark?.path.matchAll(/-?\d+(?:\.\d+)?/g) ?? [])].map((m) =>
      Number(m[0]),
    );
    const points = xs.filter((_, index) => index % 2 === 0);
    const ys = xs.filter((_, index) => index % 2 === 1);
    expect(Math.min(...points)).toBeGreaterThanOrEqual(slot.left);
    expect(Math.max(...points)).toBeLessThanOrEqual(slot.right);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(lane.top);
  });

  it("does not overflow onto the neighbouring string", () => {
    const mark = buildTechniquePrimitives(full, LAYOUT).bends[0];
    const above = LAYOUT.rowTop(3) + 13;
    const ys = [...(mark?.path.matchAll(/-?\d+(?:\.\d+)?/g) ?? [])]
      .map((m) => Number(m[0]))
      .filter((_, index) => index % 2 === 1);
    expect(Math.min(...ys)).toBeGreaterThan(above);
  });
});

describe("vibrato is a wave, not a word", () => {
  it("grows with the note it is over", () => {
    const short = bar([span(0, 2, 7, "D4", "vibrato")]);
    const long = bar([span(0, 2, 7, "D4", "vibrato", 5)]);
    const a = buildTechniquePrimitives(short, LAYOUT).vibratos[0];
    const b = buildTechniquePrimitives(long, LAYOUT).vibratos[0];
    const width = (mark?: { extent: { left: number; right: number } }) =>
      (mark?.extent.right ?? 0) - (mark?.extent.left ?? 0);
    expect(width(b)).toBeGreaterThan(width(a));
  });

  it("is clamped by the owner slot rather than by its own duration", () => {
    const crowded = bar([
      span(0, 2, 7, "D4", "vibrato", 5),
      span(1, 2, 5, "C4"),
    ]);
    const mark = buildTechniquePrimitives(crowded, LAYOUT).vibratos[0];
    const slot = ownerSlot(crowded, crowded.spans[0] as TabSpan, LAYOUT);
    const next = digitBounds(crowded.spans[1] as TabSpan, LAYOUT);
    expect(mark?.extent.right).toBeLessThanOrEqual(slot.right);
    expect(mark?.extent.right).toBeLessThan(next.left);
  });

  it("says nothing in letters", () => {
    const { vibratos } = buildTechniquePrimitives(
      bar([span(0, 2, 7, "D4", "vibrato")]),
      LAYOUT,
    );
    expect(vibratos[0]).not.toHaveProperty("text");
    expect(vibratos[0]?.path.startsWith("M")).toBe(true);
  });
});

describe("palm mute is a range, not a mark per note", () => {
  const muted = bar([
    span(0, 2, 5, "C4", "palm_mute"),
    span(1, 2, 5, "C4", "palm_mute"),
    span(2, 2, 5, "C4", "palm_mute"),
    span(3, 2, 7, "D4"),
  ]);

  it("writes PM once and draws one rail for the whole range", () => {
    const { palmMutes } = buildTechniquePrimitives(muted, LAYOUT);
    expect(palmMutes).toHaveLength(1);
    expect(palmMutes[0]?.slots).toEqual([0, 1, 2]);
    expect(palmMutes[0]?.label.startsWith("PM")).toBe(false);
  });

  it("ends before the first unmuted note's own slot", () => {
    const { palmMutes } = buildTechniquePrimitives(muted, LAYOUT);
    const open = ownerSlot(muted, muted.spans[3] as TabSpan, LAYOUT);
    expect(palmMutes[0]?.rail.right).toBeLessThan(open.left);
    expect(palmMutes[0]?.capX).toBeLessThan(open.left);
  });

  it("breaks the range at a rest and at a change of string", () => {
    const broken = bar([
      span(0, 2, 5, "C4", "palm_mute"),
      span(2, 2, 5, "C4", "palm_mute"),
      span(3, 3, 5, "G4", "palm_mute"),
    ]);
    const { palmMutes } = buildTechniquePrimitives(broken, LAYOUT);
    expect(palmMutes.map((range) => range.slots)).toEqual([[0], [2], [3]]);
  });
});

describe("the primitives are a statement about the song and nothing else", () => {
  it("does not touch the bar it was given", () => {
    const before = JSON.stringify(RUN);
    buildTechniquePrimitives(RUN, LAYOUT);
    expect(JSON.stringify(RUN)).toBe(before);
  });

  it("gives the same answer five times running", () => {
    const shape = () => {
      const primitives = buildTechniquePrimitives(RUN, LAYOUT);
      // The set is spelled out rather than stringified: `JSON.stringify` turns
      // a `Set` into `{}`, which would make this pass without comparing it.
      return JSON.stringify({
        ...primitives,
        annotated: [...primitives.annotated].sort(),
      });
    };
    const runs = Array.from({ length: 5 }, shape);
    expect(new Set(runs).size).toBe(1);
    expect(runs[0]).toContain("2:0");
  });

  it("claims a note only where a mark was really drawn", () => {
    /*
     * A hammer-on with nothing before it on the string cannot be drawn as an
     * arc, and the note must not silently lose its articulation as a result:
     * it stays unclaimed, so the small character mark beside the number is
     * still the reader's warning that something is written there.
     */
    const orphan = bar([span(0, 2, 7, "D4", "hammer_on")]);
    const primitives = buildTechniquePrimitives(orphan, LAYOUT);
    expect(primitives.count).toBe(0);
    expect(primitives.annotated.has("2:0")).toBe(false);

    const drawn = buildTechniquePrimitives(RUN, LAYOUT);
    expect([...drawn.annotated].sort()).toEqual([
      "2:0",
      "2:1",
      "2:2",
      "2:3",
      "2:4",
    ]);
  });

  it("draws nothing at all over a silent bar", () => {
    const quiet = buildTechniquePrimitives(bar([], { silent: true }), LAYOUT);
    expect(quiet.count).toBe(0);
  });

  it("invents nothing for a technique the contract cannot express", () => {
    /*
     * Let ring, natural and pinch harmonics and the tremolo arm are visual
     * spec only this round: the Song Contract has no field for them, and
     * borrowing a tie, a vibrato or a bend to stand in for one would put a
     * claim on the page that the data cannot support.
     */
    const plain = buildTechniquePrimitives(
      bar([span(0, 2, 5, "C4", "sustain"), span(1, 2, 7, "D4", "staccato")]),
      LAYOUT,
    );
    expect(plain.count).toBe(0);
  });
});

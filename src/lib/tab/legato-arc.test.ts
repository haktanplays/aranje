/**
 * The hammer-on and pull-off arcs, as geometry (2S-A §4).
 */
import { describe, expect, it } from "vitest";

import { buildLegatoArcs, type ArcLayout } from "@/lib/tab/legato-arc";
import type { FrettedBar, TabSpan } from "@/lib/tab/timeline";
import type { Articulation } from "@/lib/song/schema";

const LAYOUT: ArcLayout = {
  slotWidth: 34,
  stringRowHeight: 26,
  rowTop: (stringIndex) => stringIndex * 26,
};

const span = (
  startSlot: number,
  stringIndex: number,
  fret: number,
  pitch: string,
  articulation?: Articulation,
): TabSpan => ({
  stringIndex,
  fret,
  pitch,
  startSlot,
  endSlot: startSlot,
  openStart: false,
  openEnd: false,
  ...(articulation === undefined ? {} : { articulation }),
});

const bar = (spans: readonly TabSpan[], silent = false): FrettedBar => ({
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
  silent,
  spans: [...spans],
  rests: [],
});

describe("297. an arc is drawn only where a slur really is", () => {
  it("draws one arc for a rising hammer-on on the same string", () => {
    const arcs = buildLegatoArcs(
      bar([span(0, 1, 5, "A3"), span(1, 1, 7, "B3", "hammer_on")]),
      LAYOUT,
    );
    expect(arcs).toHaveLength(1);
    expect(arcs[0]).toMatchObject({ kind: "hammer_on", mark: "H", fromSlot: 0, toSlot: 1 });
  });

  it("draws a pull-off's arc with a P", () => {
    const arcs = buildLegatoArcs(
      bar([span(0, 1, 7, "B3"), span(1, 1, 5, "A3", "pull_off")]),
      LAYOUT,
    );
    expect(arcs[0]?.mark).toBe("P");
  });

  it("draws nothing when the direction disagrees with the sounding pitch", () => {
    // A "hammer-on" that goes down is refused by the planner; an arc that
    // claimed otherwise would disagree with what is heard.
    const arcs = buildLegatoArcs(
      bar([span(0, 1, 7, "B3"), span(1, 1, 5, "A3", "hammer_on")]),
      LAYOUT,
    );
    expect(arcs).toEqual([]);
  });

  it("draws nothing when the note before it is on another string", () => {
    const arcs = buildLegatoArcs(
      bar([span(0, 2, 5, "E3"), span(1, 1, 7, "B3", "hammer_on")]),
      LAYOUT,
    );
    expect(arcs).toEqual([]);
  });

  it("draws nothing when there is no note before it in this bar", () => {
    const arcs = buildLegatoArcs(bar([span(0, 1, 7, "B3", "hammer_on")]), LAYOUT);
    expect(arcs).toEqual([]);
  });

  it("draws nothing in a bar the track is not written in", () => {
    expect(buildLegatoArcs(bar([], true), LAYOUT)).toEqual([]);
  });

  it("never reaches past the bar it is in", () => {
    // The model only ever sees one bar's spans, so a group cannot cross the
    // bar line — the same rule the beams keep.
    const arcs = buildLegatoArcs(
      bar([span(6, 1, 5, "A3"), span(7, 1, 7, "B3", "hammer_on")]),
      LAYOUT,
    );
    expect(arcs).toHaveLength(1);
    expect(arcs[0]!.toSlot).toBeLessThan(8);
  });
});

describe("298. consecutive arcs stay readable", () => {
  const run = () =>
    buildLegatoArcs(
      bar([
        span(0, 1, 5, "A3"),
        span(1, 1, 7, "B3", "hammer_on"),
        span(2, 1, 8, "C4", "hammer_on"),
        span(3, 1, 7, "B3", "pull_off"),
      ]),
      LAYOUT,
    );

  it("draws one arc per link rather than one capsule over the run", () => {
    expect(run()).toHaveLength(3);
  });

  it("alternates their height so two in a row do not merge", () => {
    const rises = run().map((arc) => arc.rise);
    expect(rises[0]).not.toBe(rises[1]);
    expect(rises[1]).not.toBe(rises[2]);
  });

  it("keeps every arc above the string it belongs to", () => {
    const y = LAYOUT.rowTop(1) + LAYOUT.stringRowHeight / 2;
    for (const arc of run()) {
      expect(arc.markY).toBeLessThan(y);
      for (const point of arc.endpoints) expect(point.y).toBeLessThanOrEqual(y);
    }
  });

  it("stops short of both fret numbers", () => {
    const arc = run()[0]!;
    const fromCentre = 0 * LAYOUT.slotWidth + LAYOUT.slotWidth / 2;
    const toCentre = 1 * LAYOUT.slotWidth + LAYOUT.slotWidth / 2;
    expect(arc.endpoints[0]!.x).toBeGreaterThan(fromCentre);
    expect(arc.endpoints[1]!.x).toBeLessThan(toCentre);
  });

  it("gives both ends a point a selection can show", () => {
    for (const arc of run()) expect(arc.endpoints).toHaveLength(2);
  });

  it("names each arc by the movement, in Turkish", () => {
    expect(run()[0]!.label).toBe("5. perdeden 7. perdeye çekiç");
    expect(run()[2]!.label).toBe("8. perdeden 7. perdeye koparma");
  });

  it("never puts an identifier in a name", () => {
    for (const arc of run()) {
      expect(arc.label).not.toMatch(/hammer_on|pull_off|slot|tick/i);
    }
  });
});

describe("299. an arc is a statement, not a control", () => {
  it("gives a path a view can draw and nothing a view has to decide", () => {
    const arc = buildLegatoArcs(
      bar([span(0, 1, 5, "A3"), span(1, 1, 7, "B3", "hammer_on")]),
      LAYOUT,
    )[0]!;
    expect(arc.path).toMatch(/^M [\d.]+ [\d.]+ Q [\d.]+ [\d.]+ [\d.]+ [\d.]+$/);
  });

  it("leaves bends, slides and ties to their own marks", () => {
    // A slide is a chain too, but its mark is beside the digit rather than an
    // arc over it — nothing here can merge with it.
    const arcs = buildLegatoArcs(
      bar([span(0, 1, 5, "A3"), span(1, 1, 7, "B3", "slide")]),
      LAYOUT,
    );
    expect(arcs).toEqual([]);
  });

  it("is the same arc on both surfaces, because there is one model", () => {
    const written = bar([span(0, 1, 5, "A3"), span(1, 1, 7, "B3", "hammer_on")]);
    expect(buildLegatoArcs(written, LAYOUT)).toEqual(
      buildLegatoArcs(written, LAYOUT),
    );
  });
});

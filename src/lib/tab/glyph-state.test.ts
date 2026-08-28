/**
 * What a fret number's *state* is once the technique layer has drawn (K-59).
 *
 * The arc over a legato run and the underline under each of its notes were
 * saying the same thing twice, and four underlines in a row read closer to a
 * selection than to a slur. The underline is now the fallback: it appears
 * exactly where the geometry drew nothing.
 */
import { describe, expect, it } from "vitest";

import { glyphStateFor, legatoNotes } from "@/lib/tab/glyph-state";
import {
  buildTechniquePrimitives,
  techniqueNoteKey,
  type TechniqueLayout,
} from "@/lib/tab/technique-geometry";
import { articulationMark } from "@/components/workspace/ArticulationGlyph";
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
): TabSpan => ({
  stringIndex,
  fret,
  pitch,
  startSlot,
  endSlot: startSlot,
  writtenTicks: 96,
  openStart: false,
  openEnd: false,
  ...(articulation === undefined ? {} : { articulation }),
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
  slotCount: 8,
  silent: false,
  spans: [...spans],
  rests: [],
});

/** Every onset's drawn state, the way the bar block derives it. */
function statesOf(source: FrettedBar, selected = new Set<number>()) {
  const primitives = buildTechniquePrimitives(source, LAYOUT);
  const arc = legatoNotes(primitives);
  return {
    primitives,
    arc,
    notes: source.spans.map((entry) => {
      const key = techniqueNoteKey(entry.stringIndex, entry.startSlot);
      const state = glyphStateFor({
        ...(entry.articulation === undefined
          ? {}
          : { articulation: entry.articulation }),
        selected: selected.has(entry.startSlot),
        underArc: arc.has(key),
      });
      return {
        slot: entry.startSlot,
        state,
        // The character beside the number, shown only where nothing was drawn.
        mark:
          entry.articulation && !primitives.annotated.has(key)
            ? articulationMark(entry.articulation)
            : null,
      };
    }),
  };
}

const RUN = bar([
  span(0, 2, 5, "C4"),
  span(1, 2, 7, "D4", "hammer_on"),
  span(2, 2, 8, "D#4", "hammer_on"),
  span(3, 2, 7, "D4", "pull_off"),
  span(4, 2, 5, "C4", "pull_off"),
]);

describe("a drawn slur says it once", () => {
  it("draws one arc with the right marks and no underline under it", () => {
    const { primitives, notes } = statesOf(RUN);
    expect(primitives.legato).toHaveLength(1);
    expect(primitives.legato[0]?.marks.map((mark) => mark.text)).toEqual([
      "H",
      "H",
      "P",
      "P",
    ]);
    expect(notes.filter((note) => note.state === "legato")).toHaveLength(0);
    expect(notes.every((note) => note.state === "normal")).toBe(true);
    expect(notes.every((note) => note.mark === null)).toBe(true);
  });

  it("leaves an orphan hammer-on its own small mark", () => {
    /*
     * Nothing on the string to hammer from, so there is no arc to draw. The
     * note keeps the character beside the number and the underline that says
     * something is written here — otherwise a written articulation the tab
     * cannot honour would simply disappear.
     */
    const { primitives, notes } = statesOf(bar([span(0, 2, 7, "D4", "hammer_on")]));
    expect(primitives.legato).toHaveLength(0);
    expect(notes[0]?.state).toBe("legato");
    expect(notes[0]?.mark).toBe("h");
  });

  it("leaves an orphan pull-off its own small mark", () => {
    const { primitives, notes } = statesOf(bar([span(0, 2, 7, "D4", "pull_off")]));
    expect(primitives.legato).toHaveLength(0);
    expect(notes[0]?.state).toBe("legato");
    expect(notes[0]?.mark).toBe("p");
  });

  it("does not change what an unplayable link looks like", () => {
    /*
     * Frets climb, pitch falls: the pair does not move the way a hammer-on
     * claims, so the geometry refuses it — exactly as before this round. The
     * note keeps both cues, and the validator remains the thing that explains
     * why (spec 10.3).
     */
    const wrong = bar([span(0, 1, 5, "B3"), span(1, 1, 7, "A3", "hammer_on")]);
    const { primitives, notes } = statesOf(wrong);
    expect(primitives.legato).toEqual([]);
    expect(notes[1]?.state).toBe("legato");
    expect(notes[1]?.mark).toBe("h");
  });

  it("never leaves a slurred note with neither cue", () => {
    /*
     * The invariant that makes the suppression safe: a note is either under a
     * drawn arc or carries its own mark. Never both, and never neither — so
     * removing the layer from the page can hide a mark, but can never make a
     * note that was already silent about itself.
     */
    for (const source of [
      RUN,
      bar([span(0, 2, 7, "D4", "hammer_on")]),
      bar([span(0, 2, 5, "C4"), span(1, 2, 7, "D4", "hammer_on"), span(3, 2, 9, "E4", "pull_off")]),
    ]) {
      const { arc, notes } = statesOf(source);
      for (const note of notes) {
        const slurred = source.spans.find(
          (entry) => entry.startSlot === note.slot,
        )?.articulation;
        if (slurred !== "hammer_on" && slurred !== "pull_off") continue;
        const covered = arc.has(techniqueNoteKey(2, note.slot));
        expect(covered !== (note.mark !== null)).toBe(true);
      }
    }
  });

  it("suppresses nothing but the legato underline", () => {
    /*
     * A slide, a bend, a vibrato and a palm mute are all in `annotated` too.
     * None of them was ever drawn as a `legato` glyph state, and none of them
     * may start being suppressed by a rule about slurs.
     */
    for (const articulation of [
      "slide",
      "bend_half",
      "bend_full",
      "vibrato",
      "palm_mute",
      "accent",
    ] as const) {
      expect(
        glyphStateFor({ articulation, selected: false, underArc: true }),
      ).toBe("normal");
    }
    expect(
      glyphStateFor({ articulation: "palm_mute", selected: true, underArc: true }),
    ).toBe("selected");
  });

  it("keeps the selection ahead of every other state", () => {
    const { notes } = statesOf(RUN, new Set([2]));
    expect(notes[2]?.state).toBe("selected");
    expect(notes[1]?.state).toBe("normal");
  });

  it("gives the same answer five times running", () => {
    const shape = () =>
      JSON.stringify(statesOf(RUN).notes) +
      JSON.stringify([...legatoNotes(buildTechniquePrimitives(RUN, LAYOUT))].sort());
    expect(new Set(Array.from({ length: 5 }, shape)).size).toBe(1);
  });

  it("names the notes a drawn arc really covers, and no others", () => {
    const primitives = buildTechniquePrimitives(RUN, LAYOUT);
    expect([...legatoNotes(primitives)].sort()).toEqual([
      "2:0",
      "2:1",
      "2:2",
      "2:3",
      "2:4",
    ]);
    // A bend is annotated but is not a slur, so it is not in this set.
    const bent = buildTechniquePrimitives(
      bar([span(0, 2, 7, "D4", "bend_full")]),
      LAYOUT,
    );
    expect(bent.annotated.size).toBe(1);
    expect(legatoNotes(bent).size).toBe(0);
  });
});

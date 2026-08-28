import { describe, expect, it } from "vitest";

import { beatSlots, buildRhythmTail, type TailInput } from "@/lib/tab/rhythm-tail";
import type { Resolution, TimeSignature } from "@/lib/song/schema";
import type { TabSpan } from "@/lib/tab/timeline";

const span = (
  startSlot: number,
  writtenTicks: number,
  over: Partial<TabSpan> = {},
): TabSpan => ({
  stringIndex: 0,
  fret: 0,
  pitch: "E2",
  startSlot,
  endSlot: startSlot,
  writtenTicks,
  openStart: false,
  openEnd: false,
  ...over,
});

const tail = (
  spans: readonly TabSpan[],
  over: Partial<TailInput> = {},
): ReturnType<typeof buildRhythmTail> =>
  buildRhythmTail({
    spans,
    restSlots: [],
    timeSignature: [4, 4] as TimeSignature,
    resolution: 16 as Resolution,
    slotCount: 16,
    ...over,
  });

const at = (result: ReturnType<typeof buildRhythmTail>, slot: number) =>
  result.notes.find((note) => note.slotIndex === slot);

describe("beatSlots — grouping comes from the meter", () => {
  it("puts four beats in 4/4", () => {
    expect(beatSlots([4, 4], 16, 16)).toEqual([0, 4, 8, 12]);
  });

  it("puts three in 3/4", () => {
    expect(beatSlots([3, 4], 16, 12)).toEqual([0, 4, 8]);
  });

  /* 6/8 is two dotted beats, not six eighths and not four of anything. */
  it("puts two dotted beats in 6/8", () => {
    expect(beatSlots([6, 8], 16, 12)).toEqual([0, 6]);
  });

  it("counts in thirty-seconds when the bar is written in them", () => {
    expect(beatSlots([4, 4], 32, 32)).toEqual([0, 8, 16, 24]);
  });
});

describe("values, dots and stems", () => {
  it("names a quarter a quarter and gives it a stem and no beams", () => {
    const note = at(tail([span(0, 192)]), 0);
    expect(note).toMatchObject({ beams: 0, flags: 0, dots: 0, stem: true });
    expect(note?.value).toMatchObject({ base: "quarter", modifier: "plain" });
  });

  it("gives a whole note no stem at all", () => {
    expect(at(tail([span(0, 768)]), 0)).toMatchObject({ stem: false, beams: 0 });
  });

  it("marks a dotted eighth as dotted and still gives it one beam", () => {
    const note = at(tail([span(0, 144)]), 0);
    expect(note).toMatchObject({ dots: 1, beams: 1 });
    expect(note?.value).toMatchObject({ base: "eighth", modifier: "dotted" });
  });

  it("gives a sixteenth two beams and a thirty-second three", () => {
    expect(at(tail([span(0, 48)]), 0)?.beams).toBe(2);
    expect(at(tail([span(0, 24)], { resolution: 32, slotCount: 32 }), 0)?.beams).toBe(3);
  });

  /*
   * Five sixteenths is not a note value; it is a quarter tied to a sixteenth.
   * The tail draws the quarter and says a tie follows rather than rounding to
   * something a stem can hold.
   */
  it("draws the first value of a tie chain and says a tie follows", () => {
    const note = at(tail([span(0, 240)]), 0);
    expect(note).toMatchObject({ tiedTo: true, ticks: 192 });
    expect(note?.value).toMatchObject({ base: "quarter" });
  });

  it("says nothing at all about a duration the vocabulary cannot write", () => {
    expect(at(tail([span(0, 7)]), 0)).toMatchObject({
      value: null,
      beams: 0,
      stem: false,
    });
  });
});

describe("a chord is one rhythm", () => {
  it("gives a six-string chord one entry, not six", () => {
    const chord = [0, 1, 2, 3, 4, 5].map((string) =>
      span(0, 192, { stringIndex: string }),
    );
    const result = tail(chord);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]).toMatchObject({ ticks: 192, mixed: false });
  });

  /* Voices of different lengths are a second voice, and are reported as one. */
  it("takes the shortest voice and says the stack disagreed", () => {
    const result = tail([span(0, 384), span(0, 96, { stringIndex: 3 })]);
    expect(result.notes[0]).toMatchObject({ ticks: 96, mixed: true });
  });

  it("does not count a note carried in from the previous bar as an onset", () => {
    const result = tail([span(0, 192, { openStart: true }), span(4, 192)]);
    expect(result.notes.map((note) => note.slotIndex)).toEqual([4]);
  });
});

describe("beams", () => {
  const four16 = [span(0, 48), span(1, 48), span(2, 48), span(3, 48)];

  it("runs one primary beam across a beat of sixteenths", () => {
    const result = tail(four16);
    const primary = result.beams.filter((beam) => beam.level === 1);
    expect(primary).toEqual([{ level: 1, fromSlot: 0, toSlot: 3, hook: null, notes: 4 }]);
  });

  it("runs the second beam across all four as well", () => {
    const result = tail(four16);
    expect(result.beams.filter((beam) => beam.level === 2)).toEqual([
      { level: 2, fromSlot: 0, toSlot: 3, hook: null, notes: 4 },
    ]);
  });

  /*
   * The dotted-eighth-and-sixteenth figure. One beam joins them; the second
   * belongs to the sixteenth alone, and a beam that only one note carries is
   * a hook pointing back at the note it belongs with.
   */
  it("hooks a second beam that only one of the pair carries", () => {
    const result = tail([span(0, 144), span(3, 48)]);
    expect(result.beams).toEqual([
      { level: 1, fromSlot: 0, toSlot: 3, hook: null, notes: 2 },
      { level: 2, fromSlot: 3, toSlot: 3, hook: "left", notes: 1 },
    ]);
  });

  it("points the hook forward when it is the group's first note", () => {
    const result = tail([span(0, 48), span(1, 144)]);
    expect(result.beams).toContainEqual({
      level: 2,
      fromSlot: 0,
      toSlot: 0,
      hook: "right",
      notes: 1,
    });
  });

  /* A beam may not be drawn over silence, or across a beat line. */
  it("breaks the beam where the notes stop being contiguous", () => {
    const result = tail([span(0, 48), span(2, 48), span(3, 48)]);
    expect(result.beams.filter((beam) => beam.level === 1)).toEqual([
      { level: 1, fromSlot: 2, toSlot: 3, hook: null, notes: 2 },
    ]);
  });

  it("breaks the beam at a beat line even when the notes are contiguous", () => {
    const result = tail([span(2, 48), span(3, 48), span(4, 48), span(5, 48)]);
    const primary = result.beams.filter((beam) => beam.level === 1);
    expect(primary).toEqual([
      { level: 1, fromSlot: 2, toSlot: 3, hook: null, notes: 2 },
      { level: 1, fromSlot: 4, toSlot: 5, hook: null, notes: 2 },
    ]);
  });

  /*
   * Eight thirty-seconds in one beat get an unbroken primary beam and their
   * secondaries broken at the half beat, which is how a copyist writes them
   * and how a reader counts them.
   */
  it("breaks the secondary beams of an over-long group at the half beat", () => {
    const spans = Array.from({ length: 8 }, (_, index) => span(index, 24));
    const result = tail(spans, { resolution: 32, slotCount: 32 });
    expect(result.beams.filter((beam) => beam.level === 1)).toEqual([
      { level: 1, fromSlot: 0, toSlot: 7, hook: null, notes: 8 },
    ]);
    expect(result.beams.filter((beam) => beam.level === 2)).toEqual([
      { level: 2, fromSlot: 0, toSlot: 3, hook: null, notes: 4 },
      { level: 2, fromSlot: 4, toSlot: 7, hook: null, notes: 4 },
    ]);
  });

  it("gives a lone eighth flags of its own rather than leaving it bare", () => {
    const result = tail([span(0, 96), span(4, 192)]);
    expect(at(result, 0)).toMatchObject({ flags: 1, beams: 1 });
    expect(at(result, 4)).toMatchObject({ flags: 0 });
  });

  it("takes the flags off a note once a beam has taken it in", () => {
    const result = tail([span(0, 48), span(1, 48)]);
    expect(result.notes.every((note) => note.flags === 0)).toBe(true);
  });
});

describe("tuplets", () => {
  it("brackets three eighth triplets and calls them three", () => {
    const spans = [span(0, 64), span(1, 64), span(2, 64)];
    const result = tail(spans, { resolution: 12, slotCount: 12 });
    expect(result.tuplets).toEqual([{ fromSlot: 0, toSlot: 2, count: 3 }]);
  });

  it("brackets each group of three separately", () => {
    const spans = Array.from({ length: 6 }, (_, index) => span(index, 64));
    const result = tail(spans, { resolution: 12, slotCount: 12 });
    expect(result.tuplets).toEqual([
      { fromSlot: 0, toSlot: 2, count: 3 },
      { fromSlot: 3, toSlot: 5, count: 3 },
    ]);
  });

  it("brackets nothing at all when the notes are not triplets", () => {
    expect(tail([span(0, 48), span(1, 48), span(2, 48)]).tuplets).toEqual([]);
  });

  it("says nothing about a run of triplets it cannot group in threes", () => {
    const spans = [span(0, 64), span(1, 64)];
    expect(tail(spans, { resolution: 12, slotCount: 12 }).tuplets).toEqual([]);
  });
});

describe("rests", () => {
  it("writes a rest where nothing is sounding", () => {
    const result = tail([span(0, 48)], { restSlots: [1] });
    expect(at(result, 1)).toMatchObject({ kind: "rest", ticks: 48 });
  });

  /*
   * The voice-aware part, and the one that matters: a slot with nothing
   * written in it is not silent while a long note is still ringing over it.
   */
  it("does not write a rest under a note that is still sounding", () => {
    const result = tail([span(0, 192, { endSlot: 3 })], { restSlots: [1, 2, 3] });
    expect(result.notes.filter((note) => note.kind === "rest")).toEqual([]);
  });

  it("merges neighbouring rests into one longer one", () => {
    const result = tail([], { restSlots: [0, 1, 2, 3] });
    const rests = result.notes.filter((note) => note.kind === "rest");
    expect(rests).toHaveLength(1);
    expect(rests[0]).toMatchObject({ slotIndex: 0, ticks: 192 });
  });

  it("breaks a run of rests at the beat line rather than crossing it", () => {
    const result = tail([], { restSlots: [2, 3, 4, 5] });
    const rests = result.notes.filter((note) => note.kind === "rest");
    expect(rests.map((rest) => rest.slotIndex)).toEqual([2, 4]);
    expect(rests.map((rest) => rest.ticks)).toEqual([96, 96]);
  });

  /*
   * No stem, so no beam can reach it and nothing is shared with a neighbour.
   * A sixteenth rest still has two hooks, and they are drawn on its own glyph.
   */
  it("gives a rest no stem and no beam, but keeps its own hooks", () => {
    const result = tail([], { restSlots: [0] });
    expect(at(result, 0)).toMatchObject({ stem: false, beams: 0, flags: 2 });
  });

  it("keeps notes and rests in one list, in time order", () => {
    const result = tail([span(0, 48), span(4, 48)], { restSlots: [1, 2, 3] });
    expect(result.notes.map((note) => note.slotIndex)).toEqual([0, 1, 4]);
    expect(result.notes.map((note) => note.kind)).toEqual(["note", "rest", "note"]);
  });
});

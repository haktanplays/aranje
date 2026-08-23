/**
 * The rhythmic guide, and the claims it is careful not to make
 * (spec 13.20 §7, 2N-A).
 *
 * Two things are being pinned. The first is that it reads rhythm correctly —
 * a chord is one note, a tie is not a new one, silence breaks a beam. The
 * second matters more: it must not turn into a claim about *pitch*. Nothing
 * here consults a note, so no reading of a beam can be "this is a scale".
 */
import { describe, expect, it } from "vitest";

import { beamLevels, buildRhythmGuide, rhythmGroupLabel } from "@/lib/tab/rhythm-guide";
import { frettedRhythm, type SlotState } from "@/lib/tab/timeline";
import { ticksPerSlot, type Resolution, type TimeSignature } from "@/lib/music/timing";

const guide = (
  states: readonly SlotState[],
  meter: TimeSignature = [4, 4],
  resolution: Resolution = 16,
) => buildRhythmGuide(states, meter, resolution);

/** Shorthand: o = onset, s = sustain, r = rest, . = empty. */
const read = (text: string): SlotState[] =>
  [...text].map((letter) =>
    letter === "o" ? "onset" : letter === "s" ? "sustain" : letter === "r" ? "rest" : "empty",
  );

describe("108. what gets read together", () => {
  it("beams the short notes inside one beat", () => {
    // Four sixteenths on beat one, nothing after.
    const result = guide(read("oooo............"));
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.slots).toEqual([0, 1, 2, 3]);
    expect(result.groups[0]?.levels).toBe(2);
  });

  it("does not reach across a beat line", () => {
    const result = guide(read("oooooooo........"));
    expect(result.groups.map((group) => group.slots)).toEqual([
      [0, 1, 2, 3],
      [4, 5, 6, 7],
    ]);
  });

  it("never reaches past the end of the bar", () => {
    // The states are one bar's, so there is nothing after slot 15 to reach.
    const result = guide(read("............oooo"));
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.slots).toEqual([12, 13, 14, 15]);
  });

  it("leaves a single short note unbeamed", () => {
    // One note is not a group; in real notation it would take a flag, and
    // drawing a one-note beam would be inventing a relationship.
    expect(guide(read("o..............."))).toMatchObject({ groups: [] });
  });
});

describe("109. silence and length break a beam", () => {
  it("stops at a rest", () => {
    expect(guide(read("oorooooo........")).groups.map((group) => group.slots)).toEqual([
      [0, 1],
      [4, 5, 6, 7],
    ]);
  });

  it("stops at an empty slot just as surely", () => {
    expect(guide(read("oo.ooooo........")).groups.map((group) => group.slots)).toEqual([
      [0, 1],
      [4, 5, 6, 7],
    ]);
  });

  it("does not beam a quarter note", () => {
    // Four sixteenths of sound is a quarter; a quarter has no beam.
    expect(guide(read("osssossso.......")).groups).toEqual([]);

    /*
     * And asserted at the seam that decides it.
     *
     * The bar above is empty of groups for a second reason as well: in 4/4 the
     * beat *is* a quarter, so two of them never share one and the run is
     * flushed before the beam count is ever consulted. A probe that gave
     * quarters a beam therefore left that expectation green. The note-value
     * rule has to be pinned where it lives.
     */
    const quarter = ticksPerSlot(4);
    expect(beamLevels(quarter * 2, 16)).toBe(0);
    expect(beamLevels(quarter, 16)).toBe(0);
    expect(beamLevels(quarter / 2, 16)).toBe(1);
    expect(beamLevels(quarter / 4, 16)).toBe(2);
  });

  it("beams a note whose length is short even on a coarse grid", () => {
    // Eighth notes written on a 1/16 grid: one beam each, not two.
    const result = guide(read("osososos........"));
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]?.levels).toBe(1);
  });
});

describe("110. a chord is one note and a tie is not a note", () => {
  it("counts a six-string chord as a single onset", () => {
    /*
     * Taken from the real bar model rather than hand-written states: the
     * collapse of a chord to one onset happens in `frettedRhythm`, and reusing
     * it is what stops this file from having its own opinion about chords.
     */
    const chord = {
      key: "s1:0",
      barKey: "s1:0",
      sectionId: "s1",
      barIndex: 0,
      barNumber: 1,
      sectionName: "S1",
      sectionStatus: "fixed" as const,
      isSectionStart: true,
      timeSignature: [4, 4] as TimeSignature,
      resolution: 16 as Resolution,
      slotCount: 16,
      silent: false,
      rests: [],
      spans: [0, 1, 2, 3, 4, 5].map((stringIndex) => ({
        stringIndex,
        startSlot: 0,
        endSlot: 0,
        fret: 0,
        pitch: "E2",
        openStart: false,
        openEnd: false,
      })),
    };
    const states = frettedRhythm(chord as never);
    expect(states.filter((state) => state === "onset")).toHaveLength(1);
  });

  it("lets a tie lengthen its note rather than start a new group member", () => {
    // Onset, tie, onset, tie: two eighths, not four sixteenths.
    const result = guide(read("osos............"));
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]?.slots).toEqual([0, 2]);
    expect(result.groups[0]?.levels).toBe(1);
  });
});

describe("111. triplets say so, and 7/8 is not given a grouping", () => {
  it("marks a triplet group and beams it as the note value it is", () => {
    // Eighth triplets: one beam each, like any other eighth, plus the "3".
    const result = guide(read("oooooooooooo"), [4, 4], 12);
    expect(result.groups).toHaveLength(4);
    expect(result.groups[0]?.triplet).toBe(true);
    expect(result.groups[0]?.levels).toBe(1);
    expect(result.groups[0]?.slots).toEqual([0, 1, 2]);
  });

  it("gives a sixteenth triplet two beams, not three", () => {
    expect(beamLevels(32, 24)).toBe(2);
    expect(beamLevels(64, 12)).toBe(1);
  });

  it("groups 6/8 in the beat a foot taps", () => {
    // Two dotted beats of three eighths, not six groups of one.
    const result = buildRhythmGuide(read("oooooo"), [6, 8], 8);
    expect(result.beatSlots).toBe(3);
    expect(result.groups.map((group) => group.slots)).toEqual([
      [0, 1, 2],
      [3, 4, 5],
    ]);
  });

  it("uses the safe notated beat in 7/8 and invents no 2+2+3", () => {
    /*
     * Whether 7/8 is felt 2+2+3, 3+2+2 or 2+3+2 is a property of the music,
     * and the contract has no field for it. At 1/16 the notated beat is an
     * eighth — two slots — so the groups are even pairs. What they are *not*
     * is 2+2+3 in some unit this code decided on.
     */
    const result = buildRhythmGuide(read("oooooooooooooo"), [7, 8], 16);
    expect(result.beatSlots).toBe(2);
    expect(result.groups.map((group) => group.slots.length)).toEqual([
      2, 2, 2, 2, 2, 2, 2,
    ]);
    expect(new Set(result.groups.map((group) => group.slots.length)).size).toBe(1);
  });

  it("gives 1/4 nothing to beam at all", () => {
    // Every slot is a quarter, and a quarter has no beam.
    expect(buildRhythmGuide(read("oooo"), [4, 4], 4).groups).toEqual([]);
  });
});

describe("112. it is a rhythm guide and says nothing else", () => {
  it("reads nothing but the slot states", () => {
    /*
     * The same states produce the same groups whatever the notes were, which
     * is the structural reason a beam here can never be a claim about pitch:
     * no pitch reaches this function.
     */
    const first = guide(read("oooo............"));
    const second = guide(read("oooo............"));
    expect(second).toEqual(first);
  });

  it("tells a screen reader what the group is, in rhythm words", () => {
    const result = guide(read("oooo............"));
    const label = rhythmGroupLabel(result.groups[0]!);
    expect(label).toContain("Ritim grubu");
    expect(label).toContain("4 nota");
    expect(label).toContain("1/16");
    // Nothing about scales, keys or shapes.
    expect(label).not.toMatch(/gam|akor|dizi|scale/i);
  });

  it("says 'üçleme' only when the grid really is one", () => {
    expect(rhythmGroupLabel(guide(read("oooooooooooo"), [4, 4], 12).groups[0]!)).toContain(
      "üçleme",
    );
    expect(rhythmGroupLabel(guide(read("oooo............")).groups[0]!)).not.toContain(
      "üçleme",
    );
  });

  it("is deterministic and mutates nothing", () => {
    const states = read("oooo............");
    const snapshot = [...states];
    guide(states);
    guide(states);
    expect(states).toEqual(snapshot);
  });
});

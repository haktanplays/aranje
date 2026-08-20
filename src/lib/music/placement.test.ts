import { describe, expect, it } from "vitest";

import { handPositionLimits, placementLimits } from "@/lib/limits";
import { compareCost, placeTrack, type PlacementBar, type PlacementOnset } from "@/lib/music/placement";
import type { Fretboard, NoteEvent } from "@/lib/song/schema";

const GUITAR: Fretboard = {
  tuning: ["E2", "A2", "D3", "G3", "B3", "E4"],
  capo: 0,
};
const BASS: Fretboard = { tuning: ["E1", "A1", "D2", "G2"], capo: 0 };

const GUITAR_SHIFT = handPositionLimits.guitarMaxShift;
const BASS_SHIFT = handPositionLimits.bassMaxShift;

type OnsetSpec =
  | readonly string[]
  | {
      pitches: readonly string[];
      bar?: number;
      section?: number;
      barIndex?: number;
      notes?: NoteEvent[];
    };

/** One onset per entry, all in bar 1 unless a bar number is given. */
function onsetsOf(groups: readonly OnsetSpec[]): PlacementOnset[] {
  return groups.map((group, index) => {
    const spec: Exclude<OnsetSpec, readonly string[]> = Array.isArray(group)
      ? { pitches: group }
      : (group as Exclude<OnsetSpec, readonly string[]>);
    const bar = spec.bar ?? 1;
    const notes = spec.notes ?? spec.pitches.map((pitch) => ({ pitch }));
    return {
      key: `k${index}`,
      sectionIndex: spec.section ?? 0,
      barIndex: spec.barIndex ?? bar - 1,
      slotIndex: index,
      barNumber: bar,
      notes,
    };
  });
}

function barsUpTo(count: number, silent: readonly number[] = []): PlacementBar[] {
  return Array.from({ length: count }, (_, index) => ({
    barNumber: index + 1,
    silent: silent.includes(index + 1),
  }));
}

function place(
  fretboard: Fretboard,
  onsets: PlacementOnset[],
  options: { bars?: PlacementBar[]; maxShift?: number; beamWidth?: number } = {},
) {
  return placeTrack({
    fretboard,
    onsets,
    bars: options.bars ?? barsUpTo(8),
    maxShift: options.maxShift ?? GUITAR_SHIFT,
    ...(options.beamWidth === undefined ? {} : { beamWidth: options.beamWidth }),
  });
}

/** The anchors the chosen path walks through, in onset order. */
function anchors(result: ReturnType<typeof placeTrack>, onsets: PlacementOnset[]): number[] {
  return onsets.map((onset) => {
    const outcome = result.byOnset.get(onset.key);
    return outcome && outcome.kind !== "unresolved" ? outcome.voicing.anchor : -1;
  });
}

function frets(result: ReturnType<typeof placeTrack>, onsets: PlacementOnset[]) {
  return onsets.map((onset) => {
    const outcome = result.byOnset.get(onset.key);
    if (!outcome || outcome.kind === "unresolved") return null;
    return outcome.voicing.notes.map((note) => `${note.stringIndex}:${note.fret}`);
  });
}

function largeShifts(path: readonly number[], maxShift: number): number {
  let count = 0;
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1];
    const to = path[index];
    if (from === undefined || to === undefined) continue;
    if (Math.abs(to - from) > maxShift) count += 1;
  }
  return count;
}

describe("the cost tuple", () => {
  it("compares left to right, and never as a weighted sum", () => {
    // One extra big jump loses, however much better everything else is.
    const oneJump = [1, 0, 0, 0, 0, 0, 0, "a"] as const;
    const noJump = [0, 99, 99, 99, 99, 99, 99, "z"] as const;
    expect(compareCost(noJump, oneJump)).toBeLessThan(0);
  });

  it("falls back on the canonical signature only at a total tie", () => {
    const a = [0, 0, 0, 0, 0, 0, 0, "a"] as const;
    const b = [0, 0, 0, 0, 0, 0, 0, "b"] as const;
    expect(compareCost(a, b)).toBeLessThan(0);
    expect(compareCost(a, a)).toBe(0);
  });
});

describe("staying in one place", () => {
  it("keeps a riff in one position where the memoryless rule would not", () => {
    // E3 G3 B3 E3: nearest-the-nut for each on its own scatters the hand,
    // because B3 has no low position on its own.
    const onsets = onsetsOf([["E3"], ["G3"], ["B3"], ["E3"]]);
    const result = place(GUITAR, onsets);

    const path = anchors(result, onsets);
    expect(largeShifts(path, GUITAR_SHIFT)).toBe(0);
    // Every onset landed somewhere.
    expect(frets(result, onsets).every((entry) => entry !== null)).toBe(true);
  });

  it("takes exactly the threshold without complaint", () => {
    // Open E, then a note only reachable seven physical frets away.
    const onsets = onsetsOf([["E2"], ["B2"]]);
    const result = place(GUITAR, onsets);
    expect(largeShifts(anchors(result, onsets), GUITAR_SHIFT)).toBe(0);
  });

  it("finds a way round a jump the memoryless rule would take", () => {
    // A2 at the twelfth fret area, then a pitch the nut-first rule would put
    // far away. The search prefers to stay.
    const onsets = onsetsOf([["A3"], ["D4"], ["A3"], ["D4"]]);
    const result = place(GUITAR, onsets);
    expect(largeShifts(anchors(result, onsets), GUITAR_SHIFT)).toBe(0);
  });

  it("respects the bass threshold, which is tighter", () => {
    const onsets = onsetsOf([["E1"], ["A1"]]);
    const result = place(BASS, onsets, { maxShift: BASS_SHIFT });
    expect(largeShifts(anchors(result, onsets), BASS_SHIFT)).toBe(0);
  });

  it("keeps the placement when a big jump cannot be avoided", () => {
    // E2 exists only on the thickest string at fret 0; E5 only high up.
    const onsets = onsetsOf([["E2"], ["E5"]]);
    const result = place(GUITAR, onsets);
    const path = anchors(result, onsets);
    // The jump is real and stays; fretJump reports it.
    expect(largeShifts(path, GUITAR_SHIFT)).toBe(1);
    expect(frets(result, onsets).every((entry) => entry !== null)).toBe(true);
  });
});

  it("prefers one big shift to two, even when the total overshoot is bigger", () => {
    // Written anchors at physical frets 2 and 18, with one free note between.
    // At fret 10 the hand makes two shifts of eight; at fret 6 it makes one
    // comfortable move and one long one. The long one is over the threshold by
    // more, and it is still the better answer: a player would rather move once.
    const onsets = onsetsOf([
      { pitches: ["E3"], notes: [{ pitch: "E3", position: { string: 2, fret: 2 } }] },
      ["F4"],
      { pitches: ["C#5"], notes: [{ pitch: "C#5", position: { string: 3, fret: 18 } }] },
    ]);
    const result = place(GUITAR, onsets);

    expect(frets(result, onsets)[1]).toEqual(["4:6"]);
    expect(largeShifts(anchors(result, onsets), GUITAR_SHIFT)).toBe(1);
  });

  it("moves the hand least, even when a farther position keeps it on one string", () => {
    // The hand is at the twelfth fret on the A string. D4 is available on the
    // same string at the seventeenth — no crossing at all — and one string
    // over at the twelfth, where the hand already is. Staying put wins.
    const onsets = onsetsOf([
      { pitches: ["A3"], notes: [{ pitch: "A3", position: { string: 1, fret: 12 } }] },
      ["D4"],
    ]);
    const result = place(GUITAR, onsets);

    expect(frets(result, onsets)[1]).toEqual(["2:12"]);
  });

describe("first onset and chords", () => {
  it("prefers a low position when there is nothing to move from", () => {
    const onsets = onsetsOf([["E4"]]);
    const result = place(GUITAR, onsets);
    // Open top string, not the twenty-fourth fret of the bottom one.
    expect(frets(result, onsets)[0]).toEqual(["5:0"]);
  });

  it("prefers the narrower of two equally placed chords", () => {
    const onsets = onsetsOf([["E3", "G3", "B3"]]);
    const result = place(GUITAR, onsets);
    const outcome = result.byOnset.get("k0");
    expect(outcome?.kind).toBe("placed");
    if (outcome?.kind !== "placed") return;
    expect(outcome.voicing.span).toBeLessThanOrEqual(4);
  });

  it("moves between consecutive chords without a big jump", () => {
    const onsets = onsetsOf([
      ["E3", "G3", "B3"],
      ["F#3", "A3", "C#4"],
      ["E3", "G3", "B3"],
    ]);
    const result = place(GUITAR, onsets);
    expect(largeShifts(anchors(result, onsets), GUITAR_SHIFT)).toBe(0);
  });
});

  it("prefers the narrower chord even when a wider one frets less", () => {
    // Two ways to hold the same three notes, both reaching the seventh fret:
    // one with nothing else fretted below it, one with a second finger down at
    // the second. The first is no stretch at all and wins, even though the
    // second holds fewer frets in total. A stretch costs the hand more than an
    // extra finger near the nut does.
    const onsets = onsetsOf([["E2", "E3", "B4"]]);
    const result = place(GUITAR, onsets);

    expect(frets(result, onsets)[0]).toEqual(["0:0", "1:7", "5:7"]);
  });

  it("breaks a total tie by the canonical signature, not by the order of the search", () => {
    // These two grips are the same by every number the cost knows: the same
    // top fret, the same total fretting, the same span, the same centre. Only
    // the canonical signature separates them, and it must, or the answer would
    // depend on which branch the search happened to walk first.
    const onsets = onsetsOf([["F2", "D3", "E3", "B4"]]);
    const result = place(GUITAR, onsets);

    expect(frets(result, onsets)[0]).toEqual(["0:1", "1:5", "2:2", "5:7"]);
  });

describe("written positions are never moved", () => {
  const anchored: NoteEvent[] = [{ pitch: "A3", position: { string: 2, fret: 7 } }];

  it("keeps a written position and places the rest around it", () => {
    const onsets = onsetsOf([
      { pitches: ["A3"], notes: anchored },
      ["C4"],
      { pitches: ["A3"], notes: anchored },
    ]);
    const result = place(GUITAR, onsets);
    expect(frets(result, onsets)[0]).toEqual(["2:7"]);
    expect(frets(result, onsets)[2]).toEqual(["2:7"]);
  });

  it("takes the cheapest path between two written anchors", () => {
    const first: NoteEvent[] = [{ pitch: "E3", position: { string: 3, fret: 9 } }];
    const last: NoteEvent[] = [{ pitch: "E3", position: { string: 3, fret: 9 } }];
    const onsets = onsetsOf([
      { pitches: ["E3"], notes: first },
      ["G3"],
      ["B3"],
      { pitches: ["E3"], notes: last },
    ]);
    const result = place(GUITAR, onsets);
    const path = anchors(result, onsets);
    expect(path[0]).toBe(9);
    expect(path[3]).toBe(9);
    expect(largeShifts(path, GUITAR_SHIFT)).toBe(0);
  });

  it("counts a written position in the movement cost without changing it", () => {
    const far: NoteEvent[] = [{ pitch: "E4", position: { string: 0, fret: 24 } }];
    const onsets = onsetsOf([["E2"], { pitches: ["E4"], notes: far }]);
    const result = place(GUITAR, onsets);
    expect(frets(result, onsets)[1]).toEqual(["0:24"]);
    // The jump is counted, not hidden, and the position is untouched.
    expect(largeShifts(anchors(result, onsets), GUITAR_SHIFT)).toBe(1);
  });
});

describe("resets", () => {
  it("does not reset for a short rest inside a bar", () => {
    const onsets = onsetsOf([
      { pitches: ["A3"], bar: 1 },
      { pitches: ["A3"], bar: 1 },
    ]);
    const result = place(GUITAR, onsets, { bars: barsUpTo(2) });
    expect(result.diagnostics.resets).toBe(0);
  });

  it("does not reset at a section boundary on its own", () => {
    // Bar 2 is the first bar of a second section. Neither bar is silent, so a
    // riff that runs straight over the section line is still one riff and the
    // hand keeps its place.
    const onsets = onsetsOf([
      { pitches: ["A3"], bar: 1, section: 0, barIndex: 0 },
      { pitches: ["A3"], bar: 2, section: 1, barIndex: 0 },
    ]);
    const result = place(GUITAR, onsets, { bars: barsUpTo(2) });
    expect(result.diagnostics.resets).toBe(0);
  });

  it("does not reset for a bar filled by a sustain", () => {
    // Bar 2 has no onset but is not silent: the note is still ringing.
    const onsets = onsetsOf([
      { pitches: ["A3"], bar: 1 },
      { pitches: ["A3"], bar: 3 },
    ]);
    const result = place(GUITAR, onsets, { bars: barsUpTo(3) });
    expect(result.diagnostics.resets).toBe(0);
  });

  it("resets after a whole silent bar", () => {
    const onsets = onsetsOf([
      { pitches: ["A3"], bar: 1 },
      { pitches: ["A3"], bar: 3 },
    ]);
    const result = place(GUITAR, onsets, { bars: barsUpTo(3, [2]) });
    expect(result.diagnostics.resets).toBe(1);
  });

  it("starts fresh after a reset, preferring a low position again", () => {
    const onsets = onsetsOf([
      { pitches: ["E4"], bar: 1 },
      { pitches: ["E4"], bar: 3 },
    ]);
    const result = place(GUITAR, onsets, { bars: barsUpTo(3, [2]) });
    expect(frets(result, onsets)[1]).toEqual(["5:0"]);
  });
});

describe("determinism and diagnostics", () => {
  const onsets = onsetsOf([["E3"], ["G3"], ["B3"], ["E3", "G3", "B3"]]);

  it("gives byte-equivalent results however often it runs", () => {
    const first = JSON.stringify(frets(place(GUITAR, onsets), onsets));
    for (let round = 0; round < 100; round += 1) {
      expect(JSON.stringify(frets(place(GUITAR, onsets), onsets))).toBe(first);
    }
  });

  it("finds the same answer at the reference beam width", () => {
    const narrow = frets(place(GUITAR, onsets, { beamWidth: placementLimits.beamWidth }), onsets);
    const wide = frets(place(GUITAR, onsets, { beamWidth: placementLimits.referenceBeamWidth }), onsets);
    expect(narrow).toEqual(wide);
  });

  it("keeps the beam width in one central place", () => {
    expect(placementLimits.beamWidth).toBe(64);
    expect(placementLimits.referenceBeamWidth).toBe(256);
  });

  it("reports what the search did", () => {
    const result = place(GUITAR, onsets);
    expect(result.diagnostics.onsets).toBe(4);
    expect(result.diagnostics.totalCandidateVoicings).toBeGreaterThan(0);
    expect(result.diagnostics.maxCandidateVoicings).toBeGreaterThan(0);
    expect(result.diagnostics.maxExpandedStates).toBeGreaterThan(0);
    expect(result.diagnostics.maxRetainedBeamStates).toBeGreaterThan(0);
    expect(result.diagnostics.unresolvedOnsets).toBe(0);
    expect(result.diagnostics.truncated).toBe(false);
  });

  it("expands more states than it keeps, and says which is which", () => {
    const dense = onsetsOf(
      Array.from({ length: 12 }, () => ["E3", "G3", "B3"] as readonly string[]),
    );
    const result = place(GUITAR, dense);

    // Expansion is the work done: the surviving beam times the candidates of
    // one onset. It is expected to be wider than the beam, and it is not a
    // beam width.
    expect(result.diagnostics.maxExpandedStates).toBeGreaterThan(
      placementLimits.beamWidth,
    );
    expect(result.diagnostics.maxExpandedStates).toBeLessThanOrEqual(
      placementLimits.beamWidth * result.diagnostics.maxCandidateVoicings,
    );
    // What is carried forward is the beam, and it obeys the central width.
    expect(result.diagnostics.maxRetainedBeamStates).toBe(
      placementLimits.beamWidth,
    );
  });

  it("never retains more states than the width it was given", () => {
    const dense = onsetsOf(
      Array.from({ length: 12 }, () => ["E3", "G3", "B3"] as readonly string[]),
    );

    for (const width of [1, 8, placementLimits.beamWidth, placementLimits.referenceBeamWidth]) {
      const result = place(GUITAR, dense, { beamWidth: width });
      expect(result.diagnostics.maxRetainedBeamStates).toBeLessThanOrEqual(width);
    }
  });

  it("does not touch the onsets it was given", () => {
    const input = onsetsOf([["E3"], ["G3"]]);
    const before = JSON.stringify(input);
    place(GUITAR, input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("says nothing at all about an empty track", () => {
    const result = place(GUITAR, []);
    expect(result.byOnset.size).toBe(0);
    expect(result.diagnostics.onsets).toBe(0);
  });
});

describe("what it cannot place", () => {
  it("marks an unplaceable onset unresolved rather than inventing a string", () => {
    const onsets = onsetsOf([["E2", "F2"]]);
    const result = place(GUITAR, onsets);
    expect(result.byOnset.get("k0")?.kind).toBe("unresolved");
    expect(result.diagnostics.unresolvedOnsets).toBe(1);
  });

  it("keeps going after an onset it could not place", () => {
    const onsets = onsetsOf([["E2", "F2"], ["G3"]]);
    const result = place(GUITAR, onsets);
    expect(result.byOnset.get("k0")?.kind).toBe("unresolved");
    expect(result.byOnset.get("k1")?.kind).toBe("placed");
  });

  it("keeps a written position when its neighbour cannot be placed", () => {
    const onsets = onsetsOf([
      {
        pitches: ["G2", "G2"],
        notes: [
          { pitch: "G2", position: { string: 0, fret: 3 } },
          { pitch: "G2" },
        ],
      },
    ]);
    const result = place(GUITAR, onsets);
    const outcome = result.byOnset.get("k0");
    expect(outcome?.kind).toBe("partial");
    if (outcome?.kind !== "partial") return;
    expect(outcome.unresolved).toEqual([1]);
    expect(outcome.voicing.notes[0]).toMatchObject({ stringIndex: 0, fret: 3 });
  });
});

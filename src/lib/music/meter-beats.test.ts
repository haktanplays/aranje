/**
 * Where the beats of a bar actually fall (2V-D.2 §12).
 *
 * Every metre the brief names is here with its groupings, and the assertions
 * are on **exact slots** rather than on counts: a 7/8 that reports three beats
 * at the wrong places is as wrong as one that reports seven.
 */
import { describe, expect, it } from "vitest";

import {
  GROUPING_PRESETS,
  groupingLabel,
  groupingOf,
  groupingPresets,
  groupingRefusal,
  meterBeats,
} from "@/lib/music/meter-beats";
import { defaultGrouping } from "@/lib/music/rhythm-profile";
import {
  RESOLUTIONS,
  TIME_SIGNATURES,
  isRepresentableGrid,
  slotCount,
  type Resolution,
  type TimeSignature,
} from "@/lib/music/timing";

/** The beats of one bar as `[slot, length]` pairs, which is what to read. */
const shape = (
  meter: TimeSignature,
  resolution: Resolution,
  grouping?: readonly number[],
) => meterBeats({ meter, resolution, grouping }).map((beat) => [beat.slot, beat.slots]);

describe("359. the five metres the brief names, and both feels of each", () => {
  it("groups 5/8 as 2+3 and as 3+2", () => {
    // At 1/8, one eighth is one slot.
    expect(shape([5, 8], 8, [2, 3])).toEqual([[0, 2], [2, 3]]);
    expect(shape([5, 8], 8, [3, 2])).toEqual([[0, 3], [3, 2]]);
  });

  it("groups 7/8 as 2+2+3, 3+2+2 and 2+3+2", () => {
    expect(shape([7, 8], 8, [2, 2, 3])).toEqual([[0, 2], [2, 2], [4, 3]]);
    expect(shape([7, 8], 8, [3, 2, 2])).toEqual([[0, 3], [3, 2], [5, 2]]);
    expect(shape([7, 8], 8, [2, 3, 2])).toEqual([[0, 2], [2, 3], [5, 2]]);
  });

  it("groups 9/8 as 3+3+3 and as one asymmetric feel", () => {
    expect(shape([9, 8], 8, [3, 3, 3])).toEqual([[0, 3], [3, 3], [6, 3]]);
    expect(shape([9, 8], 8, [2, 2, 2, 3])).toEqual([[0, 2], [2, 2], [4, 2], [6, 3]]);
  });

  it("groups 5/4 as 3+2 and as 2+3", () => {
    // At 1/4, one quarter is one slot.
    expect(shape([5, 4], 4, [3, 2])).toEqual([[0, 3], [3, 2]]);
    expect(shape([5, 4], 4, [2, 3])).toEqual([[0, 2], [2, 3]]);
  });

  it("groups 12/8 as 3+3+3+3", () => {
    expect(shape([12, 8], 8, [3, 3, 3, 3])).toEqual([
      [0, 3],
      [3, 3],
      [6, 3],
      [9, 3],
    ]);
  });

  it("offers every one of those feels in the picker's own list", () => {
    /* The default and the options are one table. An app whose own default is
       not among the choices it shows is telling the reader two things. */
    for (const meter of TIME_SIGNATURES) {
      const presets = groupingPresets(meter as TimeSignature);
      expect(presets.length, `${meter[0]}/${meter[1]}`).toBeGreaterThan(0);
      expect(defaultGrouping(meter as TimeSignature)).toEqual(presets[0]);
    }
    expect(groupingPresets([7, 8]).map(groupingLabel)).toEqual([
      "2+2+3",
      "3+2+2",
      "2+3+2",
    ]);
  });
});

describe("360. a grouping is exact or it is refused", () => {
  it("refuses a grouping whose sum is not the numerator", () => {
    expect(groupingRefusal([2, 2, 2], [7, 8])).toBe(
      "Gruplar 6 ediyor; bu ölçü 7 bekliyor.",
    );
    expect(groupingRefusal([4, 4], [7, 8])).toBe(
      "Gruplar 8 ediyor; bu ölçü 7 bekliyor.",
    );
  });

  it("refuses an empty grouping and a group of zero", () => {
    expect(groupingRefusal([], [4, 4])).toBeTruthy();
    expect(groupingRefusal([0, 4], [4, 4])).toBeTruthy();
    expect(groupingRefusal([1.5, 2.5], [4, 4])).toBeTruthy();
  });

  it("accepts every preset of every metre in the contract", () => {
    for (const meter of TIME_SIGNATURES) {
      for (const grouping of groupingPresets(meter as TimeSignature)) {
        expect(
          groupingRefusal(grouping, meter as TimeSignature),
          `${meter[0]}/${meter[1]} ${groupingLabel(grouping)}`,
        ).toBeNull();
      }
    }
  });

  it("ignores a stored grouping that does not fit, rather than trusting it", () => {
    /* The schema refuses to store one, so reaching this branch means the data
       came from somewhere that did not go through it — and drawing beats from
       a grouping that does not fill the bar would leave a hole in the middle
       of it. */
    expect(groupingOf({ meter: [7, 8], grouping: [2, 2] })).toEqual([2, 2, 3]);
    expect(groupingOf({ meter: [7, 8] })).toEqual([2, 2, 3]);
  });
});

describe("361. the beats always cover the whole bar, on every grid", () => {
  it("sums to the bar's slot count for every metre, grid and preset", () => {
    /*
     * The invariant everything else rests on: nothing can fall between two
     * beats, and no beat can run past the bar line. Checked across the whole
     * contract rather than on the examples above, because a metre added later
     * gets this for free or fails here.
     */
    for (const meter of TIME_SIGNATURES) {
      for (const resolution of RESOLUTIONS as readonly Resolution[]) {
        if (!isRepresentableGrid(meter as TimeSignature, resolution)) continue;
        for (const grouping of groupingPresets(meter as TimeSignature)) {
          const beats = meterBeats({ meter: meter as TimeSignature, resolution, grouping });
          const total = beats.reduce((sum, beat) => sum + beat.slots, 0);
          const where = `${meter[0]}/${meter[1]} @ ${resolution} ${groupingLabel(grouping)}`;
          expect(total, where).toBe(slotCount(meter as TimeSignature, resolution));
          expect(beats[0]?.slot, where).toBe(0);
          expect(beats[0]?.strength, where).toBe("downbeat");
          /* Exactly one downbeat: a bar with two is a bar with two firsts. */
          expect(
            beats.filter((beat) => beat.strength === "downbeat"),
            where,
          ).toHaveLength(1);
          /* And they run consecutively, with no gap and no overlap. */
          let cursor = 0;
          for (const beat of beats) {
            expect(beat.slot, where).toBe(cursor);
            cursor += beat.slots;
          }
        }
      }
    }
  });

  it("names every metre in the contract in the preset table", () => {
    /* A metre added to `TIME_SIGNATURES` without a feel here would silently
       fall back to an even grouping, which is wrong for the asymmetric ones
       and is exactly the failure this round set out to fix. */
    for (const meter of TIME_SIGNATURES) {
      expect(
        Object.keys(GROUPING_PRESETS),
        `${meter[0]}/${meter[1]}`,
      ).toContain(`${meter[0]}/${meter[1]}`);
    }
  });
});

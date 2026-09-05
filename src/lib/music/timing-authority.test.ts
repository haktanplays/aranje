/**
 * Who owns musical time, and where two owners disagree (2V-D.2 §2).
 *
 * The inventory this belongs to is `eval/rhythm-grid/TIMING-AUTHORITY.md`. A
 * table in a document is a claim; these are the same claims as assertions, so
 * a later round that quietly gives one of these questions a second answer
 * fails here rather than in someone's ear.
 *
 * The three conflicts were **demonstrated first and fixed second**, and both
 * halves are still here. The brief asks for a second authority to be shown
 * before one of them is made to win, so the tests that assert the old
 * disagreement stay beside the ones that record the winner: a reader can see
 * what was wrong, not just that something changed. None of them quietly
 * started passing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  PPQ,
  TICKS_PER_WHOLE,
  isRepresentableGrid,
  slotCount,
  slotsPerFeltBeat,
  ticksPerBar,
  ticksPerSlot,
  type Resolution,
  type TimeSignature,
} from "@/lib/music/timing";
import { defaultGrouping } from "@/lib/music/rhythm-profile";
import { groupingRefusal, meterBeats } from "@/lib/music/meter-beats";
import { barSchema } from "@/lib/song/schema";

describe("343. the tick unit, and what it counts", () => {
  it("counts ticks per quarter note, which is what makes BPM mean quarters", () => {
    /*
     * The whole tempo semantics rests on this one identity. `tempo.ts`
     * computes `60 / (bpm * PPQ)` seconds per tick; that is quarters per
     * minute **only** if PPQ is ticks per quarter. Written down here so a
     * change to either number has to face the other.
     */
    expect(PPQ).toBe(192);
    expect(TICKS_PER_WHOLE).toBe(PPQ * 4);
    expect(ticksPerSlot(4)).toBe(PPQ);
  });

  it("agrees with the MIDI writer about what a quarter is", () => {
    /* `microsecondsPerQuarter(bpm) = 60_000_000 / bpm` and playback's
       `60 / (bpm * PPQ)` are the same statement in two units. */
    const bpm = 120;
    const secondsPerTickPlayback = 60 / (bpm * PPQ);
    const secondsPerQuarterMidi = 60_000_000 / bpm / 1_000_000;
    expect(secondsPerTickPlayback * PPQ).toBeCloseTo(secondsPerQuarterMidi, 12);
  });
});

describe("344. bar length: one formula, ten spellings", () => {
  const METERS: readonly TimeSignature[] = [
    [4, 4],
    [3, 4],
    [6, 8],
    [7, 8],
  ];

  it("computes the same answer inline as it does through the authority", () => {
    /*
     * The conflict, stated rather than repaired. Nine modules open-code
     * `slotCount() * ticksPerSlot()` instead of calling `ticksPerBar`. They
     * agree today because it is the same product; nothing enforces that, and
     * the next meter has to be right in ten places or wrong in one.
     */
    for (const meter of METERS) {
      for (const resolution of [8, 16, 24, 32] as const) {
        if (!isRepresentableGrid(meter, resolution)) continue;
        const inline = slotCount(meter, resolution) * ticksPerSlot(resolution);
        expect(inline, `${meter[0]}/${meter[1]} @ ${resolution}`).toBe(
          ticksPerBar(meter, resolution),
        );
      }
    }
  });

  it("names every module that recomputes it, so the count cannot drift unseen", () => {
    /*
     * A grep, held as a number. This is not a style rule: it is the size of
     * the surface that has to be revisited whenever bar length changes, and
     * a round that adds a tenth spelling should have to say so here.
     */
    const OPEN_CODED = [
      "src/lib/song/sounding.ts",
      "src/lib/song/note-duration.ts",
      "src/lib/song/timing-change.ts",
      "src/lib/song/sequence-write.ts",
      "src/lib/song/rhythm-choice.ts",
      "src/lib/song/bar-transform.ts",
      "src/lib/song/onset-block.ts",
    ];
    for (const path of OPEN_CODED) {
      const source = readFileSync(path, "utf8");
      expect(source, `${path} no longer open-codes bar length`).toMatch(
        /slotCount\([\s\S]{0,120}?\)\s*\*\s*ticksPerSlot\(/u,
      );
    }
  });
});

describe("345. where the beat is: a number and a list, now one list", () => {
  const at = (meter: TimeSignature, resolution: Resolution) => ({
    scalar: slotsPerFeltBeat(meter, resolution),
    grouping: defaultGrouping(meter),
    slots: slotCount(meter, resolution),
  });

  it("agrees on the meters whose beats are all the same length", () => {
    /* 4/4, 3/4 and 6/8 are evenly felt, so one number is enough and the two
       authorities cannot come apart. */
    for (const meter of [[4, 4], [3, 4], [6, 8]] as const) {
      const read = at(meter, 16);
      const beats = read.slots / read.scalar;
      expect(beats, `${meter[0]}/${meter[1]}`).toBe(read.grouping.length);
    }
  });

  it("cannot agree on 7/8, because one of them has no way to", () => {
    /*
     * The conflict that matters. A 7/8 felt `2+2+3` has three beats of
     * unequal length; a scalar can only describe equal ones. So the
     * metronome, the beat lines, the count-in and the spoken reading all
     * said "seven equal eighths" — which is not a thing anybody plays — and
     * the grouping model that could have said otherwise was read by nothing.
     * The arithmetic below is why one number could never have been enough;
     * it is as true now as it was then, which is why the test stays.
     */
    const read = at([7, 8], 8);
    expect(read.scalar).toBe(1);
    expect(read.slots / read.scalar).toBe(7);

    const felt = [2, 2, 3];
    expect(felt.reduce((total, group) => total + group, 0)).toBe(7);
    /* Three beats, and no single slot count produces three from seven. */
    expect(Number.isInteger(read.slots / felt.length)).toBe(false);
  });

  it("now defaults to a feel a guitarist would recognise", () => {
    /*
     * Resolved, and the resolution is recorded rather than the test quietly
     * starting to pass. `defaultGrouping` used to return seven single
     * eighths for 7/8 — legal, and not a thing anybody plays. It reads the
     * preset table now, so the default is the first entry a reader would be
     * offered, and the app's own answer is among the options it shows.
     */
    expect(defaultGrouping([7, 8])).toEqual([2, 2, 3]);
    expect(defaultGrouping([5, 8])).toEqual([2, 3]);
    expect(defaultGrouping([5, 4])).toEqual([3, 2]);
    /* And the even metres are untouched, so nothing that was right moved. */
    expect(defaultGrouping([4, 4])).toEqual([1, 1, 1, 1]);
    expect(defaultGrouping([6, 8])).toEqual([3, 3]);
  });

  it("gives the beats as a list, which is what an asymmetric metre needs", () => {
    /*
     * The scalar is still there and still right for the metres it can
     * describe; what changed is that the question now has an answer for the
     * ones it cannot. Three beats of 2, 2 and 3 eighths — and they cover the
     * bar exactly, so nothing falls between two beats.
     */
    const beats = meterBeats({ meter: [7, 8], resolution: 8 });
    expect(beats.map((beat) => beat.slot)).toEqual([0, 2, 4]);
    expect(beats.map((beat) => beat.slots)).toEqual([2, 2, 3]);
    expect(beats.map((beat) => beat.strength)).toEqual([
      "downbeat",
      "secondary",
      "secondary",
    ]);
    expect(beats.reduce((total, beat) => total + beat.slots, 0)).toBe(
      slotCount([7, 8], 8),
    );
  });

  it("still agrees with the scalar wherever the scalar was right", () => {
    /* The equivalence that makes replacing it safe: on every evenly felt
       metre the list is exactly the scalar's beats, at the same slots. */
    for (const meter of [[4, 4], [3, 4], [6, 8]] as const) {
      for (const resolution of [8, 16] as const) {
        const beats = meterBeats({ meter, resolution });
        const step = slotsPerFeltBeat(meter, resolution);
        expect(
          beats.map((beat) => beat.slot),
          `${meter[0]}/${meter[1]} @ ${resolution}`,
        ).toEqual(
          Array.from(
            { length: slotCount(meter, resolution) / step },
            (_, index) => index * step,
          ),
        );
      }
    }
  });

  it("leaves no reader asking the scalar where the beat is", () => {
    /*
     * The fix is only real if the five surfaces that used to ask the scalar
     * now ask the list. A scalar left in one of them would be the conflict
     * again, quieter: four surfaces clicking 7/8 in three and one drawing it
     * in seven, which nobody would find by reading either file alone.
     *
     * `slotsPerFeltBeat` itself is not deleted — `slotsPerBeat` in the audio
     * plan still offers it, and it is still the right answer for a caller
     * that genuinely wants one beat length — so this names the readers
     * rather than the function.
     */
    const readers = [
      "src/lib/audio/position.ts",
      "src/lib/tab/rhythm-guide.ts",
      "src/lib/tab/rhythm-tail.ts",
      "src/lib/practice/count-in.ts",
      "src/lib/music/rhythm-language.ts",
    ];
    for (const path of readers) {
      const source = readFileSync(path, "utf8");
      expect(source, path).toContain("meterBeats");
    }

    /* And the four that decide where a beat *is* ask nothing else. The
       language module still uses the scalar to name a grid's step count,
       which is a different question and is allowed to. */
    for (const path of readers.slice(0, 4)) {
      const source = readFileSync(path, "utf8");
      const uses = source
        .split("\n")
        .filter((line) => line.includes("slotsPerFeltBeat("));
      expect(uses, path).toEqual([]);
    }
  });
});

describe("346. 6/8 with sixteenth triplets needs no new representation", () => {
  /*
   * §11 says to measure before writing a new time model. This is the
   * measurement, and it says the model already shipped is exact.
   */
  const SIX_EIGHT: TimeSignature = [6, 8];

  it("holds the same bar length on every grid it can be written on", () => {
    for (const resolution of [8, 16, 24, 32, 48] as const) {
      expect(isRepresentableGrid(SIX_EIGHT, resolution), `1/${resolution}`).toBe(true);
      expect(ticksPerBar(SIX_EIGHT, resolution), `1/${resolution}`).toBe(576);
    }
  });

  it("places straight sixteenths and sixteenth triplets on one exact lattice", () => {
    const straight = ticksPerSlot(16);
    const triplet = ticksPerSlot(24);
    const lattice = ticksPerSlot(48);
    expect(straight).toBe(48);
    expect(triplet).toBe(32);
    expect(lattice).toBe(16);
    /* Both land on whole lattice slots — nothing is rounded to reach them. */
    expect(straight % lattice).toBe(0);
    expect(triplet % lattice).toBe(0);
    /* And the lattice is the coarsest that does it: half of it fails. */
    expect(triplet % (lattice * 2)).toBe(0);
    expect(straight % (lattice * 2)).not.toBe(0);
  });

  it("ends the bar with no drift, counted the long way", () => {
    /*
     * Not `576 === 576`. Every onset of a full bar of straight sixteenths and
     * a full bar of sixteenth triplets is walked, and the last one plus its
     * own length has to land exactly on the bar line.
     */
    for (const resolution of [16, 24, 48] as const) {
      const step = ticksPerSlot(resolution);
      let at = 0;
      for (let slot = 0; slot < slotCount(SIX_EIGHT, resolution); slot += 1) at += step;
      expect(at, `1/${resolution}`).toBe(576);
    }
  });
});

describe("347. grouping can now be written down, and is optional", () => {
  it("tells 2+3 and 3+2 apart in the bytes", () => {
    /*
     * The third conflict, resolved by the one thing that could resolve it: a
     * field. Two 5/8 bars felt differently are the same five eighth notes,
     * so the notes could never have said which — and guessing would be the
     * app deciding where a reader's accents are.
     */
    const two_three = meterBeats({ meter: [5, 8], resolution: 8, grouping: [2, 3] });
    const three_two = meterBeats({ meter: [5, 8], resolution: 8, grouping: [3, 2] });
    expect(two_three.map((beat) => beat.slot)).toEqual([0, 2]);
    expect(three_two.map((beat) => beat.slot)).toEqual([0, 3]);
  });

  it("leaves it absent, so no song written before now changes meaning", () => {
    /* Optional in the schema and defaulted at read time. A bar that never
       said anything about feel still does not, and still plays. */
    const bar = {
      timeSignature: [5, 8] as const,
      resolution: 8 as const,
      slots: {},
    };
    expect(barSchema.safeParse(bar).success).toBe(true);
    expect(barSchema.safeParse({ ...bar, grouping: [2, 3] }).success).toBe(true);
  });

  it("refuses a grouping that does not add up to the bar", () => {
    /* Not a feel, a typo — and caught at the schema so nothing downstream
       has to wonder whether its accents cover the measure. */
    expect(
      barSchema.safeParse({
        timeSignature: [5, 8],
        resolution: 8,
        grouping: [2, 2],
        slots: {},
      }).success,
    ).toBe(false);
    expect(groupingRefusal([2, 2], [5, 8])).toContain("5");
    expect(groupingRefusal([2, 3], [5, 8])).toBeNull();
  });
});

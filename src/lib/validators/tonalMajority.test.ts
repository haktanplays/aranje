import { describe, expect, it } from "vitest";

import type { Bar, DrumSlot, MelodicSlot, NoteEvent, Track } from "@/lib/song/schema";
import {
  drumTrack,
  guitarTrack,
  melodicBar,
  restSlots,
  section,
  song,
} from "@/lib/song/fixtures";
import { validateTonalMajority } from "@/lib/validators/tonalMajority";

function notes(...pitches: readonly string[]): MelodicSlot {
  return { notes: pitches.map((pitch): NoteEvent => ({ pitch })) };
}

/** A bar written for several tracks at once. */
function sharedBar(
  slots: Record<string, readonly (MelodicSlot | DrumSlot)[]>,
): Bar {
  return {
    timeSignature: [4, 4],
    resolution: 8,
    slots: Object.fromEntries(
      Object.entries(slots).map(([id, value]) => [id, [...value]]),
    ) as Bar["slots"],
  };
}

/** Fill the first slots of a guitar bar and rest for the remainder. */
function line(...values: readonly MelodicSlot[]): MelodicSlot[] {
  const slots = restSlots(8);
  values.forEach((value, index) => {
    slots[index] = value;
  });
  return slots;
}

const BASS: Track = {
  id: "bass",
  name: "Bas",
  instrumentId: "electric_bass",
  presetId: "finger",
  volumeDb: -6,
  fretboard: { tuning: ["E1", "A1", "D2", "G2"], capo: 0 },
};

function eMinor(bars: readonly Bar[], tracks: readonly Track[] = [guitarTrack()]) {
  return song(tracks, [section([...bars])], { key: "E minor" });
}

describe("tonalMajority validator (spec 10.1, set from 10.4)", () => {
  it("does not block a bar for one colour note", () => {
    // F is the flat second of E minor and the only note outside the set;
    // one note in three is not a majority (spec 10.4).
    const subject = eMinor([
      melodicBar("gtr", line(notes("F2"), notes("A3"), notes("B3"))),
    ]);
    expect(validateTonalMajority(subject)).toEqual([]);
  });

  it("does not block an even split either", () => {
    const subject = eMinor([melodicBar("gtr", line(notes("F2"), notes("A3")))]);
    expect(validateTonalMajority(subject)).toEqual([]);
  });

  it("blocks a bar once more than half of it sits outside", () => {
    const subject = eMinor([
      melodicBar("gtr", line(notes("F2"), notes("F2"), notes("A3"))),
    ]);
    const issues = validateTonalMajority(subject);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "tonalMajority",
      severity: "error",
      sectionId: "s1",
      barIndex: 0,
    });
    expect(issues[0]?.message).toContain("F2");
    expect(issues[0]?.message).toContain("E minor");
  });

  it("lets a chromatic step through, and stops a stack of them", () => {
    // E - F - F#: the F is a passing tone between two notes of the set.
    const passing = eMinor([
      melodicBar("gtr", line(notes("E2"), notes("F2"), notes("F#2"))),
    ]);
    expect(validateTonalMajority(passing)).toEqual([]);

    // The same pitch with no step around it is just outside the set.
    const stranded = eMinor([
      melodicBar("gtr", line(notes("F2"), notes("F2"), notes("F2"))),
    ]);
    expect(validateTonalMajority(stranded)).toHaveLength(1);
  });

  it("counts every note of a chord, not every slot", () => {
    // One slot, three notes, two of them outside.
    const subject = eMinor([melodicBar("gtr", line(notes("F2", "F3", "A3")))]);
    expect(validateTonalMajority(subject)).toHaveLength(1);
  });

  it("does not count a tie as a second note", () => {
    // Without the tie rule this bar would read as four outside notes.
    const subject = eMinor([
      melodicBar("gtr", line(notes("F2"), "-", "-", notes("A3"))),
    ]);
    expect(validateTonalMajority(subject)).toEqual([]);
  });

  it("counts the whole bar, across every melodic track", () => {
    const bar = sharedBar({
      gtr: line(notes("A3")),
      bass: line(notes("F2"), notes("F2")),
    });
    const subject = eMinor([bar], [guitarTrack(), BASS]);

    // Two outside of three: a majority only when both tracks are counted.
    const issues = validateTonalMajority(subject);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("3 notanın 2");
  });

  it("ignores drum hits, which have no pitch", () => {
    const bar = sharedBar({
      gtr: line(notes("F2"), notes("A3")),
      drums: [
        [{ piece: "kick" as const }],
        [{ piece: "snare" as const }],
        [],
        [],
        [],
        [],
        [],
        [],
      ],
    });
    const subject = eMinor([bar], [guitarTrack(), drumTrack()]);
    // Still one outside of two melodic notes; the drums do not tip it over.
    expect(validateTonalMajority(subject)).toEqual([]);
  });

  it("reads the key off the song rather than assuming one", () => {
    const bars = [melodicBar("gtr", line(notes("F2"), notes("F3")))];
    // F is the flat second in E minor.
    expect(validateTonalMajority(eMinor(bars))).toHaveLength(1);
    // In F major the same notes are the tonic.
    expect(
      validateTonalMajority(
        song([guitarTrack()], [section(bars)], { key: "F major" }),
      ),
    ).toEqual([]);
  });

  it("says nothing when the key cannot be read", () => {
    const subject = {
      ...eMinor([melodicBar("gtr", line(notes("F2"), notes("F3")))]),
      key: "not a key",
    };
    expect(validateTonalMajority(subject)).toEqual([]);
  });

  it("needs the surrounding song, not the bar alone", () => {
    // The F sits at the start of bar 2; its step down from E is the last note
    // of bar 1. Judged bar by bar in isolation it would look outside.
    const subject = eMinor([
      melodicBar("gtr", line(notes("A3"), notes("B3"), notes("E2"))),
      melodicBar("gtr", line(notes("F2"), notes("F#2"))),
    ]);
    expect(validateTonalMajority(subject)).toEqual([]);
  });

  it("reports in section and bar order, and repeats itself exactly", () => {
    const bad = melodicBar("gtr", line(notes("F2"), notes("F2")));
    const subject = song(
      [guitarTrack()],
      [
        section([bad, bad], { id: "a", name: "A" }),
        section([bad], { id: "b", name: "B" }),
      ],
      { key: "E minor" },
    );

    const path = validateTonalMajority(subject).map((issue) => [
      issue.sectionId,
      issue.barIndex,
    ]);
    expect(path).toEqual([
      ["a", 0],
      ["a", 1],
      ["b", 0],
    ]);
    expect(validateTonalMajority(subject)).toEqual(
      validateTonalMajority(subject),
    );
  });
});

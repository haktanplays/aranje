import { describe, expect, it } from "vitest";

import { fretboardRange } from "@/lib/music/fretboard";
import { midiToPitch, pitchToMidi } from "@/lib/music/pitch";
import type { Fretboard, MelodicSlot, Track } from "@/lib/song/schema";
import {
  drumTrack,
  guitarTrack,
  melodicBar,
  restSlots,
  section,
  song,
} from "@/lib/song/fixtures";
import { rangeSupportFor, validateRange } from "@/lib/validators/range";
import { validateFretboardIntegrity } from "@/lib/validators/fretboardIntegrity";

const E_STANDARD: Fretboard = {
  tuning: ["E2", "A2", "D3", "G3", "B3", "E4"],
  capo: 0,
};

/** One note in the first slot of a one-bar song. */
function withPitch(track: Track, slot: MelodicSlot) {
  const slots = restSlots(8);
  slots[0] = slot;
  return song([track], [section([melodicBar(track.id, slots)])]);
}

function noteAt(track: Track, pitch: string) {
  return withPitch(track, { notes: [{ pitch }] });
}

/** Bounds are read back from the fretboard, never written down in a test. */
function boundsOf(fretboard: Fretboard) {
  const range = fretboardRange(fretboard);
  if (!range) throw new Error("fixture tuning is unreadable");
  const low = midiToPitch(range.lowMidi);
  const high = midiToPitch(range.highMidi);
  const below = midiToPitch(range.lowMidi - 1);
  const above = midiToPitch(range.highMidi + 1);
  if (!low || !high || !below || !above) throw new Error("unnameable bound");
  return { ...range, low, high, below, above };
}

describe("range validator (spec 10.1, bounds from spec 9.1)", () => {
  it("accepts the exact lower bound", () => {
    const bounds = boundsOf(E_STANDARD);
    expect(validateRange(noteAt(guitarTrack(), bounds.low))).toEqual([]);
  });

  it("accepts the exact upper bound", () => {
    const bounds = boundsOf(E_STANDARD);
    expect(validateRange(noteAt(guitarTrack(), bounds.high))).toEqual([]);
  });

  it("rejects one semitone below the lower bound", () => {
    const bounds = boundsOf(E_STANDARD);
    const issues = validateRange(noteAt(guitarTrack(), bounds.below));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("range");
    expect(issues[0]?.severity).toBe("error");
    expect(issues[0]?.message).toContain(bounds.below);
    expect(issues[0]).toMatchObject({
      sectionId: "s1",
      barIndex: 0,
      trackId: "gtr",
      slotIndex: 0,
    });
  });

  it("rejects one semitone above the upper bound", () => {
    const bounds = boundsOf(E_STANDARD);
    const issues = validateRange(noteAt(guitarTrack(), bounds.above));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe("range");
  });

  it("raises the floor when a capo is fitted (spec 9.1)", () => {
    const open = guitarTrack();
    const capoed = guitarTrack({
      fretboard: { ...E_STANDARD, capo: 2 },
    });
    const openBounds = boundsOf(E_STANDARD);

    // The same low note is fine open and out of reach behind the capo.
    expect(validateRange(noteAt(open, openBounds.low))).toEqual([]);
    const issues = validateRange(noteAt(capoed, openBounds.low));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("altında");

    // Exactly the capo's own pitch is the new floor and is accepted.
    const capoBounds = boundsOf({ ...E_STANDARD, capo: 2 });
    expect(capoBounds.lowMidi).toBe(openBounds.lowMidi + 2);
    expect(validateRange(noteAt(capoed, capoBounds.low))).toEqual([]);
  });

  it("does not raise the ceiling with the capo, because the frets above it are lost", () => {
    const open = boundsOf(E_STANDARD);
    const capoed = boundsOf({ ...E_STANDARD, capo: 4 });
    expect(capoed.highMidi).toBe(open.highMidi);
  });

  it("follows an alternate tuning instead of a fixed guitar range", () => {
    const dropD = guitarTrack({
      fretboard: { tuning: ["D2", "A2", "D3", "G3", "B3", "E4"], capo: 0 },
    });
    const dropBounds = boundsOf({
      tuning: ["D2", "A2", "D3", "G3", "B3", "E4"],
      capo: 0,
    });
    expect(dropBounds.lowMidi).toBe(boundsOf(E_STANDARD).lowMidi - 2);

    // D2 reaches the dropped string but nothing on a standard guitar.
    expect(validateRange(noteAt(dropD, "D2"))).toEqual([]);
    expect(validateRange(noteAt(guitarTrack(), "D2"))).toHaveLength(1);
  });

  it("reads the extremes off every string, not off the first and last", () => {
    // A tuning whose lowest string sits in the middle of the array.
    const odd: Fretboard = { tuning: ["E2", "A1", "D3"], capo: 0 };
    const bounds = boundsOf(odd);
    expect(bounds.lowMidi).toBe(pitchToMidi("A1"));

    const track = guitarTrack({ id: "odd", fretboard: odd });
    expect(validateRange(noteAt(track, "A1"))).toEqual([]);
  });

  it("catches an event that carries no position at all", () => {
    const bounds = boundsOf(E_STANDARD);
    const subject = noteAt(guitarTrack(), bounds.below);
    const bar = subject.sections[0]?.bars[0];
    const slot = bar?.slots.gtr?.[0];
    expect(slot).toEqual({ notes: [{ pitch: bounds.below }] });

    // fretboardIntegrity sees nothing here; range is the only check that does.
    expect(validateFretboardIntegrity(subject)).toEqual([]);
    expect(validateRange(subject)).toHaveLength(1);
  });

  it("leaves a written position to fretboardIntegrity and reports it once", () => {
    // Tel 0 perde 40 does not exist; that is an integrity fault, not a range
    // fault, and only one validator names it.
    const subject = withPitch(guitarTrack(), {
      notes: [{ pitch: "G6", position: { string: 0, fret: 40 } }],
    });
    expect(validateFretboardIntegrity(subject)).toHaveLength(1);
    expect(validateRange(subject)).toEqual([]);
  });

  it("stays silent on a position that is valid, since it must sound in range", () => {
    const subject = withPitch(guitarTrack(), {
      notes: [{ pitch: "G2", position: { string: 0, fret: 3 } }],
    });
    expect(validateFretboardIntegrity(subject)).toEqual([]);
    expect(validateRange(subject)).toEqual([]);
  });

  it("skips drum tracks, which drumVocab owns", () => {
    const kit = drumTrack();
    expect(rangeSupportFor(kit)).toEqual({ kind: "drums" });

    // Even a melodic slot written on a drum track produces no range issue.
    const subject = withPitch(kit, { notes: [{ pitch: "C-1" }] });
    expect(validateRange(subject)).toEqual([]);
  });

  it("invents no numbers for the phase 2.5 instruments", () => {
    const piano = guitarTrack({
      id: "pno",
      name: "Piyano",
      instrumentId: "piano",
      presetId: "grand",
      fretboard: undefined,
    });
    const support = rangeSupportFor(piano);
    expect(support.kind).toBe("deferred");

    // Both extremes pass, because no range is asserted rather than guessed.
    expect(validateRange(noteAt(piano, "C-1"))).toEqual([]);
    expect(validateRange(noteAt(piano, "G9"))).toEqual([]);
  });

  it("reports issues in section, bar and slot order", () => {
    const bounds = boundsOf(E_STANDARD);
    const bad: MelodicSlot = { notes: [{ pitch: bounds.below }] };
    const barOne = restSlots(8);
    barOne[2] = bad;
    barOne[5] = bad;
    const barTwo = restSlots(8);
    barTwo[1] = bad;

    const subject = song(
      [guitarTrack()],
      [
        section([melodicBar("gtr", barOne), melodicBar("gtr", barTwo)], {
          id: "a",
          name: "A",
        }),
        section([melodicBar("gtr", barTwo)], { id: "b", name: "B" }),
      ],
    );

    expect(
      validateRange(subject).map((issue) => [
        issue.sectionId,
        issue.barIndex,
        issue.slotIndex,
      ]),
    ).toEqual([
      ["a", 0, 2],
      ["a", 0, 5],
      ["a", 1, 1],
      ["b", 0, 1],
    ]);
  });
});

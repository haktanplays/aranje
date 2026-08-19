import { describe, expect, it } from "vitest";

import type { Bar, Fretboard, MelodicSlot, NoteEvent } from "@/lib/song/schema";
import {
  drumTrack,
  guitarTrack,
  melodicBar,
  restSlots,
  section,
  song,
} from "@/lib/song/fixtures";
import { validateFretboardIntegrity } from "@/lib/validators/fretboardIntegrity";
import { validateRange } from "@/lib/validators/range";
import { validateStringCollision } from "@/lib/validators/stringCollision";
import { validateUnplaceable } from "@/lib/validators/unplaceable";

function chord(pitches: readonly string[]): MelodicSlot {
  return { notes: pitches.map((pitch): NoteEvent => ({ pitch })) };
}

function firstSlot(slot: MelodicSlot): Bar {
  const slots = restSlots(8);
  slots[0] = slot;
  return melodicBar("gtr", slots);
}

function guitarSong(bars: readonly Bar[], fretboard?: Fretboard) {
  const track = fretboard ? guitarTrack({ fretboard }) : guitarTrack();
  return song([track], [section([...bars])]);
}

/** Both pitches exist only on the thickest string of a standard guitar. */
const SAME_STRING_ONLY = ["E2", "F2"];
/** One open note per string: six strings, six notes, an exact fit. */
const OPEN_SIX = ["E2", "A2", "D3", "G3", "B3", "E4"];

describe("unplaceable warning (spec 10.3)", () => {
  it("warns about a chord whose notes fit one at a time but not together", () => {
    const subject = guitarSong([firstSlot(chord(SAME_STRING_ONLY))]);

    // Neither pitch is out of range and neither carries a position, so no
    // other validator has anything to say.
    expect(validateRange(subject)).toEqual([]);
    expect(validateFretboardIntegrity(subject)).toEqual([]);
    expect(validateStringCollision(subject)).toEqual([]);

    const issues = validateUnplaceable(subject);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "unplaceable",
      severity: "warning",
      sectionId: "s1",
      barIndex: 0,
      trackId: "gtr",
      slotIndex: 0,
    });
    expect(issues[0]?.message).toContain("E2");
    expect(issues[0]?.message).toContain("F2");
  });

  it("stays silent on the chord that exactly fills the fretboard", () => {
    expect(validateUnplaceable(guitarSong([firstSlot(chord(OPEN_SIX))]))).toEqual(
      [],
    );

    // One note past the last free string and the same chord no longer fits.
    const overflowing = guitarSong([firstSlot(chord([...OPEN_SIX, "A4"]))]);
    expect(validateUnplaceable(overflowing)).toHaveLength(1);
  });

  it("emits one issue per slot, not one per stranded note", () => {
    const issues = validateUnplaceable(
      guitarSong([firstSlot(chord([...OPEN_SIX, "A4", "B4"]))]),
    );
    expect(issues).toHaveLength(1);
  });

  it("leaves a wrong written position to fretboardIntegrity", () => {
    const subject = guitarSong([
      firstSlot({ notes: [{ pitch: "G6", position: { string: 0, fret: 40 } }] }),
    ]);
    expect(validateFretboardIntegrity(subject)).toHaveLength(1);
    expect(validateUnplaceable(subject)).toEqual([]);
  });

  it("leaves an unreachable pitch to range", () => {
    // Two semitones below the lowest open string: not a chord problem.
    const subject = guitarSong([firstSlot(chord(["D2"]))]);
    expect(validateRange(subject)).toHaveLength(1);
    expect(validateUnplaceable(subject)).toEqual([]);
  });

  it("follows the capo and an alternate tuning", () => {
    const dropDCapo: Fretboard = {
      tuning: ["D2", "A2", "D3", "G3", "B3", "E4"],
      capo: 2,
    };
    // With capo 2 the dropped string sounds E2; E2 and F2 are still the only
    // pitches that live on it alone.
    const subject = guitarSong([firstSlot(chord(["E2", "F2"]))], dropDCapo);
    expect(validateRange(subject)).toEqual([]);
    expect(validateUnplaceable(subject)).toHaveLength(1);

    // Without the capo the same two pitches sit one string lower and still
    // collide, but D2 now has a home of its own.
    const dropD: Fretboard = { ...dropDCapo, capo: 0 };
    expect(
      validateUnplaceable(guitarSong([firstSlot(chord(["D2", "A2"]))], dropD)),
    ).toEqual([]);
  });

  it("skips drum tracks and instruments with no fretboard", () => {
    const kit = song(
      [drumTrack()],
      [section([melodicBar("drums", [chord(SAME_STRING_ONLY), ...restSlots(7)])])],
    );
    expect(validateUnplaceable(kit)).toEqual([]);

    const piano = song(
      [
        guitarTrack({
          id: "pno",
          name: "Piyano",
          instrumentId: "piano",
          presetId: "grand",
          fretboard: undefined,
        }),
      ],
      [section([melodicBar("pno", [chord(SAME_STRING_ONLY), ...restSlots(7)])])],
    );
    expect(validateUnplaceable(piano)).toEqual([]);
  });

  it("reports a carried tie once, in the bar where it was struck", () => {
    const struck = restSlots(8);
    struck[7] = chord(SAME_STRING_ONLY);
    const next = restSlots(8);
    next[0] = "-";

    const subject = guitarSong([
      melodicBar("gtr", struck),
      melodicBar("gtr", next),
    ]);
    const issues = validateUnplaceable(subject);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ barIndex: 0, slotIndex: 7 });
  });

  it("treats a bar without the track as silence", () => {
    const absent: Bar = { timeSignature: [4, 4], resolution: 8, slots: {} };
    expect(validateUnplaceable(guitarSong([absent]))).toEqual([]);
  });

  it("reports in section, bar and slot order", () => {
    const bad = chord(SAME_STRING_ONLY);
    const barOne = restSlots(8);
    barOne[1] = bad;
    barOne[4] = bad;
    const barTwo = restSlots(8);
    barTwo[0] = bad;

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

    const path = validateUnplaceable(subject).map((issue) => [
      issue.sectionId,
      issue.barIndex,
      issue.slotIndex,
    ]);
    expect(path).toEqual([
      ["a", 0, 1],
      ["a", 0, 4],
      ["a", 1, 0],
      ["b", 0, 0],
    ]);
    expect(validateUnplaceable(subject)).toEqual(validateUnplaceable(subject));
  });
});

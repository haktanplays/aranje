import { describe, expect, it } from "vitest";

import { handPositionLimits } from "@/lib/limits";
import type { Bar, Fretboard, MelodicSlot, NoteEvent, Track } from "@/lib/song/schema";
import {
  drumTrack,
  guitarTrack,
  melodicBar,
  restSlots,
  section,
  song,
} from "@/lib/song/fixtures";
import { maxShiftFor, medianOf, validateFretJump } from "@/lib/validators/fretJump";

/** A note pinned to a string and fret, so the anchor is exactly known. */
function at(string: number, fret: number, pitch: string): NoteEvent {
  return { pitch, position: { string, fret } };
}

function slot(...notes: readonly NoteEvent[]): MelodicSlot {
  return { notes: [...notes] };
}

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

function guitarSong(bars: readonly Bar[], fretboard?: Fretboard) {
  const track = fretboard ? guitarTrack({ fretboard }) : guitarTrack();
  return song([track], [section([...bars])]);
}

// Standard tuning, string 0 is E2 (MIDI 40): fret n sounds MIDI 40 + n.
const E_STRING = (fret: number) => {
  const names = [
    "E2", "F2", "F#2", "G2", "G#2", "A2", "A#2", "B2",
    "C3", "C#3", "D3", "D#3", "E3", "F3", "F#3", "G3",
    "G#3", "A3", "A#3", "B3", "C4", "C#4", "D4", "D#4", "E4",
  ];
  const name = names[fret];
  if (!name) throw new Error(`no name for fret ${fret}`);
  return at(0, fret, name);
};

// Bass string 0 is E1 (MIDI 28).
const BASS_STRING = (fret: number) => {
  const names = [
    "E1", "F1", "F#1", "G1", "G#1", "A1", "A#1", "B1",
    "C2", "C#2", "D2", "D#2", "E2",
  ];
  const name = names[fret];
  if (!name) throw new Error(`no name for fret ${fret}`);
  return at(0, fret, name);
};

describe("fret jump warning (spec 10.3, thresholds from K-17)", () => {
  it("keeps its thresholds in one place", () => {
    expect(handPositionLimits).toEqual({ guitarMaxShift: 7, bassMaxShift: 5 });
    expect(maxShiftFor("electric_guitar")).toBe(7);
    expect(maxShiftFor("steel_acoustic")).toBe(7);
    expect(maxShiftFor("nylon_guitar")).toBe(7);
    expect(maxShiftFor("electric_bass")).toBe(5);
    // Drums and the phase 2.5 instruments have no hand position to warn about.
    expect(maxShiftFor("drum_kit")).toBeNull();
    expect(maxShiftFor("piano")).toBeNull();
  });

  it("says nothing about a seven-fret move on a guitar", () => {
    const subject = guitarSong([
      melodicBar("gtr", line(slot(E_STRING(0)), slot(E_STRING(7)))),
    ]);
    expect(validateFretJump(subject)).toEqual([]);
  });

  it("warns about an eight-fret move on a guitar", () => {
    const subject = guitarSong([
      melodicBar("gtr", line(slot(E_STRING(0)), slot(E_STRING(8)))),
    ]);
    const issues = validateFretJump(subject);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "fretJump",
      severity: "warning",
      sectionId: "s1",
      barIndex: 0,
      trackId: "gtr",
      slotIndex: 1,
    });
    expect(issues[0]?.message).toContain("8 perde");
  });

  it("says nothing about a five-fret move on a bass", () => {
    const subject = song(
      [BASS],
      [section([melodicBar("bass", line(slot(BASS_STRING(0)), slot(BASS_STRING(5))))])],
    );
    expect(validateFretJump(subject)).toEqual([]);
  });

  it("warns about a six-fret move on a bass", () => {
    const subject = song(
      [BASS],
      [section([melodicBar("bass", line(slot(BASS_STRING(0)), slot(BASS_STRING(6))))])],
    );
    expect(validateFretJump(subject)).toHaveLength(1);
  });

  it("counts the capo as part of the physical fret (spec 9.1)", () => {
    const capoed: Fretboard = {
      tuning: ["E2", "A2", "D3", "G3", "B3", "E4"],
      capo: 5,
    };
    // Written frets 0 and 7 are physical 5 and 12: still a seven-fret move.
    const withinReach = song(
      [guitarTrack({ fretboard: capoed })],
      [
        section([
          melodicBar(
            "gtr",
            line(slot(at(0, 0, "A2")), slot(at(0, 7, "E3"))),
          ),
        ]),
      ],
    );
    expect(validateFretJump(withinReach)).toEqual([]);

    // The message names the physical frets, not the written ones.
    const tooFar = song(
      [guitarTrack({ fretboard: capoed })],
      [
        section([
          melodicBar(
            "gtr",
            line(slot(at(0, 0, "A2")), slot(at(0, 8, "F3"))),
          ),
        ]),
      ],
    );
    const issues = validateFretJump(tooFar);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("5. perdeden 13. perdeye");
  });

  it("anchors a chord at its median fretted position", () => {
    expect(medianOf([1, 2, 12])).toBe(2);
    expect(medianOf([2, 4])).toBe(2);
    expect(medianOf([])).toBeNull();

    // A chord at frets 0, 1, 2 anchors at 1, so a move to fret 8 is seven.
    const subject = guitarSong([
      melodicBar(
        "gtr",
        line(
          slot(at(0, 0, "E2"), at(1, 1, "A#2"), at(2, 2, "E3")),
          slot(E_STRING(8)),
        ),
      ),
    ]);
    expect(validateFretJump(subject)).toEqual([]);

    // One stretched finger does not drag the anchor with it: 0, 1, 12 still
    // anchors at 1.
    const stretched = guitarSong([
      melodicBar(
        "gtr",
        line(
          slot(at(0, 0, "E2"), at(1, 1, "A#2"), at(2, 12, "D4")),
          slot(E_STRING(8)),
        ),
      ),
    ]);
    expect(validateFretJump(stretched)).toEqual([]);
  });

  it("anchors an open-string-only onset at zero", () => {
    const subject = guitarSong([
      melodicBar("gtr", line(slot(at(0, 0, "E2"), at(1, 0, "A2")), slot(E_STRING(8)))),
    ]);
    expect(validateFretJump(subject)).toHaveLength(1);
  });

  it("does not count a tie as a new hand position", () => {
    // The held note would look like an onset at fret 0 without the tie rule.
    const subject = guitarSong([
      melodicBar(
        "gtr",
        line(slot(E_STRING(12)), "-", "-", slot(E_STRING(12))),
      ),
    ]);
    expect(validateFretJump(subject)).toEqual([]);
  });

  it("forgets the previous anchor after a whole bar of silence", () => {
    const rest = melodicBar("gtr", restSlots(8));
    const subject = guitarSong([
      melodicBar("gtr", line(slot(E_STRING(0)))),
      rest,
      melodicBar("gtr", line(slot(E_STRING(14)))),
    ]);
    expect(validateFretJump(subject)).toEqual([]);
  });

  it("does not treat a bar filled by a held note as a free bar", () => {
    // The note rings through the whole middle bar, so the hand is still on it
    // and the leap that follows is a real one.
    const held = restSlots(8);
    held[0] = slot(E_STRING(0));
    for (let index = 1; index < held.length; index += 1) held[index] = "-";
    const carried = restSlots(8);
    for (let index = 0; index < carried.length; index += 1) carried[index] = "-";

    const subject = guitarSong([
      melodicBar("gtr", held),
      melodicBar("gtr", carried),
      melodicBar("gtr", line(slot(E_STRING(14)))),
    ]);
    const issues = validateFretJump(subject);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ barIndex: 2, slotIndex: 0 });
  });

  it("still carries the anchor across a section boundary", () => {
    const subject = song(
      [guitarTrack()],
      [
        section([melodicBar("gtr", line(slot(E_STRING(0))))], { id: "a", name: "A" }),
        section([melodicBar("gtr", line(slot(E_STRING(14))))], { id: "b", name: "B" }),
      ],
    );
    const issues = validateFretJump(subject);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ sectionId: "b", barIndex: 0, slotIndex: 0 });
  });

  it("skips drums and instruments with no fretboard", () => {
    const kit = song(
      [drumTrack()],
      [section([melodicBar("drums", line(slot(E_STRING(0)), slot(E_STRING(14))))])],
    );
    expect(validateFretJump(kit)).toEqual([]);

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
      [section([melodicBar("pno", line(slot({ pitch: "C4" }), slot({ pitch: "C6" })))])],
    );
    expect(validateFretJump(piano)).toEqual([]);
  });

  it("reports one issue per transition, in section, bar and slot order", () => {
    const subject = song(
      [guitarTrack()],
      [
        section(
          [
            melodicBar("gtr", line(slot(E_STRING(0)), slot(E_STRING(12)))),
            melodicBar("gtr", line(slot(E_STRING(0)))),
          ],
          { id: "a", name: "A" },
        ),
        section([melodicBar("gtr", line(slot(E_STRING(14))))], { id: "b", name: "B" }),
      ],
    );

    const path = validateFretJump(subject).map((issue) => [
      issue.sectionId,
      issue.barIndex,
      issue.slotIndex,
    ]);
    expect(path).toEqual([
      ["a", 0, 1],
      ["a", 1, 0],
      ["b", 0, 0],
    ]);
    expect(validateFretJump(subject)).toEqual(validateFretJump(subject));
  });
});

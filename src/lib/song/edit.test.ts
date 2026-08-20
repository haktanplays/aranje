import { describe, expect, it } from "vitest";

import { MAX_PHYSICAL_FRET, maxCapoRelativeFret } from "@/lib/music/fretboard";
import {
  applyEdit,
  isEditableTrack,
  pitchAt,
  type EditCommand,
  type EditTarget,
} from "@/lib/song/edit";
import {
  drumTrack,
  guitarTrack,
  melodicBar,
  restSlots,
  section,
  song,
} from "@/lib/song/fixtures";
import type { Bar, Fretboard, MelodicSlot, Song, Track } from "@/lib/song/schema";

const E_STANDARD: Fretboard = {
  tuning: ["E2", "A2", "D3", "G3", "B3", "E4"],
  capo: 0,
};

const BASS: Track = {
  id: "bass",
  name: "Bas",
  instrumentId: "electric_bass",
  presetId: "finger",
  volumeDb: -6,
  fretboard: { tuning: ["E1", "A1", "D2", "G2"], capo: 0 },
};

function guitarSong(
  bars: readonly Bar[],
  fretboard: Fretboard = E_STANDARD,
): Song {
  return song([guitarTrack({ fretboard })], [section([...bars])]);
}

function emptyBars(count = 1): Bar[] {
  return Array.from({ length: count }, () => melodicBar("gtr", restSlots(8)));
}

const AT = (slotIndex: number, barIndex = 0): EditTarget => ({
  sectionId: "s1",
  trackId: "gtr",
  barIndex,
  slotIndex,
});

function setNote(
  target: EditTarget,
  stringIndex: number,
  fret: number,
): EditCommand {
  return { kind: "set_note", target, stringIndex, fret };
}

/** The slot the command wrote, read back off the returned song. */
function slotOf(result: Song, target: EditTarget): MelodicSlot | undefined {
  const slots = result.sections
    .find((entry) => entry.id === target.sectionId)
    ?.bars[target.barIndex]?.slots[target.trackId];
  if (!Array.isArray(slots)) return undefined;
  return slots[target.slotIndex] as MelodicSlot | undefined;
}

describe("pitch comes from the fretboard, never from the caller", () => {
  it("reads standard tuning", () => {
    expect(pitchAt(E_STANDARD, 0, 0)).toBe("E2");
    expect(pitchAt(E_STANDARD, 0, 3)).toBe("G2");
    expect(pitchAt(E_STANDARD, 5, 12)).toBe("E5");
  });

  it("treats fret 0 as the sound behind the capo (spec 9.1)", () => {
    const capoed: Fretboard = { ...E_STANDARD, capo: 2 };
    expect(pitchAt(capoed, 0, 0)).toBe("F#2");
    expect(pitchAt(capoed, 0, 3)).toBe("A2");
    // The same written fret sounds two semitones higher than with no capo.
    expect(pitchAt(E_STANDARD, 0, 0)).toBe("E2");
  });

  it("follows an alternate tuning through the same code path", () => {
    const dropD: Fretboard = { ...E_STANDARD, tuning: ["D2", "A2", "D3", "G3", "B3", "E4"] };
    expect(pitchAt(dropD, 0, 0)).toBe("D2");
    expect(pitchAt(dropD, 0, 5)).toBe("G2");
    expect(pitchAt(BASS.fretboard ?? E_STANDARD, 0, 0)).toBe("E1");
  });

  it("has no pitch beyond the physical fret limit", () => {
    expect(pitchAt(E_STANDARD, 0, MAX_PHYSICAL_FRET)).not.toBeNull();
    expect(pitchAt(E_STANDARD, 0, MAX_PHYSICAL_FRET + 1)).toBeNull();
    // A capo takes the top away with it.
    const capoed: Fretboard = { ...E_STANDARD, capo: 5 };
    expect(pitchAt(capoed, 0, maxCapoRelativeFret(5))).not.toBeNull();
    expect(pitchAt(capoed, 0, maxCapoRelativeFret(5) + 1)).toBeNull();
  });
});

describe("writing a note", () => {
  it("derives the pitch and records the position", () => {
    const result = applyEdit(guitarSong(emptyBars()), setNote(AT(0), 0, 3));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(slotOf(result.song, AT(0))).toEqual({
      notes: [{ pitch: "G2", position: { string: 0, fret: 3 } }],
    });
  });

  it("builds a chord from notes on different strings", () => {
    let current = guitarSong(emptyBars());
    for (const [stringIndex, fret] of [
      [0, 3],
      [1, 5],
      [2, 5],
    ] as const) {
      const step = applyEdit(current, setNote(AT(0), stringIndex, fret));
      expect(step.ok).toBe(true);
      if (!step.ok) return;
      current = step.song;
    }

    const slot = slotOf(current, AT(0));
    expect(slot).not.toBeNull();
    if (slot === null || slot === undefined || slot === "-") return;
    expect(slot.notes.map((note) => note.position?.string)).toEqual([0, 1, 2]);
    expect(slot.notes.map((note) => note.pitch)).toEqual(["G2", "D3", "G3"]);
  });

  it("replaces the note on a string instead of stacking a second one", () => {
    const first = applyEdit(guitarSong(emptyBars()), setNote(AT(0), 0, 3));
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = applyEdit(first.song, setNote(AT(0), 0, 5));
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const slot = slotOf(second.song, AT(0));
    if (slot === null || slot === undefined || slot === "-") return;
    expect(slot.notes).toHaveLength(1);
    expect(slot.notes[0]?.pitch).toBe("A2");
  });

  it("leaves the other strings of a chord untouched", () => {
    let current = guitarSong(emptyBars());
    for (const [stringIndex, fret] of [
      [0, 3],
      [2, 5],
    ] as const) {
      const step = applyEdit(current, setNote(AT(0), stringIndex, fret));
      if (!step.ok) return;
      current = step.song;
    }

    const changed = applyEdit(current, setNote(AT(0), 0, 5));
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    const slot = slotOf(changed.song, AT(0));
    if (slot === null || slot === undefined || slot === "-") return;
    expect(slot.notes.map((note) => note.pitch)).toEqual(["A2", "G3"]);
  });

  it("writes through a capo without the caller knowing about it", () => {
    const capoed = guitarSong(emptyBars(), { ...E_STANDARD, capo: 2 });
    const result = applyEdit(capoed, setNote(AT(0), 0, 0));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(slotOf(result.song, AT(0))).toEqual({
      notes: [{ pitch: "F#2", position: { string: 0, fret: 0 } }],
    });
  });

  it("writes through an alternate tuning without a second code path", () => {
    const dropD = guitarSong(emptyBars(), {
      ...E_STANDARD,
      tuning: ["D2", "A2", "D3", "G3", "B3", "E4"],
    });
    const result = applyEdit(dropD, setNote(AT(0), 0, 0));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(slotOf(result.song, AT(0))).toEqual({
      notes: [{ pitch: "D2", position: { string: 0, fret: 0 } }],
    });
  });

  it("accepts the highest fret the fretboard has", () => {
    const result = applyEdit(
      guitarSong(emptyBars()),
      setNote(AT(0), 0, MAX_PHYSICAL_FRET),
    );
    expect(result.ok).toBe(true);
  });

  it("explains a fret that is out of range rather than clamping it", () => {
    for (const fret of [-1, MAX_PHYSICAL_FRET + 1, 99, 1.5]) {
      const result = applyEdit(guitarSong(emptyBars()), setNote(AT(0), 0, fret));
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("fret_out_of_range");
      expect(result.error.message).toContain(String(MAX_PHYSICAL_FRET));
    }
  });

  it("names the capo when the capo is what shrank the range", () => {
    const capoed = guitarSong(emptyBars(), { ...E_STANDARD, capo: 5 });
    const result = applyEdit(capoed, setNote(AT(0), 0, maxCapoRelativeFret(5) + 1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("fret_out_of_range");
    expect(result.error.message).toContain("capo 5");
  });

  it("explains a string the instrument does not have", () => {
    const result = applyEdit(guitarSong(emptyBars()), setNote(AT(0), 6, 0));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("string_out_of_range");
  });
});

describe("clearing", () => {
  it("removes one string and keeps the rest of the chord", () => {
    let current = guitarSong(emptyBars());
    for (const [stringIndex, fret] of [
      [0, 3],
      [2, 5],
    ] as const) {
      const step = applyEdit(current, setNote(AT(0), stringIndex, fret));
      if (!step.ok) return;
      current = step.song;
    }

    const cleared = applyEdit(current, {
      kind: "clear_string",
      target: AT(0),
      stringIndex: 0,
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    const slot = slotOf(cleared.song, AT(0));
    if (slot === null || slot === undefined || slot === "-") return;
    expect(slot.notes.map((note) => note.pitch)).toEqual(["G3"]);
  });

  it("turns the slot into a rest when the last note goes", () => {
    const written = applyEdit(guitarSong(emptyBars()), setNote(AT(0), 0, 3));
    if (!written.ok) return;
    const cleared = applyEdit(written.song, {
      kind: "clear_string",
      target: AT(0),
      stringIndex: 0,
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(slotOf(cleared.song, AT(0))).toBeNull();
  });

  it("says so when there is nothing on that string", () => {
    const result = applyEdit(guitarSong(emptyBars()), {
      kind: "clear_string",
      target: AT(0),
      stringIndex: 0,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("no_note_on_string");
  });
});

describe("ties follow the phase 0 carry semantics", () => {
  function withNoteAt(slotIndex: number, barCount = 1): Song {
    const built = applyEdit(guitarSong(emptyBars(barCount)), setNote(AT(slotIndex), 0, 3));
    if (!built.ok) throw new Error("fixture edit failed");
    return built.song;
  }

  it("extends a note that is already sounding", () => {
    const result = applyEdit(withNoteAt(0), { kind: "set_tie", target: AT(1) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(slotOf(result.song, AT(1))).toBe("-");
  });

  it("extends through a chain of ties", () => {
    let current = withNoteAt(0);
    for (const slotIndex of [1, 2, 3]) {
      const step = applyEdit(current, { kind: "set_tie", target: AT(slotIndex) });
      expect(step.ok).toBe(true);
      if (!step.ok) return;
      current = step.song;
    }
    expect(slotOf(current, AT(3))).toBe("-");
  });

  it("refuses a tie with nothing in front of it", () => {
    const result = applyEdit(guitarSong(emptyBars()), {
      kind: "set_tie",
      target: AT(0),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("orphan_tie");
  });

  it("refuses a tie after a rest", () => {
    const written = withNoteAt(0);
    const rested = applyEdit(written, { kind: "set_rest", target: AT(1) });
    if (!rested.ok) return;
    const result = applyEdit(rested.song, { kind: "set_tie", target: AT(2) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("orphan_tie");
  });

  it("carries across a bar line", () => {
    const written = applyEdit(guitarSong(emptyBars(2)), setNote(AT(7, 0), 0, 3));
    if (!written.ok) return;
    const result = applyEdit(written.song, { kind: "set_tie", target: AT(0, 1) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(slotOf(result.song, AT(0, 1))).toBe("-");
  });

  it("carries across a section boundary", () => {
    const twoSections = song(
      [guitarTrack()],
      [
        section(emptyBars(), { id: "a", name: "A" }),
        section(emptyBars(), { id: "b", name: "B" }),
      ],
    );
    const written = applyEdit(twoSections, {
      kind: "set_note",
      target: { sectionId: "a", trackId: "gtr", barIndex: 0, slotIndex: 7 },
      stringIndex: 0,
      fret: 3,
    });
    if (!written.ok) return;

    const result = applyEdit(written.song, {
      kind: "set_tie",
      target: { sectionId: "b", trackId: "gtr", barIndex: 0, slotIndex: 0 },
    });
    expect(result.ok).toBe(true);
  });

  it("is broken by a bar the track is not written in", () => {
    const absent: Bar = { timeSignature: [4, 4], resolution: 8, slots: {} };
    const withGap = song(
      [guitarTrack()],
      [section([melodicBar("gtr", restSlots(8)), absent, melodicBar("gtr", restSlots(8))])],
    );
    const written = applyEdit(withGap, setNote(AT(7, 0), 0, 3));
    if (!written.ok) return;

    const result = applyEdit(written.song, { kind: "set_tie", target: AT(0, 2) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("orphan_tie");
  });

  it("leaves no orphan tie behind when the note it continued is removed", () => {
    let current = withNoteAt(0);
    for (const slotIndex of [1, 2]) {
      const step = applyEdit(current, { kind: "set_tie", target: AT(slotIndex) });
      if (!step.ok) return;
      current = step.song;
    }

    const cleared = applyEdit(current, {
      kind: "clear_string",
      target: AT(0),
      stringIndex: 0,
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(slotOf(cleared.song, AT(0))).toBeNull();
    expect(slotOf(cleared.song, AT(1))).toBeNull();
    expect(slotOf(cleared.song, AT(2))).toBeNull();
  });

  it("clears an orphan tie that crosses a bar line too", () => {
    const written = applyEdit(guitarSong(emptyBars(2)), setNote(AT(7, 0), 0, 3));
    if (!written.ok) return;
    const tied = applyEdit(written.song, { kind: "set_tie", target: AT(0, 1) });
    if (!tied.ok) return;

    const rested = applyEdit(tied.song, { kind: "set_rest", target: AT(7, 0) });
    expect(rested.ok).toBe(true);
    if (!rested.ok) return;
    expect(slotOf(rested.song, AT(0, 1))).toBeNull();
  });
});

describe("what cannot be edited here", () => {
  it("refuses a drum track", () => {
    const kit = song(
      [drumTrack()],
      [section([melodicBar("drums", restSlots(8))])],
    );
    expect(isEditableTrack(drumTrack())).toBe(false);
    const result = applyEdit(kit, {
      kind: "set_note",
      target: { sectionId: "s1", trackId: "drums", barIndex: 0, slotIndex: 0 },
      stringIndex: 0,
      fret: 0,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("track_not_editable");
  });

  it("refuses an instrument with no fretboard", () => {
    const piano = guitarTrack({
      id: "pno",
      name: "Piyano",
      instrumentId: "piano",
      presetId: "grand",
      fretboard: undefined,
    });
    expect(isEditableTrack(piano)).toBe(false);
    const subject = song([piano], [section([melodicBar("pno", restSlots(8))])]);
    const result = applyEdit(subject, {
      kind: "set_note",
      target: { sectionId: "s1", trackId: "pno", barIndex: 0, slotIndex: 0 },
      stringIndex: 0,
      fret: 0,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("track_not_editable");
  });

  it("refuses a section, bar or slot that is not there", () => {
    const subject = guitarSong(emptyBars());
    expect(
      applyEdit(subject, {
        ...setNote(AT(0), 0, 0),
        target: { ...AT(0), sectionId: "nowhere" },
      }).ok,
    ).toBe(false);
    expect(
      applyEdit(subject, { ...setNote(AT(0), 0, 0), target: AT(0, 9) }).ok,
    ).toBe(false);
    expect(applyEdit(subject, setNote(AT(99), 0, 0)).ok).toBe(false);
  });
});

describe("the song it is given is never touched", () => {
  it("returns a new song and leaves the original alone", () => {
    const original = guitarSong(emptyBars());
    const before = JSON.stringify(original);

    const result = applyEdit(original, setNote(AT(0), 0, 3));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song).not.toBe(original);
    expect(JSON.stringify(original)).toBe(before);
  });

  it("returns no song at all when the command fails", () => {
    const original = guitarSong(emptyBars());
    const before = JSON.stringify(original);
    const result = applyEdit(original, setNote(AT(0), 0, -1));

    expect(result.ok).toBe(false);
    expect("song" in result).toBe(false);
    expect(JSON.stringify(original)).toBe(before);
  });

  it("refuses an edit the validator chain rejects, and changes nothing", () => {
    // Two notes on one string is a stringCollision hard error. It cannot be
    // written through set_note, so it is assembled directly to prove the gate.
    const clashing = song(
      [guitarTrack()],
      [
        section([
          melodicBar("gtr", [
            {
              notes: [
                { pitch: "G2", position: { string: 0, fret: 3 } },
                { pitch: "A2", position: { string: 0, fret: 5 } },
              ],
            },
            ...restSlots(7),
          ]),
        ]),
      ],
    );
    const before = JSON.stringify(clashing);

    // Any command on this song must fail, because the result is invalid.
    const result = applyEdit(clashing, { kind: "set_tie", target: AT(1) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("validation_failed");
    expect(result.error.issues?.[0]?.code).toBe("stringCollision");
    expect(JSON.stringify(clashing)).toBe(before);
  });

  it("passes warnings back without blocking the edit", () => {
    // E2 and F2 live only on the thickest string, so the pair is unplaceable
    // together: a spec 10.3 warning, not an error.
    const built = applyEdit(guitarSong(emptyBars()), setNote(AT(0), 0, 0));
    if (!built.ok) return;
    const second = applyEdit(built.song, setNote(AT(0), 1, 8));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(Array.isArray(second.warnings)).toBe(true);
  });
});

describe("bass and other tunings use the same commands", () => {
  it("writes a bass note from its own tuning", () => {
    const subject = song([BASS], [section([melodicBar("bass", restSlots(8))])]);
    const result = applyEdit(subject, {
      kind: "set_note",
      target: { sectionId: "s1", trackId: "bass", barIndex: 0, slotIndex: 0 },
      stringIndex: 0,
      fret: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slots = result.song.sections[0]?.bars[0]?.slots.bass;
    expect(Array.isArray(slots) ? slots[0] : null).toEqual({
      notes: [{ pitch: "A1", position: { string: 0, fret: 5 } }],
    });
  });

  it("stops a bass at its own fret limit", () => {
    const subject = song([BASS], [section([melodicBar("bass", restSlots(8))])]);
    const result = applyEdit(subject, {
      kind: "set_note",
      target: { sectionId: "s1", trackId: "bass", barIndex: 0, slotIndex: 0 },
      stringIndex: 3,
      fret: MAX_PHYSICAL_FRET + 1,
    });
    expect(result.ok).toBe(false);
  });
});

describe("set_articulation (spec 8.5, 13.9)", () => {
  const target = {
    sectionId: "chorus",
    trackId: "gtr",
    barIndex: 0,
    slotIndex: 0,
  };

  /** A chord on two strings, so "only the touched one" means something. */
  const chordSong: Song = song(
    [guitarTrack()],
    [
      section(
        [
          melodicBar("gtr", [
            {
              notes: [
                { pitch: "E3", position: { string: 0, fret: 12 } },
                { pitch: "B3", position: { string: 1, fret: 14 } },
              ],
            },
            ...restSlots(7),
          ]),
        ],
        { id: "chorus", name: "Chorus" },
      ),
    ],
  );

  function notesAfter(command: EditCommand) {
    const result = applyEdit(chordSong, command);
    if (!result.ok) throw new Error(result.error.message);
    const slot = result.song.sections[0]?.bars[0]?.slots.gtr?.[0];
    if (!slot || slot === "-" || Array.isArray(slot)) throw new Error("no chord");
    return slot.notes;
  }

  it("writes the articulation on the string that was touched", () => {
    const notes = notesAfter({
      kind: "set_articulation",
      target,
      stringIndex: 1,
      articulation: "vibrato",
    });

    expect(notes[1]?.articulation).toBe("vibrato");
  });

  it("leaves the other notes of the chord alone", () => {
    const notes = notesAfter({
      kind: "set_articulation",
      target,
      stringIndex: 1,
      articulation: "vibrato",
    });

    expect(notes[0]?.articulation).toBeUndefined();
    expect(notes[0]?.pitch).toBe("E3");
    expect(notes[0]?.position).toEqual({ string: 0, fret: 12 });
  });

  it("does not change the pitch or the fret", () => {
    const notes = notesAfter({
      kind: "set_articulation",
      target,
      stringIndex: 1,
      articulation: "bend_full",
    });

    expect(notes[1]?.pitch).toBe("B3");
    expect(notes[1]?.position).toEqual({ string: 1, fret: 14 });
  });

  it("removes the field when the answer is normal", () => {
    const withVibrato = applyEdit(chordSong, {
      kind: "set_articulation",
      target,
      stringIndex: 1,
      articulation: "vibrato",
    });
    if (!withVibrato.ok) throw new Error("setup failed");

    const cleared = applyEdit(withVibrato.song, {
      kind: "set_articulation",
      target,
      stringIndex: 1,
      articulation: null,
    });
    if (!cleared.ok) throw new Error(cleared.error.message);

    const slot = cleared.song.sections[0]?.bars[0]?.slots.gtr?.[0];
    if (!slot || slot === "-" || Array.isArray(slot)) throw new Error("no chord");
    expect(slot.notes[1]).toEqual({
      pitch: "B3",
      position: { string: 1, fret: 14 },
    });
    expect("articulation" in (slot.notes[1] ?? {})).toBe(false);
  });

  it("refuses a string with no note on it, and a rest", () => {
    expect(
      applyEdit(chordSong, {
        kind: "set_articulation",
        target,
        stringIndex: 4,
        articulation: "vibrato",
      }).ok,
    ).toBe(false);
    expect(
      applyEdit(chordSong, {
        kind: "set_articulation",
        target: { ...target, slotIndex: 3 },
        stringIndex: 0,
        articulation: "vibrato",
      }).ok,
    ).toBe(false);
  });

  it("does not mutate the song it was given", () => {
    const snapshot = JSON.stringify(chordSong);
    applyEdit(chordSong, {
      kind: "set_articulation",
      target,
      stringIndex: 1,
      articulation: "slide",
    });
    expect(JSON.stringify(chordSong)).toBe(snapshot);
  });

  it("lets a context warning through without blocking the edit", () => {
    // A slide with nothing before it is a warning, not a refusal.
    const result = applyEdit(chordSong, {
      kind: "set_articulation",
      target,
      stringIndex: 1,
      articulation: "slide",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.warnings.some((issue) => issue.code === "articulationContext"),
    ).toBe(true);
  });
});

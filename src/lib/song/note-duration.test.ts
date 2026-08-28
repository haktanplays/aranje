import { describe, expect, it } from "vitest";

import {
  currentDurationTicks,
  durationFromDrag,
  maxDurationTicks,
  setNoteDuration,
  slotTicksAt,
  type DurationTarget,
} from "@/lib/song/note-duration";
import { applyEdit } from "@/lib/song/edit";
import { SONG_VERSION, type MelodicSlot, type Song } from "@/lib/song/schema";

const TRACK = "t1";
const SECTION = "s1";

/**
 * The Android acceptance shape, in miniature: a `3` at slot 0 and a `0` at
 * slot 2 that has to survive whatever happens to the `3`.
 */
function fixture(slots: MelodicSlot[] = defaultSlots()): Song {
  return {
    version: SONG_VERSION,
    title: "t",
    bpm: 100,
    key: "E minor",
    tracks: [
      {
        id: TRACK,
        name: "Gitar",
        instrumentId: "electric_guitar",
        presetId: "high_gain",
        volumeDb: -6,
        fretboard: { tuning: ["E2", "A2", "D3", "G3", "B3", "E4"], capo: 0 },
      },
    ],
    sections: [
      {
        id: SECTION,
        name: "Ana Riff",
        status: "fixed",
        bars: [
          { timeSignature: [4, 4], resolution: 16, slots: { [TRACK]: slots } },
          {
            timeSignature: [4, 4],
            resolution: 16,
            slots: { [TRACK]: Array.from({ length: 16 }, () => null) },
          },
        ],
      },
    ],
  };
}

function defaultSlots(): MelodicSlot[] {
  const slots: MelodicSlot[] = Array.from({ length: 16 }, () => null);
  slots[0] = { notes: [{ pitch: "G2", position: { string: 0, fret: 3 } }] };
  slots[2] = { notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }] };
  return slots;
}

const at = (over: Partial<DurationTarget> = {}): DurationTarget => ({
  sectionId: SECTION,
  barIndex: 0,
  trackId: TRACK,
  slotIndex: 0,
  noteIndex: 0,
  ...over,
});

const slotsOf = (song: Song) => song.sections[0]!.bars[0]!.slots[TRACK] as MelodicSlot[];

describe("the defect this replaces", () => {
  /*
   * The old way to lengthen a note: select the slot after it and tie. It is
   * still the right command for an empty slot — and it is why the acceptance
   * fixture lost its `0`, because a tie is written *over* whatever is there.
   */
  it("shows the old tie command destroying the next note", () => {
    /* The `3` and the `0` next to each other, which is when a tie is legal. */
    const adjacent: MelodicSlot[] = Array.from({ length: 16 }, () => null);
    adjacent[0] = { notes: [{ pitch: "G2", position: { string: 0, fret: 3 } }] };
    adjacent[1] = { notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }] };
    const song = fixture(adjacent);

    const result = applyEdit(song, {
      kind: "set_tie",
      target: { sectionId: SECTION, barIndex: 0, trackId: TRACK, slotIndex: 1 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    /* The `0` is gone: this is the founder's finding, reproduced. */
    expect(slotsOf(result.song)[1]).toBe("-");
  });

  /*
   * And the same shape through the new control: the `3` gets longer and the
   * `0` beside it is still there. Both notes, both lengths, one edit.
   */
  it("keeps the next note when the length is set on the note instead", () => {
    const adjacent: MelodicSlot[] = Array.from({ length: 16 }, () => null);
    adjacent[0] = { notes: [{ pitch: "G2", position: { string: 0, fret: 3 } }] };
    adjacent[1] = { notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }] };
    const song = fixture(adjacent);

    const result = setNoteDuration(song, at(), 96);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(slotsOf(result.song)[1]).toEqual(adjacent[1]);
  });
});

describe("setNoteDuration", () => {
  it("lengthens the note it was given", () => {
    const result = setNoteDuration(fixture(), at(), 96);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slot = slotsOf(result.song)[0];
    expect(slot).not.toBeNull();
    if (slot === null || slot === "-" || slot === undefined) return;
    expect(slot.notes[0]!.durationTicks).toBe(96);
  });

  /*
   * The whole point. One slot of drag lengthens the `3` and the `0` two slots
   * later is byte-identical — not moved, not shortened, not gone.
   */
  it("leaves every other slot byte-identical, the next note included", () => {
    const song = fixture();
    const before = JSON.stringify(slotsOf(song).filter((_, i) => i !== 0));
    const result = setNoteDuration(song, at(), 96);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(JSON.stringify(slotsOf(result.song).filter((_, i) => i !== 0))).toBe(before);
    expect(slotsOf(result.song)[2]).toEqual(slotsOf(song)[2]);
  });

  it("does not touch the input song", () => {
    const song = fixture();
    const snapshot = JSON.stringify(song);
    setNoteDuration(song, at(), 192);
    expect(JSON.stringify(song)).toBe(snapshot);
  });

  it("keeps pitch, position and articulation while changing only the length", () => {
    const song = fixture();
    const slots = slotsOf(song);
    slots[0] = {
      notes: [
        {
          pitch: "G2",
          position: { string: 0, fret: 3 },
          articulation: "palm_mute",
          velocity: 90,
        },
      ],
    };
    const result = setNoteDuration(song, at(), 144);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slot = slotsOf(result.song)[0];
    if (slot === null || slot === "-" || slot === undefined) return;
    expect(slot.notes[0]).toEqual({
      pitch: "G2",
      position: { string: 0, fret: 3 },
      articulation: "palm_mute",
      velocity: 90,
      durationTicks: 144,
    });
  });

  it("changes one voice of a chord and leaves the others alone", () => {
    const song = fixture();
    slotsOf(song)[0] = {
      notes: [{ pitch: "E2" }, { pitch: "B2" }, { pitch: "E3" }],
    };
    const result = setNoteDuration(song, at({ noteIndex: 1 }), 384);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slot = slotsOf(result.song)[0];
    if (slot === null || slot === "-" || slot === undefined) return;
    expect(slot.notes.map((n) => n.durationTicks)).toEqual([undefined, 384, undefined]);
  });

  /*
   * A note dragged out and back is the same bytes as one never touched. A
   * default written down would be a difference a diff can see and the music
   * cannot hear.
   */
  it("drops the field when a note goes back to one slot", () => {
    const stretched = setNoteDuration(fixture(), at(), 192);
    expect(stretched.ok).toBe(true);
    if (!stretched.ok) return;
    const back = setNoteDuration(stretched.song, at(), 48);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(JSON.stringify(back.song)).toBe(JSON.stringify(fixture()));
  });

  it("refuses a length the music has no room for, rather than clipping it", () => {
    const tooLong = maxDurationTicks(fixture(), at()) + 1;
    expect(setNoteDuration(fixture(), at(), tooLong)).toEqual({
      ok: false,
      reason: "duration_out_of_range",
    });
  });

  it.each([
    ["zero", 0],
    ["negative", -48],
    ["fractional", 48.5],
  ])("refuses a %s length", (_name, ticks) => {
    expect(setNoteDuration(fixture(), at(), ticks).ok).toBe(false);
  });

  it.each([
    ["a rest", 1, "not_an_onset"],
    ["a slot past the end", 99, "target_not_found"],
  ])("refuses %s", (_name, slotIndex, reason) => {
    expect(setNoteDuration(fixture(), at({ slotIndex }), 96)).toEqual({
      ok: false,
      reason,
    });
  });

  it("refuses a note index that is not there", () => {
    expect(setNoteDuration(fixture(), at({ noteIndex: 4 }), 96)).toEqual({
      ok: false,
      reason: "note_not_found",
    });
  });

  it("refuses a section or bar that is not there", () => {
    expect(setNoteDuration(fixture(), at({ sectionId: "nope" }), 96).ok).toBe(false);
    expect(setNoteDuration(fixture(), at({ barIndex: 9 }), 96).ok).toBe(false);
  });
});

describe("the drag arithmetic", () => {
  /*
   * §2.5: one grid step must be one grid step. The old complaint was a note
   * running to the end of the bar from a single step of movement.
   */
  it("moves exactly one grid step per step of drag", () => {
    const song = fixture();
    expect(slotTicksAt(song, at())).toBe(48);
    expect(durationFromDrag(song, at(), 1)).toBe(96);
    expect(durationFromDrag(song, at(), 2)).toBe(144);
    expect(durationFromDrag(song, at(), 3)).toBe(192);
  });

  it("starts from the length the note already has", () => {
    const stretched = setNoteDuration(fixture(), at(), 192);
    expect(stretched.ok).toBe(true);
    if (!stretched.ok) return;
    expect(currentDurationTicks(stretched.song, at())).toBe(192);
    expect(durationFromDrag(stretched.song, at(), 1)).toBe(240);
  });

  it("quantises a wobbling finger to whole steps", () => {
    const song = fixture();
    expect(durationFromDrag(song, at(), 1.2)).toBe(96);
    expect(durationFromDrag(song, at(), 0.7)).toBe(96);
    expect(durationFromDrag(song, at(), 0.4)).toBe(48);
  });

  it("never drags a note shorter than one slot", () => {
    expect(durationFromDrag(fixture(), at(), -20)).toBe(48);
  });

  it("stops at the end of the music rather than running past it", () => {
    const song = fixture();
    expect(durationFromDrag(song, at(), 999)).toBe(maxDurationTicks(song, at()));
  });

  it("counts the room in every bar of the section, on each bar's own grid", () => {
    /* 16 slots left in bar 0 at 48 ticks, plus a whole 4/4 bar. */
    expect(maxDurationTicks(fixture(), at())).toBe(768 + 768);
    expect(maxDurationTicks(fixture(), at({ slotIndex: 8 }))).toBe(384 + 768);
  });

  it("uses the grid the bar is actually on", () => {
    const song = fixture();
    song.sections[0]!.bars[0]!.resolution = 32;
    song.sections[0]!.bars[0]!.slots[TRACK] = [
      { notes: [{ pitch: "G2" }] },
      ...Array.from({ length: 31 }, () => null),
    ] as MelodicSlot[];
    expect(slotTicksAt(song, at())).toBe(24);
    expect(durationFromDrag(song, at(), 1)).toBe(48);
  });
});

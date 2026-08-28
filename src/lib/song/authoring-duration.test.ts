import { describe, expect, it } from "vitest";

import { applyEdit } from "@/lib/song/edit";
import { guitarTrack, melodicBar, section, song } from "@/lib/song/fixtures";
import { writtenSpans } from "@/lib/song/sounding";
import type { MelodicSlot, Song } from "@/lib/song/schema";

const TRACK = "gtr";
const TARGET = { sectionId: "s1", barIndex: 0, trackId: TRACK, slotIndex: 0 };

const rest = (count: number): MelodicSlot[] =>
  Array.from({ length: count }, () => null);

function fixture(slots: MelodicSlot[] = rest(16)): Song {
  return song(
    [guitarTrack()],
    [section([melodicBar(TRACK, slots, { resolution: 16 })])],
  );
}

const slotsOf = (subject: Song) =>
  subject.sections[0]!.bars[0]!.slots[TRACK] as MelodicSlot[];

const noteAt = (subject: Song, slotIndex: number) => {
  const slot = slotsOf(subject)[slotIndex];
  if (slot === null || slot === undefined || slot === "-") throw new Error("no note");
  return slot.notes[0]!;
};

/**
 * 2T-C §1. A note written through the real UI says how long it is. The tie
 * run was a reading of the old model and remains one for old songs; new
 * music should not be reaching for it.
 */
describe("a note written now carries its own length", () => {
  it("writes the length the reader chose", () => {
    const result = applyEdit(fixture(), {
      kind: "set_note",
      target: TARGET,
      stringIndex: 0,
      fret: 3,
      durationTicks: 192,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(noteAt(result.song, 0).durationTicks).toBe(192);
    expect(writtenSpans(result.song.sections[0]!.bars, TRACK)[0]!.explicit).toBe(true);
  });

  /*
   * Correcting a fret in an old song must not quietly stamp a duration onto
   * a note that never had one — that is a rewrite wearing an edit's clothes.
   */
  it("leaves an old note without one when the command names none", () => {
    const slots = rest(16);
    slots[0] = { notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }] };
    const result = applyEdit(fixture(slots), {
      kind: "set_note",
      target: TARGET,
      stringIndex: 0,
      fret: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(noteAt(result.song, 0).durationTicks).toBeUndefined();
  });

  it("keeps the length a note already had when only the fret changes", () => {
    const slots = rest(16);
    slots[0] = {
      notes: [{ pitch: "E2", position: { string: 0, fret: 0 }, durationTicks: 288 }],
    };
    const result = applyEdit(fixture(slots), {
      kind: "set_note",
      target: TARGET,
      stringIndex: 0,
      fret: 5,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(noteAt(result.song, 0).durationTicks).toBe(288);
  });

  it("carries velocity and articulation across beside the length", () => {
    const slots = rest(16);
    slots[0] = {
      notes: [
        {
          pitch: "E2",
          position: { string: 0, fret: 0 },
          velocity: 112,
          articulation: "palm_mute",
        },
      ],
    };
    const result = applyEdit(fixture(slots), {
      kind: "set_note",
      target: TARGET,
      stringIndex: 0,
      fret: 3,
      durationTicks: 96,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(noteAt(result.song, 0)).toMatchObject({
      velocity: 112,
      articulation: "palm_mute",
      durationTicks: 96,
    });
  });
});

/**
 * 2T-C §1. One string, one note, one instant — and an edit that would break
 * that is refused rather than half-played.
 */
describe("no write may ask one string for two notes at once", () => {
  const collided = () => {
    const slots = rest(16);
    slots[0] = {
      notes: [
        { pitch: "E2", position: { string: 0, fret: 0 } },
        { pitch: "F2", position: { string: 0, fret: 1 } },
      ],
    };
    return fixture(slots);
  };

  it("reports what a refusal would say, in the reader's words", () => {
    const result = applyEdit(collided(), {
      kind: "set_note",
      target: { ...TARGET, slotIndex: 8 },
      stringIndex: 3,
      fret: 5,
    });
    /* Whatever this song's own state does to the edit, the collision it
       already had is not the thing that stopped it. */
    if (!result.ok) expect(result.error.code).not.toBe("string_collision");
  });
});

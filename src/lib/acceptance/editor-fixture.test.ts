/**
 * That the fixture can carry the seven steps (2U-A handoff §3).
 *
 * A fixture is only as good as the steps it makes possible. Each test here
 * names a step that would be impossible without the shape it checks — a paste
 * with no empty target, a measure move with no free neighbour, a
 * "reaches every track" claim on a song with one track.
 */
import { describe, expect, it } from "vitest";

import {
  EDITOR_BASS_ID,
  EDITOR_GUITAR_ID,
  EDITOR_LANDMARKS,
  editorFixture,
} from "@/lib/acceptance/editor-fixture";
import { songSchema } from "@/lib/song/schema";
import { runValidators, SONG_VALIDATORS } from "@/lib/validators";
import { errorsOnly } from "@/lib/validators/types";

const slotsOf = (barIndex: number, trackId: string) =>
  editorFixture().sections[0]!.bars[barIndex]!.slots[trackId]!;

const struck = (barIndex: number, trackId: string) =>
  slotsOf(barIndex, trackId).filter(
    (slot) => slot !== null && slot !== "-" && !Array.isArray(slot),
  );

describe("the fixture is a song the app would accept", () => {
  it("passes the schema", () => {
    expect(songSchema.safeParse(editorFixture()).success).toBe(true);
  });

  it("raises no hard validation error", () => {
    expect(errorsOnly(runValidators(editorFixture(), SONG_VALIDATORS))).toEqual([]);
  });

  it("hands out a new song every time, sharing nothing", () => {
    const first = editorFixture();
    const second = editorFixture();
    expect(first).not.toBe(second);
    expect(first.sections[0]!.bars[0]).not.toBe(second.sections[0]!.bars[0]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("what each step needs is already there", () => {
  /*
   * Step 5 and step 6 claim an operation reaches every track. On a one-track
   * song that claim cannot be false, so it would be measuring nothing.
   */
  it("has two tracks, both written in", () => {
    const song = editorFixture();
    expect(song.tracks.map((track) => track.id)).toEqual([
      EDITOR_GUITAR_ID,
      EDITOR_BASS_ID,
    ]);
    expect(struck(0, EDITOR_GUITAR_ID).length).toBeGreaterThan(0);
    expect(struck(0, EDITOR_BASS_ID).length).toBeGreaterThan(0);
  });

  it("has at least three bars", () => {
    expect(editorFixture().sections[0]!.bars.length).toBeGreaterThanOrEqual(3);
  });

  /* Step 1 selects a motif; step 4 moves it in three different ways. */
  it("opens with a chord and follows it with single notes", () => {
    const first = slotsOf(0, EDITOR_GUITAR_ID);
    const chord = first[EDITOR_LANDMARKS.motifStart.slotIndex];
    expect(chord && typeof chord === "object" && !Array.isArray(chord)).toBe(true);
    if (!chord || chord === "-" || Array.isArray(chord)) return;
    expect(chord.notes.length).toBeGreaterThanOrEqual(3);

    const last = first[EDITOR_LANDMARKS.motifEnd.slotIndex];
    expect(last && last !== "-" && !Array.isArray(last) && last.notes).toHaveLength(1);
  });

  /* A string move needs somewhere to go in both directions. */
  it("spreads the motif over more than one string, away from the edges", () => {
    const strings = new Set<number>();
    for (const slot of struck(0, EDITOR_GUITAR_ID)) {
      if (!slot || slot === "-" || Array.isArray(slot)) continue;
      for (const note of slot.notes) {
        if (note.position) strings.add(note.position.string);
      }
    }
    expect(strings.size).toBeGreaterThanOrEqual(3);
    /* Not on the outermost string only: a move needs a neighbour each way. */
    expect([...strings].some((index) => index > 0 && index < 5)).toBe(true);
  });

  /* Step 2 pastes. A paste into occupied space is a refusal, not a paste. */
  it("keeps the paste target empty on every track", () => {
    for (const trackId of [EDITOR_GUITAR_ID, EDITOR_BASS_ID]) {
      expect(struck(EDITOR_LANDMARKS.emptyTarget.barIndex, trackId)).toEqual([]);
    }
  });

  /* Step 6 moves a bar right and duplicates it. Both need free space. */
  it("puts a written bar next to a free one", () => {
    expect(struck(EDITOR_LANDMARKS.movableBar, EDITOR_GUITAR_ID).length).toBeGreaterThan(0);
    expect(struck(EDITOR_LANDMARKS.freeBar, EDITOR_GUITAR_ID)).toEqual([]);
    expect(EDITOR_LANDMARKS.freeBar).toBe(EDITOR_LANDMARKS.movableBar + 1);
  });

  it("gives the multi-measure step two adjacent bars", () => {
    const { start, end } = EDITOR_LANDMARKS.multiBars;
    expect(end).toBe(start + 1);
    expect(end).toBeLessThan(editorFixture().sections[0]!.bars.length);
  });
});

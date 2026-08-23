/**
 * One press, one onset group (spec 13.20 §1, 2N-A).
 *
 * These pin the rule the reproduction in `eval/tab/DEFECTS.json` showed was
 * broken: a press on the middle shape of a legato chain used to come back as
 * six notes across two bars. Every test here is written so that reintroducing
 * that expansion — in either direction, over a tie or over a legato bond —
 * makes it fail.
 */
import { describe, expect, it } from "vitest";

import { pickOnsetAt } from "@/lib/song/onset-selection";
import { ticksPerSlot } from "@/lib/music/timing";
import type { MelodicSlot, Song } from "@/lib/song/schema";
import { bar, REST, sectionOf, slots, song, TIE, TRACK_ID } from "@/test/move-fixtures";

const STEP = ticksPerSlot(8);

/** A power-chord shape: root on the low string, fifth above it. */
const power = (
  fret: number,
  pitches: readonly [string, string],
  articulation?: "hammer_on",
): MelodicSlot => ({
  notes: [
    {
      pitch: pitches[0],
      position: { string: 0, fret },
      ...(articulation === undefined ? {} : { articulation }),
    },
    { pitch: pitches[1], position: { string: 1, fret: fret + 2 } },
  ],
});

/**
 * The reproduction's own shape: three two-note onsets, each hammered onto the
 * one before it, the last of them on the far side of a bar line.
 */
const chainSong = (): Song =>
  song(
    [
      bar(
        slots([
          ...Array.from({ length: 6 }, () => REST),
          power(0, ["E2", "B2"]),
          power(3, ["G2", "D3"], "hammer_on"),
        ]),
      ),
      bar(slots([power(5, ["A2", "E3"], "hammer_on"), REST])),
    ],
  );

const pickAt = (target: Song, ticks: number, sectionId = "s1") =>
  pickOnsetAt(sectionOf(target, sectionId), TRACK_ID, ticks);

describe("81. a press picks up one onset group", () => {
  it("takes every string struck at that moment, and no more", () => {
    /*
     * The exact reading the browser reproduction took: the middle shape of the
     * chain sits at 672 ticks and holds two notes. That is what the press has
     * to come back with — not the six notes of the whole run.
     */
    const picked = pickAt(chainSong(), STEP * 7);
    expect(picked).not.toBeNull();
    expect(picked?.selection.startTicks).toBe(672);
    expect(picked?.selection.endTicks).toBe(768);
    expect(picked?.notes.map((note) => note.pitch)).toEqual(["G2", "D3"]);
  });

  it("does not reach back to the note this one is hammered onto", () => {
    // Backwards expansion is what put the band two slots before the finger.
    const picked = pickAt(chainSong(), STEP * 7);
    expect(picked?.selection.startTicks).toBeGreaterThan(STEP * 6);
  });

  it("does not reach forward to the note hammered onto this one", () => {
    // Forwards expansion is what carried the band over the bar line.
    const picked = pickAt(chainSong(), STEP * 7);
    expect(picked?.selection.endTicks).toBeLessThanOrEqual(STEP * 8);
  });

  it("gives the same answer whichever string of the chord is pressed", () => {
    /*
     * A chord is one onset, so the two strings of a shape cannot be selected
     * separately. There is no chord object in the Song and none is created:
     * the answer comes from the notes already sharing a slot.
     */
    const target = chainSong();
    const first = pickAt(target, STEP * 7);
    const again = pickAt(target, STEP * 7 + 1);
    expect(again?.selection).toEqual(first?.selection);
    expect(again?.notes.length).toBe(2);
  });

  it("keeps the pressed onset's articulation and written position", () => {
    const picked = pickAt(chainSong(), STEP * 7);
    expect(picked?.notes[0]?.articulation).toBe("hammer_on");
    expect(picked?.notes[0]?.position).toEqual({ string: 0, fret: 3 });
    expect(picked?.notes[1]?.position).toEqual({ string: 1, fret: 5 });
  });
});

describe("82. a tie is part of its onset, not a new one", () => {
  const held = (): Song =>
    song([
      bar(slots([...Array.from({ length: 7 }, () => REST), power(0, ["E2", "B2"])])),
      bar(slots([TIE, TIE, REST])),
    ]);

  it("a press on the strike covers the sound it makes, ties included", () => {
    const picked = pickAt(held(), STEP * 7);
    expect(picked?.selection.startTicks).toBe(STEP * 7);
    // Strike plus two tie slots, carried across the bar line.
    expect(picked?.selection.endTicks).toBe(STEP * 10);
    expect(picked?.fromTie).toBe(false);
  });

  it("a press on the held part picks up the note being held", () => {
    const picked = pickAt(held(), STEP * 9);
    expect(picked?.selection.startTicks).toBe(STEP * 7);
    expect(picked?.selection.endTicks).toBe(STEP * 10);
    expect(picked?.notes.map((note) => note.pitch)).toEqual(["E2", "B2"]);
    expect(picked?.fromTie).toBe(true);
  });
});

describe("83. a press that lands on nothing", () => {
  it("selects the moment it was made and holds no notes", () => {
    const picked = pickAt(chainSong(), STEP * 2);
    expect(picked?.notes).toEqual([]);
    expect(picked?.selection.startTicks).toBe(STEP * 2);
    expect(picked?.selection.endTicks).toBe(STEP * 3);
  });

  it("is null past the end of the section, rather than a guessed slot", () => {
    expect(pickAt(chainSong(), STEP * 100)).toBeNull();
    expect(pickAt(chainSong(), -1)).toBeNull();
  });

  it("holds nothing in a bar the track is not written in", () => {
    const target = song([
      bar(slots([power(0, ["E2", "B2"]), REST])),
      { timeSignature: [4, 4], resolution: 8, slots: {} },
    ]);
    const picked = pickAt(target, STEP * 8);
    expect(picked?.notes).toEqual([]);
    expect(picked?.selection.startTicks).toBe(STEP * 8);
  });
});

describe("84. picking changes nothing", () => {
  it("leaves the section it read exactly as it found it", () => {
    const target = chainSong();
    const before = JSON.stringify(target);
    pickAt(target, STEP * 7);
    pickAt(target, STEP * 8);
    expect(JSON.stringify(target)).toBe(before);
  });

  it("returns the same selection every time it is asked", () => {
    const target = chainSong();
    const runs = Array.from({ length: 3 }, () => pickAt(target, STEP * 7));
    expect(runs[1]?.selection).toEqual(runs[0]?.selection);
    expect(runs[2]?.selection).toEqual(runs[0]?.selection);
  });
});

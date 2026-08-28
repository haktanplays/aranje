/**
 * The editor spine, claim by claim (2U-A §4–§8).
 *
 * The commands themselves were built in 2I and 2J and have their own tests.
 * What this file asks is the set of questions 2U-A asks of them, in the words
 * 2U-A asks them in — because a command can be correct and still not satisfy
 * a claim nobody ever checked. Every `it` here is one sentence from the
 * brief.
 */
import { describe, expect, it } from "vitest";

import { applyTransform, copySelection } from "@/lib/song/transform";
import { guitarTrack, melodicBar, section, song } from "@/lib/song/fixtures";
import type { MelodicSlot, NoteEvent, Song } from "@/lib/song/schema";
import type { TimeSelection } from "@/lib/song/time-selection";

const TRACK = "gtr";
const BAR = 768;

const note = (
  pitch: string,
  string: number,
  fret: number,
  extra: Partial<NoteEvent> = {},
): MelodicSlot => ({ notes: [{ pitch, position: { string, fret }, ...extra }] });

const empty = (count = 16): MelodicSlot[] => Array.from({ length: count }, () => null);

/** A riff: a note, a rest, two more, and a held one. Two bars of room. */
function fixture(): Song {
  const first = empty();
  first[0] = note("G3", 3, 0);
  first[4] = note("A3", 3, 2);
  first[6] = note("B3", 3, 4);

  return song(
    [guitarTrack({ id: TRACK })],
    [
      section([
        melodicBar(TRACK, first, { resolution: 16 }),
        melodicBar(TRACK, empty(), { resolution: 16 }),
      ]),
    ],
  );
}

const range = (startTicks: number, endTicks: number): TimeSelection => ({
  sectionId: "s1",
  trackId: TRACK,
  startTicks,
  endTicks,
});

/** Every struck note of a track, as plain readable rows. */
function notesOf(subject: Song, trackId = TRACK) {
  const rows: {
    barIndex: number;
    slotIndex: number;
    pitch: string;
    string: number;
    fret: number;
    durationTicks: number | undefined;
    articulation: string | undefined;
  }[] = [];
  subject.sections[0]!.bars.forEach((bar, barIndex) => {
    const slots = bar.slots[trackId];
    if (!Array.isArray(slots)) return;
    slots.forEach((slot, slotIndex) => {
      if (slot === null || slot === "-" || Array.isArray(slot)) return;
      for (const entry of slot.notes) {
        rows.push({
          barIndex,
          slotIndex,
          pitch: entry.pitch,
          string: entry.position?.string ?? -1,
          fret: entry.position?.fret ?? -1,
          durationTicks: entry.durationTicks,
          articulation: entry.articulation,
        });
      }
    });
  });
  return rows;
}

/* ------------------------------------------------------------ §4 clipboard */

describe("§4 the clipboard is a snapshot, not a window", () => {
  const subject = fixture();

  it("carries the music and nothing that points back at the song", () => {
    const copied = copySelection(subject, range(0, BAR));
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    const [first] = copied.clipboard.events;
    expect(first?.offsetTicks).toBe(0);
    expect(first?.durationTicks).toBeGreaterThan(0);
    expect(first?.notes[0]).toMatchObject({
      pitch: "G3",
      position: { string: 3, fret: 0 },
    });
    /* The whole selected width, so a trailing rest is part of the pattern. */
    expect(copied.clipboard.widthTicks).toBe(BAR);
  });

  it("reads without writing anything at all", () => {
    const before = JSON.stringify(subject);
    copySelection(subject, range(0, BAR));
    expect(JSON.stringify(subject)).toBe(before);
  });

  /*
   * A spread copies fields, not the objects inside them. Built with
   * `{ ...note }` the clipboard held the *same* `position` object as the
   * song, so a later edit in place would have rewritten what was on the
   * clipboard. Nothing mutates a note in place today; §4 asks for the hazard
   * to be gone rather than for everyone to keep remembering it.
   */
  it("does not change when the note it was taken from changes", () => {
    const source = fixture();
    const copied = copySelection(source, range(0, 48));
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;

    const before = JSON.stringify(copied.clipboard);
    const slot = source.sections[0]!.bars[0]!.slots[TRACK]![0] as {
      notes: { position: { fret: number } }[];
    };
    slot.notes[0]!.position.fret = 12;

    expect(JSON.stringify(copied.clipboard)).toBe(before);
  });

  it("gives two pastes of one clipboard notes that do not share a position", () => {
    const copied = copySelection(fixture(), range(0, 48));
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;

    const once = applyTransform(fixture(), range(BAR, BAR + 48), {
      kind: "paste_selection",
      clipboard: copied.clipboard,
      atTicks: BAR,
    });
    expect(once.ok).toBe(true);
    if (!once.ok) return;

    const twice = applyTransform(once.song, range(BAR + 96, BAR + 144), {
      kind: "paste_selection",
      clipboard: copied.clipboard,
      atTicks: BAR + 96,
    });
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;

    const written = notesOf(twice.song).filter((row) => row.barIndex === 1);
    expect(written).toHaveLength(2);

    /* Two notes, two positions: changing one must not reach the other. */
    const bar = twice.song.sections[0]!.bars[1]!.slots[TRACK]!;
    const a = bar[0] as { notes: { position: { fret: number } }[] };
    const b = bar[2] as { notes: { position: { fret: number } }[] };
    expect(a.notes[0]!.position).not.toBe(b.notes[0]!.position);
  });

  it("refuses to paste onto something already sounding, and writes nothing", () => {
    const copied = copySelection(fixture(), range(0, 48));
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;

    const target = fixture();
    const before = JSON.stringify(target);
    const result = applyTransform(target, range(0, 48), {
      kind: "paste_selection",
      clipboard: copied.clipboard,
      atTicks: 0,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("target_occupied");
    expect(JSON.stringify(target)).toBe(before);
  });

  /* All or nothing: one bad event refuses the whole paste. */
  it("writes none of a clipboard when one of its notes would not fit", () => {
    const copied = copySelection(fixture(), range(0, BAR));
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;

    const target = fixture();
    const before = JSON.stringify(target);
    /* Landing here would run the last note past the end of the section. */
    const result = applyTransform(target, range(BAR + 672, BAR + 720), {
      kind: "paste_selection",
      clipboard: copied.clipboard,
      atTicks: BAR + 672,
    });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(target)).toBe(before);
  });
});

/* ------------------------------------------- §5 duplicate and repeat */

describe("§5 duplicating and repeating a selection", () => {
  it("puts a copy immediately after, keeping the rests inside the figure", () => {
    const subject = fixture();
    const result = applyTransform(subject, range(0, 384), {
      kind: "duplicate_selection",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = notesOf(result.song);
    /* Three notes became six, and the second three sit exactly a half-bar on. */
    expect(rows).toHaveLength(6);
    expect(rows.map((row) => row.slotIndex)).toEqual([0, 4, 6, 8, 12, 14]);
    expect(rows.map((row) => row.pitch)).toEqual([
      "G3",
      "A3",
      "B3",
      "G3",
      "A3",
      "B3",
    ]);
  });

  it("repeats by whole selections, inventing neither gap nor overlap", () => {
    /* One note on beat one and nothing after it, so the copies have room. */
    const first = empty();
    first[0] = note("G3", 3, 0);
    const subject = song(
      [guitarTrack({ id: TRACK })],
      [
        section([
          melodicBar(TRACK, first, { resolution: 16 }),
          melodicBar(TRACK, empty(), { resolution: 16 }),
        ]),
      ],
    );

    const result = applyTransform(subject, range(0, 192), {
      kind: "repeat_selection",
      mode: { kind: "count", count: 3 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = notesOf(result.song);
    /* One note per quarter, four quarters: the original and three copies. */
    expect(rows.map((row) => row.slotIndex)).toEqual([0, 4, 8, 12]);
    expect(rows.every((row) => row.barIndex === 0)).toBe(true);
  });

  it("crosses the bar line rather than stopping at it", () => {
    const subject = fixture();
    const result = applyTransform(subject, range(0, BAR), {
      kind: "repeat_selection",
      mode: { kind: "count", count: 1 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(notesOf(result.song).some((row) => row.barIndex === 1)).toBe(true);
  });

  it("refuses whole when the repeats would run past the section", () => {
    const first = empty();
    first[0] = note("G3", 3, 0);
    const subject = song(
      [guitarTrack({ id: TRACK })],
      [
        section([
          melodicBar(TRACK, first, { resolution: 16 }),
          melodicBar(TRACK, empty(), { resolution: 16 }),
        ]),
      ],
    );
    const before = JSON.stringify(subject);
    const result = applyTransform(subject, range(0, BAR), {
      kind: "repeat_selection",
      mode: { kind: "count", count: 9 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("section_overflow");
    expect(JSON.stringify(subject)).toBe(before);
  });
});

/* ------------------------------------------------------ §6 moving in time */

describe("§6 moving a selection in time", () => {
  it("moves by one grid step and leaves the notes their own lengths", () => {
    const subject = fixture();
    const result = applyTransform(subject, range(0, 192), {
      kind: "move_selection_time",
      deltaTicks: 48,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = notesOf(result.song);
    /* Only the note inside the range moved; the other two never were in it. */
    expect(rows.map((row) => row.slotIndex)).toEqual([1, 4, 6]);
  });

  /*
   * The claim §6 makes in its own words: a 1/32 motif moved on a 1/16 grid
   * keeps its inner rhythm. The grid says how far the whole thing travels; it
   * does not get a vote on what is inside.
   */
  it("does not quantise the inside of a motif to the grid it moves on", () => {
    const dense = empty(32);
    /* Two thirty-seconds, 24 ticks apart, in a bar written on a 1/32 grid. */
    dense[0] = note("G3", 3, 0, { durationTicks: 24 });
    dense[1] = note("A3", 3, 2, { durationTicks: 24 });
    const subject = song(
      [guitarTrack({ id: TRACK })],
      [
        section([
          melodicBar(TRACK, dense, { resolution: 32 }),
          melodicBar(TRACK, empty(), { resolution: 16 }),
        ]),
      ],
    );

    const before = notesOf(subject).map((row) => row.durationTicks);
    const result = applyTransform(subject, range(0, 96), {
      kind: "move_selection_time",
      deltaTicks: 24,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = notesOf(result.song);
    expect(after.map((row) => row.durationTicks)).toEqual(before);
    /* And the gap between them is still one thirty-second, not one sixteenth. */
    expect(after[1]!.slotIndex - after[0]!.slotIndex).toBe(1);
  });

  it("moves out and back to exactly the bytes it started from", () => {
    const subject = fixture();
    /*
     * The whole riff, so the range that comes back holds the same music that
     * went out. A narrower range would return a *wider* selection — moving
     * one note right can bring the next one inside the range — and moving
     * that back would be moving something else.
     */
    const out = applyTransform(subject, range(0, BAR), {
      kind: "move_selection_time",
      deltaTicks: 48,
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    const back = applyTransform(out.song, out.selection, {
      kind: "move_selection_time",
      deltaTicks: -48,
    });
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(JSON.stringify(back.song)).toBe(JSON.stringify(subject));
  });

  it("never mutates the song it was given", () => {
    const subject = fixture();
    const before = JSON.stringify(subject);
    applyTransform(subject, range(0, 192), {
      kind: "move_selection_time",
      deltaTicks: 48,
    });
    expect(JSON.stringify(subject)).toBe(before);
  });
});

/* --------------------------------------------------------- §7 transposing */

describe("§7 moving the pitch", () => {
  it("moves the sounding pitch and recomputes the fret", () => {
    const subject = fixture();
    const result = applyTransform(subject, range(0, BAR), {
      kind: "transpose_pitch",
      semitones: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = notesOf(result.song);
    expect(rows.map((row) => row.pitch)).toEqual(["A3", "B3", "C#4"]);
    /* The fret moved with it — no stale number left behind. */
    expect(rows.map((row) => row.fret)).toEqual([2, 4, 6]);
  });

  it("leaves the rhythm exactly where it was", () => {
    const subject = fixture();
    const before = notesOf(subject).map((row) => [row.barIndex, row.slotIndex]);
    const result = applyTransform(subject, range(0, BAR), {
      kind: "transpose_pitch",
      semitones: 12,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(notesOf(result.song).map((row) => [row.barIndex, row.slotIndex])).toEqual(
      before,
    );
  });

  it("keeps the ornament shape when a legato figure moves as a whole", () => {
    const figure = empty();
    figure[0] = note("G3", 3, 0);
    figure[1] = note("A3", 3, 2, { articulation: "hammer_on" });
    figure[2] = note("G3", 3, 0, { articulation: "pull_off" });
    const subject = song(
      [guitarTrack({ id: TRACK })],
      [
        section([
          melodicBar(TRACK, figure, { resolution: 16 }),
          melodicBar(TRACK, empty(), { resolution: 16 }),
        ]),
      ],
    );

    const result = applyTransform(subject, range(0, 144), {
      kind: "transpose_pitch",
      semitones: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const rows = notesOf(result.song);
    expect(rows.map((row) => row.articulation)).toEqual([
      undefined,
      "hammer_on",
      "pull_off",
    ]);
    /* x, x+2, x is still x, x+2, x — the shape survived the move. */
    const frets = rows.map((row) => row.fret);
    expect(frets[1]! - frets[0]!).toBe(2);
    expect(frets[2]).toBe(frets[0]);
  });

  it("refuses the whole selection when one note cannot be reached", () => {
    const subject = fixture();
    const before = JSON.stringify(subject);
    const result = applyTransform(subject, range(0, BAR), {
      kind: "transpose_pitch",
      semitones: -48,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(["out_of_range", "position_not_derivable"]).toContain(result.error.code);
    expect(JSON.stringify(subject)).toBe(before);
  });
});

/* ------------------------------------------------------ §8 changing string */

describe("§8 the same note on another string", () => {
  it("keeps the sounding pitch and changes where it is played", () => {
    const subject = fixture();
    const before = notesOf(subject);
    const result = applyTransform(subject, range(0, BAR), {
      kind: "restring_same_pitch",
      stringDelta: -1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const after = notesOf(result.song);
    expect(after.map((row) => row.pitch)).toEqual(before.map((row) => row.pitch));
    expect(after.map((row) => row.string)).toEqual(
      before.map((row) => row.string - 1),
    );
    /* A thicker string needs a higher fret for the same note. */
    for (const [index, row] of after.entries()) {
      expect(row.fret).toBeGreaterThan(before[index]!.fret);
    }
  });

  it("keeps every note's own string movement rather than stacking them up", () => {
    const spread = empty();
    /* Both high enough that the next string up can still reach them. */
    spread[0] = { notes: [
      { pitch: "E4", position: { string: 3, fret: 9 } },
      { pitch: "A4", position: { string: 4, fret: 10 } },
    ] };
    const subject = song(
      [guitarTrack({ id: TRACK })],
      [
        section([
          melodicBar(TRACK, spread, { resolution: 16 }),
          melodicBar(TRACK, empty(), { resolution: 16 }),
        ]),
      ],
    );

    const result = applyTransform(subject, range(0, 48), {
      kind: "restring_same_pitch",
      stringDelta: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const strings = notesOf(result.song).map((row) => row.string);
    /* Two notes, two strings — never both piled onto one. */
    expect(strings).toEqual([4, 5]);
    expect(new Set(strings).size).toBe(2);
  });

  it("refuses whole when the target string cannot hold the note", () => {
    const subject = fixture();
    const before = JSON.stringify(subject);
    const result = applyTransform(subject, range(0, BAR), {
      kind: "restring_same_pitch",
      stringDelta: 2,
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(subject)).toBe(before);
  });

  it("refuses to move off the end of the fretboard", () => {
    const subject = fixture();
    const result = applyTransform(subject, range(0, BAR), {
      kind: "restring_same_pitch",
      stringDelta: -9,
    });
    expect(result.ok).toBe(false);
  });
});

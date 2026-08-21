/**
 * The selection/transform core (spec 5.4, 9.1, 10, K-37).
 *
 * The promises being pinned here are the ones a musician notices when they
 * break: nothing is overwritten, nothing is rounded to the nearest slot,
 * nothing is half-applied, and a held note is never cut in two.
 */
import { describe, expect, it } from "vitest";

import {
  applyTransform,
  commitTransform,
  copySelection,
  type TimeSelection,
  type TransformCommand,
} from "@/lib/song/transform";
import { createSongStore } from "@/lib/song/song-store";
import type { StorageLike } from "@/lib/song/storage";
import { ticksPerSlot } from "@/lib/music/timing";
import { songSchema, type MelodicSlot, type Song } from "@/lib/song/schema";
import { bar, note, readBar, slots, song, TIE, TRACK_ID, REST } from "@/test/move-fixtures";

/** Resolution 8: eight slots to the bar, 96 ticks each. */
const STEP = ticksPerSlot(8);
const BAR = STEP * 8;

const A3 = () => note("A3", 1, 12);
const C4 = () => note("C4", 1, 15);
const E4 = () => note("E4", 2, 14);

/** A power chord shape: root, fifth, octave struck together. */
const POWER = (): MelodicSlot => ({
  notes: [
    { pitch: "E2", position: { string: 0, fret: 0 }, velocity: 110 },
    { pitch: "B2", position: { string: 1, fret: 2 }, velocity: 104 },
    { pitch: "E3", position: { string: 2, fret: 2 }, velocity: 98, articulation: "accent" },
  ],
});

const select = (startTicks: number, endTicks: number): TimeSelection => ({
  sectionId: "s1",
  trackId: TRACK_ID,
  startTicks,
  endTicks,
});

const run = (target: Song, selection: TimeSelection, command: TransformCommand) =>
  applyTransform(target, selection, command);

function countingStorage(): StorageLike & { writes: number } {
  const map = new Map<string, string>();
  const storage = {
    writes: 0,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.writes += 1;
      map.set(key, value);
    },
    removeItem: (key: string) => void map.delete(key),
  };
  return storage;
}

describe("copy, paste and delete", () => {
  it("copies one note and pastes it into a rest", () => {
    const before = song([bar(slots([A3(), REST, REST, REST]))]);
    const copied = copySelection(before, select(0, STEP));
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;

    const pasted = run(before, select(0, STEP), {
      kind: "paste_selection",
      clipboard: copied.clipboard,
      atTicks: STEP * 2,
    });
    expect(pasted.ok).toBe(true);
    if (!pasted.ok) return;
    expect(readBar(pasted.song, 0)[2]).toBe("A3");
    expect(readBar(pasted.song, 0)[0]).toBe("A3");
  });

  it("deletes a range and leaves rests", () => {
    const before = song([bar(slots([A3(), C4(), E4(), REST]))]);
    const result = run(before, select(0, STEP * 2), { kind: "delete_selection" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 0).slice(0, 3)).toEqual([".", ".", "E4"]);
  });

  it("cuts by clearing the range", () => {
    const before = song([bar(slots([A3(), REST, C4()]))]);
    const result = run(before, select(0, STEP), { kind: "cut_selection" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 0)[0]).toBe(".");
  });

  it("refuses to paste onto sounding music", () => {
    const before = song([bar(slots([A3(), C4()]))]);
    const copied = copySelection(before, select(0, STEP));
    if (!copied.ok) return;
    const result = run(before, select(0, STEP), {
      kind: "paste_selection",
      clipboard: copied.clipboard,
      atTicks: STEP,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("target_occupied");
  });
});

describe("chords and power chords move as one", () => {
  it("carries every note of a chord together", () => {
    const chord: MelodicSlot = {
      notes: [
        { pitch: "A3", position: { string: 1, fret: 12 } },
        { pitch: "E4", position: { string: 2, fret: 14 } },
      ],
    };
    const before = song([bar(slots([chord, REST, REST]))]);
    const result = run(before, select(0, STEP), {
      kind: "move_selection_time",
      deltaTicks: STEP * 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const moved = result.song.sections[0]?.bars[0]?.slots[TRACK_ID]?.[2];
    expect(moved && moved !== "-" && !Array.isArray(moved) ? moved.notes : []).toHaveLength(2);
  });

  it("keeps a power chord's intervals, velocities and articulation when translated", () => {
    const before = song([bar(slots([POWER(), REST]))]);
    const result = run(before, select(0, STEP), {
      kind: "translate_fret_shape",
      stringDelta: 0,
      fretDelta: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const slot = result.song.sections[0]?.bars[0]?.slots[TRACK_ID]?.[0];
    const notes = slot && slot !== "-" && !Array.isArray(slot) ? slot.notes : [];
    expect(notes.map((entry) => entry.pitch)).toEqual(["F#2", "C#3", "F#3"]);
    expect(notes.map((entry) => entry.position?.fret)).toEqual([2, 4, 4]);
    expect(notes.map((entry) => entry.velocity)).toEqual([110, 104, 98]);
    expect(notes[2]?.articulation).toBe("accent");
  });

  it("refuses a shape translation that leaves the fretboard", () => {
    const before = song([bar(slots([POWER(), REST]))]);
    const result = run(before, select(0, STEP), {
      kind: "translate_fret_shape",
      stringDelta: -1,
      fretDelta: 0,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("out_of_range");
  });
});

describe("the three vertical moves stay separate", () => {
  it("transpose keeps chord intervals", () => {
    const before = song([bar(slots([POWER(), REST]))]);
    const result = run(before, select(0, STEP), { kind: "transpose_pitch", semitones: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slot = result.song.sections[0]?.bars[0]?.slots[TRACK_ID]?.[0];
    const notes = slot && slot !== "-" && !Array.isArray(slot) ? slot.notes : [];
    expect(notes.map((entry) => entry.pitch)).toEqual(["G2", "D3", "G3"]);
    // The shape was E2/B2/E3: a fifth then a fourth. Both survive.
    expect(notes.map((entry) => entry.position?.string)).toEqual([0, 1, 2]);
  });

  it("transpose refuses rather than move a note to another string", () => {
    const low: MelodicSlot = { notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }] };
    const before = song([bar(slots([low, REST]))]);
    const result = run(before, select(0, STEP), { kind: "transpose_pitch", semitones: -1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("position_not_derivable");
  });

  it("transpose leaves an implicit position implicit", () => {
    const implicit: MelodicSlot = { notes: [{ pitch: "A3" }] };
    const before = song([bar(slots([implicit, REST]))]);
    const result = run(before, select(0, STEP), { kind: "transpose_pitch", semitones: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slot = result.song.sections[0]?.bars[0]?.slots[TRACK_ID]?.[0];
    const notes = slot && slot !== "-" && !Array.isArray(slot) ? slot.notes : [];
    expect(notes[0]?.pitch).toBe("B3");
    expect(notes[0]?.position).toBeUndefined();
  });

  it("restring keeps the pitch exactly and changes only the hand", () => {
    const before = song([bar(slots([A3(), REST]))]);
    const result = run(before, select(0, STEP), {
      kind: "restring_same_pitch",
      stringDelta: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slot = result.song.sections[0]?.bars[0]?.slots[TRACK_ID]?.[0];
    const notes = slot && slot !== "-" && !Array.isArray(slot) ? slot.notes : [];
    expect(notes[0]?.pitch).toBe("A3");
    expect(notes[0]?.position?.string).toBe(2);
    expect(notes[0]?.position?.fret).toBe(7);
  });

  it("restring refuses when the pitch cannot be made on the target string", () => {
    const high: MelodicSlot = { notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }] };
    const before = song([bar(slots([high, REST]))]);
    const result = run(before, select(0, STEP), {
      kind: "restring_same_pitch",
      stringDelta: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("out_of_range");
  });

  it("refuses the whole chord when one of its notes cannot move", () => {
    // The power chord's root is already on the thickest string, so shifting
    // the shape down has nowhere to put it. The two notes that *could* move
    // must not move either.
    const before = song([bar(slots([POWER(), REST]))]);
    const result = run(before, select(0, STEP), {
      kind: "restring_same_pitch",
      stringDelta: -1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("out_of_range");
  });
});

describe("tuning, capo and alternate tunings", () => {
  /** The same fixture with the guitar re-tuned, and optionally capoed. */
  function retuned(tuning: readonly string[], capo = 0): Song {
    const base = song([bar(slots([A3(), REST]))]);
    return songSchema.parse({
      ...base,
      tracks: base.tracks.map((track) => ({ ...track, fretboard: { tuning: [...tuning], capo } })),
    });
  }

  const STANDARD = ["E2", "A2", "D3", "G3", "B3", "E4"];
  const DROP_D = ["D2", "A2", "D3", "G3", "B3", "E4"];

  it("derives the fret from the tuning it is given", () => {
    for (const tuning of [STANDARD, DROP_D]) {
      const result = run(retuned(tuning), select(0, STEP), {
        kind: "restring_same_pitch",
        stringDelta: 1,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const slot = result.song.sections[0]?.bars[0]?.slots[TRACK_ID]?.[0];
      const notes = slot && slot !== "-" && !Array.isArray(slot) ? slot.notes : [];
      expect(notes[0]?.pitch).toBe("A3");
    }
  });

  it("reads a translated shape through the capo", () => {
    const result = run(retuned(STANDARD, 2), select(0, STEP), {
      kind: "translate_fret_shape",
      stringDelta: 0,
      fretDelta: 1,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slot = result.song.sections[0]?.bars[0]?.slots[TRACK_ID]?.[0];
    const notes = slot && slot !== "-" && !Array.isArray(slot) ? slot.notes : [];
    // String 1 sounds A2 open. With capo 2, fret 13 sounds 45 + 2 + 13 = C4.
    expect(notes[0]?.position?.fret).toBe(13);
    expect(notes[0]?.pitch).toBe("C4");
  });

  it("keeps Drop D's low string reachable", () => {
    const low: MelodicSlot = { notes: [{ pitch: "D2", position: { string: 0, fret: 0 } }] };
    const base = song([bar(slots([low, REST]))]);
    const dropped = songSchema.parse({
      ...base,
      tracks: base.tracks.map((track) => ({
        ...track,
        fretboard: { tuning: [...DROP_D], capo: 0 },
      })),
    });
    const result = run(dropped, select(0, STEP), {
      kind: "translate_fret_shape",
      stringDelta: 0,
      fretDelta: 2,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const slot = result.song.sections[0]?.bars[0]?.slots[TRACK_ID]?.[0];
    const notes = slot && slot !== "-" && !Array.isArray(slot) ? slot.notes : [];
    expect(notes[0]?.pitch).toBe("E2");
  });
});

describe("horizontal movement in ticks", () => {
  it("crosses a bar line", () => {
    const before = song([bar(slots([REST, REST, REST, REST, REST, REST, REST, A3()])), bar(slots([]))]);
    const result = run(before, select(STEP * 7, STEP * 8), {
      kind: "move_selection_time",
      deltaTicks: STEP,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 0)[7]).toBe(".");
    expect(readBar(result.song, 1)[0]).toBe("A3");
  });

  it("moves into a finer grid when the moment exists there", () => {
    const before = song([bar(slots([A3(), REST])), bar(slots([], 16), 16)]);
    const result = run(before, select(0, STEP), {
      kind: "move_selection_time",
      deltaTicks: BAR,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 1)[0]).toBe("A3");
  });

  it("refuses a move whose moment does not exist on the target grid", () => {
    // Bar two is a 1/8 triplet grid: 64 ticks a slot. A note sitting 48 ticks
    // into a 1/16 bar has no equivalent there, and is not rounded to one.
    const before = song([bar(slots([REST, A3()], 16), 16), bar(slots([], 12), 12)]);
    const result = run(before, select(48, 96), {
      kind: "move_selection_time",
      deltaTicks: BAR,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("target_grid_incompatible");
  });

  it("refuses when the note's length cannot be expressed on the target grid", () => {
    // A note held across three slots of a 1/8 bar sounds for 288 ticks. The
    // second bar is a 1/8 triplet grid at 64 ticks a slot, where 288 is four
    // and a half slots. The onset would land, the length would not.
    const before = song([
      bar(slots([A3(), TIE, TIE, REST, REST, REST, REST, REST])),
      bar(slots([], 12), 12),
    ]);
    const result = run(before, select(0, STEP * 3), {
      kind: "move_selection_time",
      deltaTicks: BAR,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("target_grid_incompatible");
  });
});

describe("repeat", () => {
  it("repeats a pattern a given number of times", () => {
    const before = song([bar(slots([A3(), REST, REST, REST, REST, REST, REST, REST]))]);
    const result = run(before, select(0, STEP * 2), {
      kind: "repeat_selection",
      mode: { kind: "count", count: 3 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 0)).toEqual(["A3", ".", "A3", ".", "A3", ".", "A3", "."]);
  });

  it("keeps the rests inside the pattern", () => {
    const before = song([bar(slots([A3(), REST, REST, REST, REST, REST, REST, REST]))]);
    const result = run(before, select(0, STEP * 4), {
      kind: "repeat_selection",
      mode: { kind: "count", count: 1 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The three rests are part of the pattern, so the copy lands on beat five.
    expect(readBar(result.song, 0)).toEqual(["A3", ".", ".", ".", "A3", ".", ".", "."]);
  });

  it("fills to the end of the section", () => {
    const before = song([bar(slots([A3(), REST, REST, REST, REST, REST, REST, REST]))]);
    const result = run(before, select(0, STEP * 2), {
      kind: "repeat_selection",
      mode: { kind: "fill_to_section_end" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 0).filter((token) => token === "A3")).toHaveLength(4);
  });

  it("refuses to run past the end of the section", () => {
    const before = song([bar(slots([A3(), REST, REST, REST, REST, REST, REST, REST]))]);
    const result = run(before, select(0, STEP * 6), {
      kind: "repeat_selection",
      mode: { kind: "count", count: 2 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("section_overflow");
  });

  it("refuses at the first collision rather than overwriting", () => {
    const before = song([bar(slots([A3(), REST, C4(), REST, REST, REST, REST, REST]))]);
    const result = run(before, select(0, STEP * 2), {
      kind: "repeat_selection",
      mode: { kind: "count", count: 1 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("target_occupied");
  });
});

describe("ties and chains", () => {
  it("carries a held note whole, with its ties", () => {
    const before = song([bar(slots([A3(), TIE, TIE, REST, REST, REST, REST, REST]))]);
    const result = run(before, select(0, STEP * 3), {
      kind: "move_selection_time",
      deltaTicks: STEP * 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(readBar(result.song, 0)).toEqual([".", ".", ".", "A3", "-", "-", ".", "."]);
  });

  it("grows a range that starts in the middle of a held note", () => {
    const before = song([bar(slots([A3(), TIE, TIE, REST]))]);
    // Asking for the second tie alone: the policy expands to the whole note.
    const copied = copySelection(before, select(STEP, STEP * 2));
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    expect(copied.selection.startTicks).toBe(0);
    expect(copied.selection.endTicks).toBe(STEP * 3);
    expect(copied.clipboard.events).toHaveLength(1);
    expect(copied.clipboard.events[0]?.durationTicks).toBe(STEP * 3);
  });

  it("grows a range that would cut a legato chain", () => {
    const struck: MelodicSlot = { notes: [{ pitch: "A3", position: { string: 1, fret: 12 } }] };
    const hammered: MelodicSlot = {
      notes: [{ pitch: "B3", position: { string: 1, fret: 14 }, articulation: "hammer_on" }],
    };
    const before = song([bar(slots([struck, hammered, REST, REST]))]);
    // Selecting only the hammer-on pulls in the note it needs to sound.
    const copied = copySelection(before, select(STEP, STEP * 2));
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    expect(copied.selection.startTicks).toBe(0);
    expect(copied.clipboard.events).toHaveLength(2);
  });

  it("refuses to write into the middle of a held note", () => {
    // A tie slot is occupancy, not empty space. That is what makes splitting a
    // chain from the destination side unrepresentable rather than merely
    // forbidden: you cannot reach the inside of a chain without colliding.
    const before = song([bar(slots([A3(), REST, C4(), TIE, TIE, REST, REST, REST]))]);
    const copied = copySelection(before, select(0, STEP));
    if (!copied.ok) return;
    const result = run(before, select(0, STEP), {
      kind: "paste_selection",
      clipboard: copied.clipboard,
      atTicks: STEP * 3,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("target_occupied");
  });

  it("treats a bar the track is not written in as silence that breaks the range", () => {
    const before = song([bar(slots([A3(), REST])), bar(slots([]))]);
    const stripped = songSchema.parse({
      ...before,
      sections: before.sections.map((section) => ({
        ...section,
        bars: section.bars.map((entry, index) =>
          index === 1 ? { ...entry, slots: {} } : entry,
        ),
      })),
    });
    const result = run(stripped, select(0, BAR * 2), { kind: "delete_selection" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("track_silent_here");
  });
});

describe("atomicity, purity and determinism", () => {
  it("does not mutate the song it is given", () => {
    const before = song([bar(slots([A3(), REST, REST]))]);
    const snapshot = JSON.stringify(before);
    run(before, select(0, STEP), { kind: "move_selection_time", deltaTicks: STEP });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("gives byte-identical output five times over", () => {
    const before = song([bar(slots([POWER(), REST, REST, REST]))]);
    const runs = Array.from({ length: 5 }, () => {
      const result = run(before, select(0, STEP), { kind: "transpose_pitch", semitones: 2 });
      return result.ok ? JSON.stringify(result.song) : "failed";
    });
    expect(new Set(runs).size).toBe(1);
    expect(runs[0]).not.toBe("failed");
  });

  it("returns warnings without blocking", () => {
    const wide: MelodicSlot = { notes: [{ pitch: "A3", position: { string: 1, fret: 12 } }] };
    const far: MelodicSlot = { notes: [{ pitch: "F2", position: { string: 0, fret: 1 } }] };
    const before = song([bar(slots([wide, far, REST, REST]))]);
    const result = run(before, select(0, STEP * 2), { kind: "transpose_pitch", semitones: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("writes once and leaves one undo step on success", () => {
    const storage = countingStorage();
    const store = createSongStore(
      { song: song([bar(slots([A3(), REST, REST]))]), outcome: "stored" },
      storage,
    );
    const before = storage.writes;

    const result = commitTransform(store, select(0, STEP), {
      kind: "move_selection_time",
      deltaTicks: STEP,
    });
    expect(result.ok).toBe(true);
    expect(storage.writes - before).toBe(1);
    expect(store.getSnapshot().canUndo).toBe(true);

    store.undo();
    expect(readBar(store.getSnapshot().song, 0)[0]).toBe("A3");
  });

  it("writes nothing and records no undo step on failure", () => {
    const storage = countingStorage();
    const store = createSongStore(
      { song: song([bar(slots([A3(), C4()]))]), outcome: "stored" },
      storage,
    );
    const before = storage.writes;

    const result = commitTransform(store, select(0, STEP), {
      kind: "move_selection_time",
      deltaTicks: STEP,
    });
    expect(result.ok).toBe(false);
    expect(storage.writes - before).toBe(0);
    expect(store.getSnapshot().canUndo).toBe(false);
  });

  it("refuses an empty selection", () => {
    const before = song([bar(slots([A3(), REST]))]);
    const result = run(before, select(STEP, STEP), { kind: "delete_selection" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("selection_empty");
  });

  it("keeps error codes free of raw validator text", () => {
    const before = song([bar(slots([A3(), C4()]))]);
    const result = run(before, select(0, STEP), {
      kind: "move_selection_time",
      deltaTicks: STEP,
    });
    if (result.ok) return;
    expect(result.error.message).not.toContain("ZodError");
    expect(result.error.message).not.toContain("invalid_");
  });
});

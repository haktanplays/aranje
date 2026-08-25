/**
 * One gesture, one step (2S-A §12).
 *
 * The three commands the composer added each write several notes: a power
 * chord is two or three, a brush over five notes is four links, a
 * continuation can be four copies of a bar. A history that recorded them note
 * by note would make undo a thing the reader has to press repeatedly and
 * count — which is not undo, it is a rewind. So each of them is exactly one
 * step, and each step says in Turkish what pressing undo would take back.
 */
import { describe, expect, it } from "vitest";

import {
  canRedo,
  canUndo,
  createEditHistory,
  currentSong,
  recordEdit,
  redo,
  sameSong,
  undo,
  undoAction,
  type HistoryAction,
} from "@/lib/song/edit-history";
import { historyActionLabel, undoLabel } from "@/lib/song/history-labels";
import { guitarTrack, restSlots, section, song as makeSong } from "@/lib/song/fixtures";
import type { Bar, Song } from "@/lib/song/schema";

const bar = (): Bar => ({
  timeSignature: [4, 4],
  resolution: 8,
  slots: { gtr: restSlots(8) },
});

const named = (title: string): Song => ({
  ...makeSong([guitarTrack({ id: "gtr" })], [section([bar()])]),
  title,
});

const ACTIONS: ReadonlyArray<readonly [string, HistoryAction, string]> = [
  ["the pen on an empty beat", { kind: "power_chord", mode: "insert" }, "Power chord ekleme"],
  [
    "the pen over somebody else's beat",
    { kind: "power_chord", mode: "replace" },
    "Vuruşu power chord ile değiştirme",
  ],
  ["the brush over five notes", { kind: "legato_brush" }, "Notaları bağlama"],
  ["four copies of a pattern", { kind: "continue_pattern" }, "Deseni devam ettirme"],
];

describe("11. every composer gesture is a single step", () => {
  it.each(ACTIONS)("records %s once", (_what, action) => {
    const before = createEditHistory(named("A"));
    const after = recordEdit(before, named("B"), action);

    expect(canUndo(after)).toBe(true);
    expect(canRedo(after)).toBe(false);

    // One press, and the whole gesture is gone — not the last note of it.
    const undone = undo(after);
    expect(sameSong(currentSong(undone), named("A"))).toBe(true);
    expect(canUndo(undone)).toBe(false);

    // And one press back, and the whole gesture is there again.
    expect(sameSong(currentSong(redo(undone)), named("B"))).toBe(true);
  });

  it.each(ACTIONS)("names %s in music rather than in an identifier", (_what, action, label) => {
    expect(historyActionLabel(action)).toBe(label);
    expect(undoLabel(action)).toBe(`Geri al: ${label}`);

    const said = historyActionLabel(action);
    for (const leak of ["power_chord", "legato_brush", "continue_pattern", "hammer_on", "pull_off"]) {
      expect(said.includes(leak), `${label} leaks ${leak}`).toBe(false);
    }
  });

  it("keeps the four apart, so undo never says the wrong thing", () => {
    const labels = ACTIONS.map(([, action]) => historyActionLabel(action));
    expect(new Set(labels).size).toBe(ACTIONS.length);
  });

  it("carries the action along with the step, not beside it", () => {
    // What undo would take back is read off the history itself. A label held
    // anywhere else would go stale the moment two commands raced.
    const history = recordEdit(
      createEditHistory(named("A")),
      named("B"),
      { kind: "legato_brush" },
    );
    expect(undoAction(history)).toEqual({ kind: "legato_brush" });
  });
});

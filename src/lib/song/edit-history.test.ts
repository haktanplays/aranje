/**
 * What a session's edit history has to get right (spec 13.13, K-44).
 *
 * Undo is the control a musician reaches for when they have just lost
 * something, which makes it the one place in the app where "nearly right" is
 * worse than absent: a history that returns the wrong song has taken the
 * reader's music and given them somebody else's, and they will not find out
 * until much later.
 */
import { describe, expect, it } from "vitest";

import { historyLimits } from "@/lib/limits";
import {
  canRedo,
  canUndo,
  createEditHistory,
  currentSong,
  recordEdit,
  redo,
  redoAction,
  resetEditHistory,
  sameSong,
  undo,
  undoAction,
  type EditHistory,
  type HistoryAction,
} from "@/lib/song/edit-history";
import { guitarTrack, restSlots, section, song as makeSong } from "@/lib/song/fixtures";
import type { Bar, Song } from "@/lib/song/schema";

const bar = (): Bar => ({
  timeSignature: [4, 4],
  resolution: 8,
  slots: { gtr: restSlots(8) },
});

/** Songs that differ by one visible thing, so a mix-up cannot hide. */
const named = (title: string): Song => ({
  ...makeSong([guitarTrack({ id: "gtr" })], [section([bar()])]),
  title,
});

const NOTE: HistoryAction = { kind: "note_edit" };
const DELETE_BARS: HistoryAction = {
  kind: "bar_transform",
  command: "delete_bars",
  scope: "full",
};

/** Build a history of `titles`, each recorded as a note edit. */
function historyOf(...titles: readonly string[]): EditHistory {
  let history = createEditHistory(named("A"));
  for (const title of titles) history = recordEdit(history, named(title), NOTE);
  return history;
}

describe("1. a fresh history has nowhere to go", () => {
  it("cannot undo or redo, and holds the song it was given", () => {
    const history = createEditHistory(named("A"));
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(currentSong(history).title).toBe("A");
    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
  });
});

describe("2. three commits undo in order", () => {
  it("walks back one edit at a time", () => {
    let history = historyOf("B", "C", "D");
    expect(currentSong(history).title).toBe("D");

    history = undo(history);
    expect(currentSong(history).title).toBe("C");
    history = undo(history);
    expect(currentSong(history).title).toBe("B");
    history = undo(history);
    expect(currentSong(history).title).toBe("A");
    expect(canUndo(history)).toBe(false);
  });
});

describe("3. the same three redo in order", () => {
  it("walks forward again to exactly where it was", () => {
    let history = historyOf("B", "C", "D");
    history = undo(undo(undo(history)));

    history = redo(history);
    expect(currentSong(history).title).toBe("B");
    history = redo(history);
    expect(currentSong(history).title).toBe("C");
    history = redo(history);
    expect(currentSong(history).title).toBe("D");
    expect(canRedo(history)).toBe(false);
  });
});

describe("4. a new commit after an undo drops the future", () => {
  it("A→B→C→D, two undos, then E gives A→B→E", () => {
    let history = historyOf("B", "C", "D");
    history = undo(undo(history));
    expect(currentSong(history).title).toBe("B");

    history = recordEdit(history, named("E"), NOTE);
    expect(currentSong(history).title).toBe("E");
    expect(canRedo(history)).toBe(false);
    expect(history.snapshots.map((entry) => entry.song.title)).toEqual([
      "A",
      "B",
      "E",
    ]);

    // And the abandoned branch cannot come back by walking around.
    history = undo(history);
    history = redo(history);
    expect(currentSong(history).title).toBe("E");
  });
});

describe("5. the history is bounded", () => {
  it("keeps the newest fifty transitions and no more", () => {
    let history = createEditHistory(named("A"));
    for (let step = 1; step <= 60; step += 1) {
      history = recordEdit(history, named(`s${step}`), NOTE);
    }
    expect(history.snapshots.length).toBe(historyLimits.maxUndoSteps + 1);
    expect(currentSong(history).title).toBe("s60");
  });

  it("leaves the cursor on the newest snapshot after trimming", () => {
    let history = createEditHistory(named("A"));
    for (let step = 1; step <= 60; step += 1) {
      history = recordEdit(history, named(`s${step}`), NOTE);
    }
    expect(history.cursor).toBe(history.snapshots.length - 1);

    // Fifty undos are available; the fifty-first is not.
    for (let step = 0; step < historyLimits.maxUndoSteps; step += 1) {
      expect(canUndo(history)).toBe(true);
      history = undo(history);
    }
    expect(canUndo(history)).toBe(false);
    expect(currentSong(history).title).toBe("s10");
  });

  it("obeys a limit it is handed, so the number is not baked in", () => {
    let history = createEditHistory(named("A"));
    for (const title of ["B", "C", "D", "E"]) {
      history = recordEdit(history, named(title), NOTE, 2);
    }
    expect(history.snapshots.length).toBe(3);
    expect(history.snapshots.map((entry) => entry.song.title)).toEqual([
      "C",
      "D",
      "E",
    ]);
  });
});

describe("6. a step says what it was", () => {
  it("names the edit undo would reverse, and the one redo would repeat", () => {
    let history = createEditHistory(named("A"));
    history = recordEdit(history, named("B"), NOTE);
    history = recordEdit(history, named("C"), DELETE_BARS);

    expect(undoAction(history)).toEqual(DELETE_BARS);
    expect(redoAction(history)).toBeNull();

    history = undo(history);
    expect(undoAction(history)).toEqual(NOTE);
    expect(redoAction(history)).toEqual(DELETE_BARS);

    history = undo(history);
    expect(undoAction(history)).toBeNull();
    expect(redoAction(history)).toEqual(NOTE);
  });
});

describe("7. a baseline is not a step", () => {
  it("resetting leaves one snapshot and nowhere to go", () => {
    let history = historyOf("B", "C");
    history = resetEditHistory(named("Z"));
    expect(history.snapshots.length).toBe(1);
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(currentSong(history).title).toBe("Z");
  });
});

describe("8. nothing is mutated", () => {
  it("recording, undoing and redoing all leave their input alone", () => {
    const history = historyOf("B", "C");
    const before = JSON.stringify(history);

    recordEdit(history, named("D"), NOTE);
    undo(history);
    redo(history);

    expect(JSON.stringify(history)).toBe(before);
  });

  it("keeps the exact song object it was given", () => {
    const song = named("B");
    const history = recordEdit(createEditHistory(named("A")), song, NOTE);
    // Identity, not just equality: a snapshot is the song, not a copy of it,
    // so undo can hand back something byte-identical without re-serialising.
    expect(currentSong(history)).toBe(song);
  });
});

describe("9. the same music is the same music", () => {
  it("sees through key order", () => {
    const left = { a: 1, b: { c: 2, d: 3 } };
    const right = { b: { d: 3, c: 2 }, a: 1 };
    expect(sameSong(left, right)).toBe(true);
  });

  it("does not see through array order, because that is the music", () => {
    expect(sameSong([1, 2, 3], [1, 3, 2])).toBe(false);
  });

  it("tells a missing key from a key set to undefined", () => {
    expect(sameSong({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });

  it("agrees with itself on a real song", () => {
    expect(sameSong(named("A"), named("A"))).toBe(true);
    expect(sameSong(named("A"), named("B"))).toBe(false);
  });
});

describe("10. a run of edits is deterministic", () => {
  it("gives a byte-equivalent history five times over", () => {
    const build = () => {
      let history = createEditHistory(named("A"));
      history = recordEdit(history, named("B"), NOTE);
      history = recordEdit(history, named("C"), DELETE_BARS);
      history = undo(history);
      history = recordEdit(history, named("D"), NOTE);
      return JSON.stringify(history);
    };
    const runs = Array.from({ length: 5 }, build);
    expect(new Set(runs).size).toBe(1);
  });
});

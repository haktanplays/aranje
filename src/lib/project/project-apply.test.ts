/**
 * Opening a project is one edit (spec 13.15, 2L-A): one storage write, one
 * history step, and an undo that brings the previous song back byte for byte.
 *
 * Exercised against the real store with a counting storage double, because
 * "exactly one write" is a promise about the wiring, not about any function.
 */
import { describe, expect, it } from "vitest";

import { parseProjectText, exportProject } from "@/lib/project/project-file";
import { guitarTrack, melodicBar, restSlots, section, song } from "@/lib/song/fixtures";
import { createSongStore } from "@/lib/song/song-store";
import { loadSong, SONG_KEY, type StorageLike } from "@/lib/song/storage";

function countingStorage(): StorageLike & { songWrites(): number } {
  const map = new Map<string, string>();
  let songWrites = 0;
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      if (key === SONG_KEY) songWrites += 1;
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    songWrites: () => songWrites,
  };
}

const BASELINE = song(
  [guitarTrack()],
  [section([melodicBar("gtr", restSlots(8))])],
  { title: "Eldeki" },
);

const IMPORTED = song(
  [guitarTrack()],
  [section([melodicBar("gtr", restSlots(8))])],
  { title: "Yedekten", bpm: 96 },
);

function storeWith(baseline = BASELINE) {
  const storage = countingStorage();
  const store = createSongStore(loadSong(storage), storage);
  store.replaceBaseline(baseline);
  return { storage, store };
}

describe("32. apply is one commit", () => {
  it("writes exactly once and adds exactly one history step", () => {
    const { storage, store } = storeWith();
    const before = storage.songWrites();
    const depthBefore = store.getSnapshot().undoDepth;

    expect(store.commit(IMPORTED, { kind: "project_import" })).toBe(true);

    expect(storage.songWrites()).toBe(before + 1);
    const snapshot = store.getSnapshot();
    expect(snapshot.undoDepth).toBe(depthBefore + 1);
    expect(snapshot.song).toEqual(IMPORTED);
  });

  it("names the step for undo and redo", () => {
    const { store } = storeWith();
    store.commit(IMPORTED, { kind: "project_import" });
    expect(store.getSnapshot().undoLabel).toBe("Geri al: Projeyi açma");
    store.undo();
    expect(store.getSnapshot().redoLabel).toBe("Yinele: Projeyi açma");
  });

  it("brings the previous song back byte for byte, and forward again", () => {
    const { storage, store } = storeWith();
    const baselineBytes = JSON.stringify(store.getSnapshot().song);
    store.commit(IMPORTED, { kind: "project_import" });
    const importedBytes = JSON.stringify(store.getSnapshot().song);

    const writesBeforeUndo = storage.songWrites();
    store.undo();
    expect(JSON.stringify(store.getSnapshot().song)).toBe(baselineBytes);
    expect(storage.songWrites()).toBe(writesBeforeUndo + 1);

    store.redo();
    expect(JSON.stringify(store.getSnapshot().song)).toBe(importedBytes);
    expect(storage.songWrites()).toBe(writesBeforeUndo + 2);
  });

  it("treats the same music as a no-op: no write, no step", () => {
    const { storage, store } = storeWith();
    const before = storage.songWrites();
    // Structurally equal, different object — the honest no-op case.
    expect(
      store.commit(structuredClone(BASELINE), { kind: "project_import" }),
    ).toBe(false);
    expect(storage.songWrites()).toBe(before);
    expect(store.getSnapshot().undoDepth).toBe(0);
  });
});

describe("33. a parsed file survives the whole path", () => {
  it("export → parse → commit round-trips the music exactly", () => {
    const exported = exportProject(IMPORTED);
    if (!exported.ok) throw new Error("export refused");
    const parsed = parseProjectText(exported.text);
    if (!parsed.ok) throw new Error("parse refused");

    const { store } = storeWith();
    expect(store.commit(parsed.song, { kind: "project_import" })).toBe(true);
    expect(store.getSnapshot().song).toEqual(IMPORTED);
  });
});

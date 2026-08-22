/**
 * A group move is one step, all the way down (spec 5.6, 13.1).
 *
 * The pure command already refuses to move half a selection. This is the other
 * half of that promise: what reaches storage and the undo stack is one write
 * and one step, and a refused move leaves both untouched.
 */
import { describe, expect, it } from "vitest";

import { applyMoveOnsetGroup, type OnsetMovement } from "@/lib/song/move";
import { createSongStore } from "@/lib/song/song-store";
import { decideLoad } from "@/lib/song/storage-envelope";
import { SONG_KEY, type StorageLike } from "@/lib/song/storage";
import { bar, note, readBar, slots, song, REST } from "@/test/move-fixtures";
import type { Song } from "@/lib/song/schema";

/** The song on disk, read through the real decoder (2K-B envelope). */
function storedSong(storage: { map: Map<string, string> }): Song | null {
  const decision = decideLoad(storage.map.get(SONG_KEY) ?? null);
  return decision.kind === "envelope" || decision.kind === "legacy"
    ? decision.song
    : null;
}

function countingStorage(): StorageLike & { writes: number; map: Map<string, string> } {
  const map = new Map<string, string>();
  const storage = {
    map,
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

const A3 = () => note("A3", 1, 12);
const C4 = () => note("C4", 1, 15);
const E4 = () => note("E4", 2, 14);

/** Three chords with a gap after each, so all three can move right. */
function threeChords(): Song {
  return song([bar(slots([A3(), REST, C4(), REST, E4()]))]);
}

function moveOn(
  store: ReturnType<typeof createSongStore>,
  origins: readonly { barIndex: number; slotIndex: number }[],
  movement: OnsetMovement,
) {
  const result = applyMoveOnsetGroup(store.getSnapshot().song, {
    kind: "move_onset_group",
    sectionId: "s1",
    trackId: "gtr",
    origins,
    movement,
  });
  if (result.ok) store.commit(result.song, { kind: "group_move" });
  return result;
}

describe("a successful group move", () => {
  it("writes to storage exactly once, however many chords moved", () => {
    const storage = countingStorage();
    const store = createSongStore({ song: threeChords(), outcome: "stored", canPersist: true }, storage);
    const writesBefore = storage.writes;

    const result = moveOn(
      store,
      [
        { barIndex: 0, slotIndex: 0 },
        { barIndex: 0, slotIndex: 2 },
        { barIndex: 0, slotIndex: 4 },
      ],
      "next_slot",
    );

    expect(result.ok).toBe(true);
    expect(storage.writes - writesBefore).toBe(1);
    expect(readBar(store.getSnapshot().song, 0)).toEqual([
      ".", "A3", ".", "C4", ".", "E4", ".", ".",
    ]);
  });

  it("comes back in one undo, not one per chord", () => {
    const before = threeChords();
    const store = createSongStore({ song: before, outcome: "stored", canPersist: true }, countingStorage());

    moveOn(
      store,
      [
        { barIndex: 0, slotIndex: 0 },
        { barIndex: 0, slotIndex: 2 },
        { barIndex: 0, slotIndex: 4 },
      ],
      "next_slot",
    );
    expect(store.getSnapshot().canUndo).toBe(true);

    store.undo();

    expect(readBar(store.getSnapshot().song, 0)).toEqual(readBar(before, 0));
    expect(store.getSnapshot().canUndo).toBe(false);
  });

  it("puts the stored song back where it was on that one undo", () => {
    const storage = countingStorage();
    const store = createSongStore({ song: threeChords(), outcome: "stored", canPersist: true }, storage);

    moveOn(store, [{ barIndex: 0, slotIndex: 0 }], "next_slot");
    const afterMove = storage.map.get(SONG_KEY);
    store.undo();

    expect(storage.map.get(SONG_KEY)).not.toBe(afterMove);
    expect(storedSong(storage)).toEqual(
      JSON.parse(JSON.stringify(threeChords())),
    );
  });
});

describe("a refused group move", () => {
  it("leaves the song, storage and the history exactly as they were", () => {
    const storage = countingStorage();
    // Two chords back to back: the second cannot move onto the first.
    const before = song([bar(slots([A3(), C4()]))]);
    const store = createSongStore({ song: before, outcome: "stored", canPersist: true }, storage);
    const writesBefore = storage.writes;
    const stored = storage.map.get(SONG_KEY);

    const result = moveOn(store, [{ barIndex: 0, slotIndex: 0 }], "next_slot");

    expect(result.ok).toBe(false);
    expect(store.getSnapshot().song).toBe(before);
    expect(store.getSnapshot().canUndo).toBe(false);
    expect(storage.writes).toBe(writesBefore);
    expect(storage.map.get(SONG_KEY)).toBe(stored);
  });

  it("refuses the whole selection when only one of its chords is blocked", () => {
    const storage = countingStorage();
    // The first chord has room; the last one is against the section's end.
    const before = song([
      bar(slots([A3(), REST, REST, REST, REST, REST, REST, C4()])),
    ]);
    const store = createSongStore({ song: before, outcome: "stored", canPersist: true }, storage);

    const result = moveOn(
      store,
      [
        { barIndex: 0, slotIndex: 0 },
        { barIndex: 0, slotIndex: 7 },
      ],
      "next_slot",
    );

    expect(result.ok).toBe(false);
    // Not even the chord that could have moved did.
    expect(readBar(store.getSnapshot().song, 0)[0]).toBe("A3");
    expect(store.getSnapshot().canUndo).toBe(false);
  });
});

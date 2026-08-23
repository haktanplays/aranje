/**
 * Lifecycle commands against the real gate (spec 13.17, 2L-B §10, §14).
 *
 * The cores are pure; what makes a lifecycle change trustworthy is what the
 * *store* does with it: one successful apply is exactly one storage write
 * and one history step, a refused or no-op apply is exactly zero of both,
 * and undo brings the previous song back byte-for-byte through the same
 * envelope every other edit uses.
 */
import { describe, expect, it } from "vitest";

import { applySectionCommand } from "@/lib/song/section-lifecycle";
import { applySongCommand } from "@/lib/song/song-lifecycle";
import { applyTrackCommand } from "@/lib/song/track-lifecycle";
import { createSongStore } from "@/lib/song/song-store";
import { decideLoad } from "@/lib/song/storage-envelope";
import { sameSong } from "@/lib/song/edit-history";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { SONG_KEY, type StorageLike } from "@/lib/song/storage";

function countingStorage(): StorageLike & {
  map: Map<string, string>;
  writes: () => number;
} {
  const map = new Map<string, string>();
  let count = 0;
  return {
    map,
    writes: () => count,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      count += 1;
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

const storedSong = (storage: { map: Map<string, string> }) => {
  const decision = decideLoad(storage.map.get(SONG_KEY) ?? null);
  return "song" in decision ? decision.song : null;
};

const freshStore = () => {
  const storage = countingStorage();
  const store = createSongStore(
    { song: SAMPLE_SONG, outcome: "stored", canPersist: true },
    storage,
  );
  return { storage, store };
};

describe("52. one apply, one write, one step", () => {
  it("applies a song command as a single commit undo can reverse byte-equally", () => {
    /*
     * `update_song_info` since 2O-A: "new song" is no longer a command that
     * replaces the open one, it is a new project, and the library owns it.
     * What this test is about — one apply, one write, one reversible step —
     * is unchanged and is the same for every song command.
     */
    const { storage, store } = freshStore();
    const result = applySongCommand(store.getSnapshot().song, {
      kind: "update_song_info",
      info: { title: "Başka Ad", tonic: "A", mode: "minor", bpm: 96 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const before = storage.writes();
    expect(
      store.commit(result.song, { kind: "lifecycle", command: "update_song_info" }),
    ).toBe(true);
    expect(storage.writes()).toBe(before + 1);
    expect(sameSong(storedSong(storage), result.song)).toBe(true);

    // Undo restores the old song on disk as well — and writes once, because
    // undo persists (2K-B contract).
    store.undo();
    expect(storage.writes()).toBe(before + 2);
    expect(sameSong(storedSong(storage), SAMPLE_SONG)).toBe(true);

    store.redo();
    expect(storage.writes()).toBe(before + 3);
    expect(sameSong(storedSong(storage), result.song)).toBe(true);
  });

  it("labels the undo control with the lifecycle sentence", () => {
    const { store } = freshStore();
    const result = applySectionCommand(store.getSnapshot().song, {
      kind: "duplicate_section",
      sectionId: SAMPLE_SONG.sections[0]!.id,
    });
    if (!result.ok) throw new Error("duplicate failed");
    store.commit(result.song, {
      kind: "lifecycle",
      command: "duplicate_section",
    });
    expect(store.getSnapshot().undoLabel).toBe("Geri al: Bölüm çoğaltma");
  });

  it("a destructive clear undoes to the exact previous bytes", () => {
    const { storage, store } = freshStore();
    /*
     * First a benign commit, so the song on disk is a written baseline the
     * undo can be compared against byte for byte — same writer, same
     * serialisation, no room for a key-order accident to hide behind.
     */
    const renamed = applyTrackCommand(store.getSnapshot().song, {
      kind: "rename_track",
      trackId: "gtr",
      name: "Gitar Bir",
    });
    if (!renamed.ok) throw new Error("rename failed");
    store.commit(renamed.song, { kind: "lifecycle", command: "rename_track" });
    const beforeBytes = JSON.stringify(storedSong(storage));

    const cleared = applyTrackCommand(store.getSnapshot().song, {
      kind: "replace_track_setup_and_clear_content",
      trackId: "gtr",
      setup: {
        name: "Gitar 1",
        instrumentId: "electric_guitar",
        presetId: "clean",
        fretboard: {
          tuning: ["E2", "A2", "D3", "G3", "B3", "E4"],
          capo: 0,
        },
      },
    });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;

    store.commit(cleared.song, {
      kind: "lifecycle",
      command: "replace_track_setup_and_clear_content",
    });
    expect(storedSong(storage)?.tracks[0]?.presetId).toBe("clean");
    store.undo();
    // The undo write puts the old setup and all its music back on disk,
    // byte for byte with what was there before the clear.
    expect(JSON.stringify(storedSong(storage))).toBe(beforeBytes);
  });
});

describe("53. nothing advances on refusal or no-op", () => {
  it("a refused command never reaches the store at all", () => {
    const { storage, store } = freshStore();
    const before = storage.writes();
    const result = applySectionCommand(store.getSnapshot().song, {
      kind: "delete_section",
      sectionId: "yok",
    });
    expect(result.ok).toBe(false);
    // The controller stops at the refusal; and even a slipped-through commit
    // of the *same* song would be refused by the gate:
    expect(
      store.commit(store.getSnapshot().song, {
        kind: "lifecycle",
        command: "delete_section",
      }),
    ).toBe(false);
    expect(storage.writes()).toBe(before);
    expect(store.getSnapshot().canUndo).toBe(false);
  });

  it("a no-op apply is zero writes and zero steps", () => {
    const { storage, store } = freshStore();
    const result = applySongCommand(store.getSnapshot().song, {
      kind: "update_song_info",
      info: { title: SAMPLE_SONG.title, tonic: "E", mode: "minor", bpm: 132 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(sameSong(result.song, SAMPLE_SONG)).toBe(true);
    const before = storage.writes();
    expect(
      store.commit(result.song, {
        kind: "lifecycle",
        command: "update_song_info",
      }),
    ).toBe(false);
    expect(storage.writes()).toBe(before);
    expect(store.getSnapshot().canUndo).toBe(false);
  });

  it("cannot persist means cannot commit — and the song stands still", () => {
    const storage = countingStorage();
    const store = createSongStore(
      { song: SAMPLE_SONG, outcome: "stored", canPersist: false },
      storage,
    );
    const result = applySongCommand(store.getSnapshot().song, {
      kind: "update_song_info",
      info: { title: "Başka Ad", tonic: "A", mode: "minor", bpm: 96 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      store.commit(result.song, { kind: "lifecycle", command: "update_song_info" }),
    ).toBe(false);
    expect(storage.writes()).toBe(0);
    expect(sameSong(store.getSnapshot().song, SAMPLE_SONG)).toBe(true);
  });
});

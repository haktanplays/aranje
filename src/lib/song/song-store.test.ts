import { describe, expect, it } from "vitest";

import { createSongStore } from "@/lib/song/song-store";
import type { HistoryAction } from "@/lib/song/edit-history";
import { SONG_KEY, type StorageLike } from "@/lib/song/storage";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import type { Song } from "@/lib/song/schema";

/** Any edit will do for these; the store cares that it was told, not which. */
const NOTE_EDIT: HistoryAction = { kind: "note_edit" };

function memoryStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function refusingStorage(): StorageLike {
  return {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {},
  };
}

const RENAMED: Song = { ...SAMPLE_SONG, title: "Yeni ad" };

describe("the song store", () => {
  it("starts with the loaded song and nothing to undo", () => {
    const store = createSongStore({ song: SAMPLE_SONG, outcome: "stored" }, memoryStorage());
    expect(store.getSnapshot().song).toBe(SAMPLE_SONG);
    expect(store.getSnapshot().canUndo).toBe(false);
  });

  it("writes a commit to storage and to subscribers together", () => {
    const storage = memoryStorage();
    const store = createSongStore({ song: SAMPLE_SONG, outcome: "stored" }, storage);
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });

    store.commit(RENAMED, NOTE_EDIT);

    expect(store.getSnapshot().song.title).toBe("Yeni ad");
    expect(notified).toBe(1);
    const stored = JSON.parse(storage.map.get(SONG_KEY) ?? "{}") as Song;
    expect(stored.title).toBe("Yeni ad");
  });

  it("steps back to the previous song, in storage as well", () => {
    const storage = memoryStorage();
    const store = createSongStore({ song: SAMPLE_SONG, outcome: "stored" }, storage);
    store.commit(RENAMED, NOTE_EDIT);
    expect(store.getSnapshot().canUndo).toBe(true);

    store.undo();
    expect(store.getSnapshot().song.title).toBe(SAMPLE_SONG.title);
    expect(store.getSnapshot().canUndo).toBe(false);
    const stored = JSON.parse(storage.map.get(SONG_KEY) ?? "{}") as Song;
    expect(stored.title).toBe(SAMPLE_SONG.title);
  });

  it("ignores a commit of the song it already holds", () => {
    const store = createSongStore({ song: SAMPLE_SONG, outcome: "stored" }, memoryStorage());
    store.commit(SAMPLE_SONG, NOTE_EDIT);
    expect(store.getSnapshot().canUndo).toBe(false);
  });

  it("keeps working in memory and says so when storage refuses", () => {
    const store = createSongStore({ song: SAMPLE_SONG, outcome: "stored" }, refusingStorage());
    store.commit(RENAMED, NOTE_EDIT);
    expect(store.getSnapshot().song.title).toBe("Yeni ad");
    expect(store.getSnapshot().persisted).toBe(false);
  });

  it("carries the loader's message through", () => {
    const store = createSongStore(
      { song: SAMPLE_SONG, outcome: "recovered", message: "Bozuk veri yedeklendi." },
      memoryStorage(),
    );
    expect(store.getSnapshot().message).toContain("Bozuk veri");
  });

  it("stops notifying an unsubscribed listener", () => {
    const store = createSongStore({ song: SAMPLE_SONG, outcome: "stored" }, memoryStorage());
    let notified = 0;
    const off = store.subscribe(() => {
      notified += 1;
    });
    off();
    store.commit(RENAMED, NOTE_EDIT);
    expect(notified).toBe(0);
  });

  it("starts again from a song that did not come from an edit", () => {
    const store = createSongStore({ song: SAMPLE_SONG, outcome: "stored" }, memoryStorage());
    store.commit(RENAMED, NOTE_EDIT);
    store.replaceBaseline(RENAMED);
    // Nowhere to go in either direction: this is where the song came from.
    expect(store.getSnapshot().canUndo).toBe(false);
    expect(store.getSnapshot().canRedo).toBe(false);
    expect(store.getSnapshot().song.title).toBe("Yeni ad");
  });
});

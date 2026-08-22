import { describe, expect, it } from "vitest";

import { createSongStore } from "@/lib/song/song-store";
import { decideLoad } from "@/lib/song/storage-envelope";
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

/** The song on disk, read through the real decoder (2K-B envelope). */
function storedSong(storage: { map: Map<string, string> }): Song | null {
  const decision = decideLoad(storage.map.get(SONG_KEY) ?? null);
  return decision.kind === "envelope" || decision.kind === "legacy"
    ? decision.song
    : null;
}

describe("the song store", () => {
  it("starts with the loaded song and nothing to undo", () => {
    const store = createSongStore({ song: SAMPLE_SONG, outcome: "stored", canPersist: true }, memoryStorage());
    expect(store.getSnapshot().song).toBe(SAMPLE_SONG);
    expect(store.getSnapshot().canUndo).toBe(false);
  });

  it("writes a commit to storage and to subscribers together", () => {
    const storage = memoryStorage();
    const store = createSongStore({ song: SAMPLE_SONG, outcome: "stored", canPersist: true }, storage);
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });

    store.commit(RENAMED, NOTE_EDIT);

    expect(store.getSnapshot().song.title).toBe("Yeni ad");
    expect(notified).toBe(1);
    const stored = storedSong(storage);
    expect(stored?.title).toBe("Yeni ad");
  });

  it("steps back to the previous song, in storage as well", () => {
    const storage = memoryStorage();
    const store = createSongStore({ song: SAMPLE_SONG, outcome: "stored", canPersist: true }, storage);
    store.commit(RENAMED, NOTE_EDIT);
    expect(store.getSnapshot().canUndo).toBe(true);

    store.undo();
    expect(store.getSnapshot().song.title).toBe(SAMPLE_SONG.title);
    expect(store.getSnapshot().canUndo).toBe(false);
    const stored = storedSong(storage);
    expect(stored?.title).toBe(SAMPLE_SONG.title);
  });

  it("ignores a commit of the song it already holds", () => {
    const store = createSongStore({ song: SAMPLE_SONG, outcome: "stored", canPersist: true }, memoryStorage());
    store.commit(SAMPLE_SONG, NOTE_EDIT);
    expect(store.getSnapshot().canUndo).toBe(false);
  });

  /*
   * Changed deliberately in 2K-B. A refused write used to leave the edit on
   * screen with a note underneath saying it was not saved — which asks the
   * reader to remember which of the things in front of them are real. Now
   * the edit does not happen at all and the banner says why.
   */
  it("refuses the edit outright when storage refuses the write", () => {
    const store = createSongStore(
      { song: SAMPLE_SONG, outcome: "stored", canPersist: true },
      refusingStorage(),
    );
    expect(store.commit(RENAMED, NOTE_EDIT)).toBe(false);
    expect(store.getSnapshot().song.title).toBe(SAMPLE_SONG.title);
    expect(store.getSnapshot().canUndo).toBe(false);
    expect(store.getSnapshot().persisted).toBe(false);
    expect(store.getSnapshot().recovery).toBe("storage_write_failed");
  });

  /*
   * Changed deliberately in 2K-B.1. A session with no storage used to keep
   * editing in memory — an hour of work that looks saved and dies with the
   * tab. That is the exact loss the envelope exists to prevent, delivered by
   * the app itself, so editing is closed instead: the song stays visible and
   * playable, and every mutation is refused at the gate.
   */
  it("refuses to edit when there is no storage at all", () => {
    const store = createSongStore(
      { song: SAMPLE_SONG, outcome: "unavailable", canPersist: false },
      null,
    );
    expect(store.commit(RENAMED, NOTE_EDIT)).toBe(false);
    expect(store.getSnapshot().song.title).toBe(SAMPLE_SONG.title);
    expect(store.getSnapshot().canUndo).toBe(false);
    expect(store.getSnapshot().canRedo).toBe(false);
  });

  it("carries the loader's message through", () => {
    const store = createSongStore(
      {
        song: SAMPLE_SONG,
        outcome: "recovered",
        message: "Bozuk veri yedeklendi.",
        canPersist: true,
      },
      memoryStorage(),
    );
    expect(store.getSnapshot().message).toContain("Bozuk veri");
  });

  it("stops notifying an unsubscribed listener", () => {
    const store = createSongStore({ song: SAMPLE_SONG, outcome: "stored", canPersist: true }, memoryStorage());
    let notified = 0;
    const off = store.subscribe(() => {
      notified += 1;
    });
    off();
    store.commit(RENAMED, NOTE_EDIT);
    expect(notified).toBe(0);
  });

  it("starts again from a song that did not come from an edit", () => {
    const store = createSongStore({ song: SAMPLE_SONG, outcome: "stored", canPersist: true }, memoryStorage());
    store.commit(RENAMED, NOTE_EDIT);
    store.replaceBaseline(RENAMED);
    // Nowhere to go in either direction: this is where the song came from.
    expect(store.getSnapshot().canUndo).toBe(false);
    expect(store.getSnapshot().canRedo).toBe(false);
    expect(store.getSnapshot().song.title).toBe("Yeni ad");
  });
});

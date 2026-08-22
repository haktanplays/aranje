/**
 * What survives, and what it costs (spec 13.14, K-45).
 *
 * `storage-envelope.test.ts` checks what a stored value *means*. This file
 * checks what actually happens to the disk and to the app: how many writes an
 * edit is, what the file looks like afterwards, and — the part that matters
 * most — that a write which fails leaves absolutely nothing moved.
 *
 * Every count here comes from a storage double. "One write" is a number.
 */
import { describe, expect, it } from "vitest";

import type { HistoryAction } from "@/lib/song/edit-history";
import { guitarTrack, restSlots, section, song as makeSong } from "@/lib/song/fixtures";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { createSongStore } from "@/lib/song/song-store";
import {
  CORRUPT_KEY_PREFIX,
  RECOVERY_MESSAGES,
  SONG_KEY,
  loadSong,
  saveSong,
  type StorageLike,
} from "@/lib/song/storage";
import {
  decideLoad,
  SONG_ENVELOPE_FORMAT,
  SONG_ENVELOPE_VERSION,
} from "@/lib/song/storage-envelope";
import { SETTINGS_KEY } from "@/lib/settings/settings";
import type { Bar, Song } from "@/lib/song/schema";

const NOTE: HistoryAction = { kind: "note_edit" };
const FROZEN = () => 1_700_000_000_000;

type Counting = StorageLike & {
  writes: number;
  map: Map<string, string>;
  /** Set to make every subsequent `setItem` throw, like a full disk. */
  refuse: boolean;
};

function countingStorage(initial: Record<string, string> = {}): Counting {
  const map = new Map(Object.entries(initial));
  return {
    map,
    writes: 0,
    refuse: false,
    getItem: (key) => map.get(key) ?? null,
    setItem(key, value) {
      if (this.refuse) {
        const error = new Error("quota");
        error.name = "QuotaExceededError";
        throw error;
      }
      if (key === SONG_KEY) this.writes += 1;
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

const bar = (): Bar => ({
  timeSignature: [4, 4],
  resolution: 8,
  slots: { gtr: restSlots(8) },
});

const base = (): Song =>
  makeSong([guitarTrack({ id: "gtr" })], [section([bar(), bar()])]);

const titled = (song: Song, title: string): Song => ({ ...song, title });

/** The raw envelope on disk, as a value a test can read fields off. */
function onDisk(storage: Counting) {
  const raw = storage.map.get(SONG_KEY);
  return raw === undefined
    ? null
    : (JSON.parse(raw) as {
        format: string;
        version: number;
        revision: number;
        current: Song;
        previous: Song | null;
      });
}

const quarantined = (storage: Counting) =>
  [...storage.map.keys()].filter((key) => key.startsWith(CORRUPT_KEY_PREFIX));

// ------------------------------------------------------------------ loading

describe("10. an empty key is a first run", () => {
  it("opens the sample song and writes nothing", () => {
    const storage = countingStorage();
    const result = loadSong(storage, FROZEN);
    expect(result.outcome).toBe("empty");
    expect(result.recovery).toBeUndefined();
    expect(result.canPersist).toBe(true);
    expect(storage.writes).toBe(0);
  });
});

describe("11. a legacy song opens without being rewritten", () => {
  it("does not migrate at load", () => {
    const storage = countingStorage({ [SONG_KEY]: JSON.stringify(SAMPLE_SONG) });
    const result = loadSong(storage, FROZEN);

    expect(result.outcome).toBe("stored");
    expect(result.song).toEqual(SAMPLE_SONG);
    expect(result.recovery).toBeUndefined();
    // Opening a song is not a reason to write one.
    expect(storage.writes).toBe(0);
    expect(storage.map.get(SONG_KEY)).toBe(JSON.stringify(SAMPLE_SONG));
  });

  it("becomes an envelope on the first real edit, keeping the old song", () => {
    const storage = countingStorage({ [SONG_KEY]: JSON.stringify(SAMPLE_SONG) });
    const store = createSongStore(loadSong(storage, FROZEN), storage);

    store.commit(titled(SAMPLE_SONG, "İlk düzenleme"), NOTE);

    const file = onDisk(storage);
    expect(storage.writes).toBe(1);
    expect(file?.format).toBe(SONG_ENVELOPE_FORMAT);
    expect(file?.version).toBe(SONG_ENVELOPE_VERSION);
    expect(file?.current.title).toBe("İlk düzenleme");
    // The legacy song is the rung to climb back to.
    expect(file?.previous).toEqual(SAMPLE_SONG);
  });
});

describe("12. a broken current slot is rescued by previous", () => {
  const broken = () =>
    JSON.stringify({
      format: SONG_ENVELOPE_FORMAT,
      version: SONG_ENVELOPE_VERSION,
      revision: 6,
      current: { half: "written" },
      previous: titled(base(), "Kurtarılan"),
    });

  it("opens the older song and says so in the reader's words", () => {
    const storage = countingStorage({ [SONG_KEY]: broken() });
    const result = loadSong(storage, FROZEN);

    expect(result.song.title).toBe("Kurtarılan");
    expect(result.recovery).toBe("recovered_previous");
    expect(result.message).toBe(RECOVERY_MESSAGES.recovered_previous);
    expect(result.canPersist).toBe(true);
  });

  it("keeps the broken file and repairs the key", () => {
    const storage = countingStorage({ [SONG_KEY]: broken() });
    const raw = broken();
    loadSong(storage, FROZEN);

    const backups = quarantined(storage);
    expect(backups.length).toBe(1);
    expect(storage.map.get(backups[0]!)).toBe(raw);

    // The key now holds a healthy envelope, so the next reload is not a
    // rescue from a `previous` that has meanwhile fallen further behind.
    const decision = decideLoad(storage.map.get(SONG_KEY) ?? null);
    expect(decision.kind).toBe("envelope");
    if (decision.kind !== "envelope") return;
    expect(decision.song.title).toBe("Kurtarılan");
    expect(decision.revision).toBe(7);
  });

  it("does not report success when the repair itself is refused", () => {
    const storage = countingStorage({ [SONG_KEY]: broken() });
    storage.refuse = true;
    const result = loadSong(storage, FROZEN);

    expect(result.song.title).toBe("Kurtarılan");
    expect(result.recovery).toBe("storage_write_failed");
    expect(result.canPersist).toBe(false);
  });

  it("gives a second rescue its own key rather than overwriting the first", () => {
    const storage = countingStorage({
      [`${CORRUPT_KEY_PREFIX}1700000000000`]: "an earlier rescue",
      [SONG_KEY]: broken(),
    });
    loadSong(storage, FROZEN);

    expect(storage.map.get(`${CORRUPT_KEY_PREFIX}1700000000000`)).toBe(
      "an earlier rescue",
    );
    expect(storage.map.get(`${CORRUPT_KEY_PREFIX}1700000000000.1`)).toBe(broken());
  });
});

describe("13. nothing readable means the raw value is kept", () => {
  it("quarantines and opens the sample song", () => {
    const raw = JSON.stringify({
      format: SONG_ENVELOPE_FORMAT,
      version: SONG_ENVELOPE_VERSION,
      revision: 2,
      current: { a: 1 },
      previous: { b: 2 },
    });
    const storage = countingStorage({ [SONG_KEY]: raw });
    const result = loadSong(storage, FROZEN);

    expect(result.song.title).toBe(SAMPLE_SONG.title);
    expect(result.recovery).toBe("corrupt_fallback");
    expect(result.message).toBe(RECOVERY_MESSAGES.corrupt_fallback);
    expect(quarantined(storage).length).toBe(1);
    expect(storage.map.has(SONG_KEY)).toBe(false);
  });

  it("does the same for text that is not JSON at all", () => {
    const storage = countingStorage({ [SONG_KEY]: "{not json" });
    const result = loadSong(storage, FROZEN);
    expect(result.recovery).toBe("corrupt_fallback");
    expect(storage.map.get(`${CORRUPT_KEY_PREFIX}1700000000000`)).toBe("{not json");
  });
});

describe("14. a file from a newer version is left alone", () => {
  const future = () =>
    JSON.stringify({ format: SONG_ENVELOPE_FORMAT, version: 2, chunks: [] });

  it("is not quarantined, not cleared, not rewritten", () => {
    const raw = future();
    const storage = countingStorage({ [SONG_KEY]: raw });
    const result = loadSong(storage, FROZEN);

    expect(result.recovery).toBe("unsupported_version");
    expect(result.canPersist).toBe(false);
    expect(storage.map.get(SONG_KEY)).toBe(raw);
    expect(quarantined(storage)).toEqual([]);
    expect(storage.writes).toBe(0);
  });

  it("refuses every commit rather than overwriting it", () => {
    const raw = future();
    const storage = countingStorage({ [SONG_KEY]: raw });
    const store = createSongStore(loadSong(storage, FROZEN), storage);

    expect(store.commit(titled(base(), "Yeni"), NOTE)).toBe(false);
    expect(storage.map.get(SONG_KEY)).toBe(raw);
    expect(storage.writes).toBe(0);
    expect(store.getSnapshot().canUndo).toBe(false);
    expect(store.getSnapshot().recovery).toBe("unsupported_version");
    expect(store.getSnapshot().canPersist).toBe(false);
  });
});

// ------------------------------------------------------------------ writing

describe("15. every step is exactly one write", () => {
  it("counts one for a commit, one for an undo, one for a redo", () => {
    const storage = countingStorage();
    const source = base();
    const store = createSongStore(loadSong(storage, FROZEN), storage);

    store.commit(titled(source, "B"), NOTE);
    expect(storage.writes).toBe(1);
    store.commit(titled(source, "C"), NOTE);
    expect(storage.writes).toBe(2);

    store.undo();
    expect(storage.writes).toBe(3);
    store.redo();
    expect(storage.writes).toBe(4);
  });

  it("writes nothing for a no-op or an impossible step", () => {
    const storage = countingStorage();
    const source = base();
    const store = createSongStore(
      { song: source, outcome: "stored", canPersist: true },
      storage,
    );

    store.commit(source, NOTE);
    store.undo();
    store.redo();
    expect(storage.writes).toBe(0);
  });
});

describe("16. the revision only ever counts up", () => {
  it("increases through commits, undos and redos alike", () => {
    const storage = countingStorage();
    const source = base();
    const store = createSongStore(loadSong(storage, FROZEN), storage);
    const seen: number[] = [];

    store.commit(titled(source, "B"), NOTE);
    seen.push(onDisk(storage)!.revision);
    store.commit(titled(source, "C"), NOTE);
    seen.push(onDisk(storage)!.revision);
    store.undo();
    seen.push(onDisk(storage)!.revision);
    store.redo();
    seen.push(onDisk(storage)!.revision);

    expect(seen).toEqual([1, 2, 3, 4]);
  });
});

describe("17. previous is what was on disk a moment ago", () => {
  it("after a commit, it is the song the commit replaced", () => {
    const storage = countingStorage();
    const source = base();
    const store = createSongStore(loadSong(storage, FROZEN), storage);

    store.commit(titled(source, "B"), NOTE);
    store.commit(titled(source, "C"), NOTE);

    expect(onDisk(storage)?.current.title).toBe("C");
    expect(onDisk(storage)?.previous?.title).toBe("B");
  });

  it("after an undo, it is the song the undo left", () => {
    const storage = countingStorage();
    const source = base();
    const store = createSongStore(loadSong(storage, FROZEN), storage);
    store.commit(titled(source, "B"), NOTE);
    store.commit(titled(source, "C"), NOTE);

    store.undo();
    // Back to B on screen; the rung behind it is the C that was on disk.
    expect(onDisk(storage)?.current.title).toBe("B");
    expect(onDisk(storage)?.previous?.title).toBe("C");
  });

  it("after a redo, it is the song the redo left", () => {
    const storage = countingStorage();
    const source = base();
    const store = createSongStore(loadSong(storage, FROZEN), storage);
    store.commit(titled(source, "B"), NOTE);
    store.commit(titled(source, "C"), NOTE);
    store.undo();

    store.redo();
    expect(onDisk(storage)?.current.title).toBe("C");
    expect(onDisk(storage)?.previous?.title).toBe("B");
  });
});

// ---------------------------------------------------------------- atomicity

describe("18. a refused write moves nothing at all", () => {
  it("leaves the song, the history and the file exactly as they were", () => {
    const storage = countingStorage();
    const source = base();
    const store = createSongStore(loadSong(storage, FROZEN), storage);
    store.commit(titled(source, "B"), NOTE);

    const fileBefore = storage.map.get(SONG_KEY);
    const writesBefore = storage.writes;
    storage.refuse = true;

    expect(store.commit(titled(source, "C"), NOTE)).toBe(false);

    expect(store.getSnapshot().song.title).toBe("B");
    expect(store.getSnapshot().undoDepth).toBe(1);
    expect(store.getSnapshot().redoDepth).toBe(0);
    expect(store.getSnapshot().persisted).toBe(false);
    expect(store.getSnapshot().recovery).toBe("storage_write_failed");
    expect(storage.map.get(SONG_KEY)).toBe(fileBefore);
    expect(storage.writes).toBe(writesBefore);
  });

  it("does not drop the redo branch", () => {
    const storage = countingStorage();
    const source = base();
    const store = createSongStore(loadSong(storage, FROZEN), storage);
    store.commit(titled(source, "B"), NOTE);
    store.commit(titled(source, "C"), NOTE);
    store.undo();
    expect(store.getSnapshot().redoDepth).toBe(1);

    storage.refuse = true;
    store.commit(titled(source, "D"), NOTE);

    // The branch a successful commit would have truncated is still there.
    expect(store.getSnapshot().redoDepth).toBe(1);
    expect(store.getSnapshot().song.title).toBe("B");
  });

  it("does not move the cursor on a failed undo", () => {
    const storage = countingStorage();
    const source = base();
    const store = createSongStore(loadSong(storage, FROZEN), storage);
    store.commit(titled(source, "B"), NOTE);
    store.commit(titled(source, "C"), NOTE);

    storage.refuse = true;
    store.undo();

    expect(store.getSnapshot().song.title).toBe("C");
    expect(store.getSnapshot().undoDepth).toBe(2);
  });

  it("does not move the cursor on a failed redo", () => {
    const storage = countingStorage();
    const source = base();
    const store = createSongStore(loadSong(storage, FROZEN), storage);
    store.commit(titled(source, "B"), NOTE);
    store.commit(titled(source, "C"), NOTE);
    store.undo();

    storage.refuse = true;
    store.redo();

    expect(store.getSnapshot().song.title).toBe("B");
    expect(store.getSnapshot().redoDepth).toBe(1);
  });

  it("recovers the moment storage does", () => {
    const storage = countingStorage();
    const source = base();
    const store = createSongStore(loadSong(storage, FROZEN), storage);
    storage.refuse = true;
    store.commit(titled(source, "B"), NOTE);
    expect(store.getSnapshot().recovery).toBe("storage_write_failed");

    storage.refuse = false;
    expect(store.commit(titled(source, "B"), NOTE)).toBe(true);
    expect(store.getSnapshot().song.title).toBe("B");
    expect(store.getSnapshot().recovery).toBeNull();
  });
});

// -------------------------------------------------------------- neighbours

describe("19. recovery is not an edit, and settings are not the song", () => {
  it("opens a rescued song with nothing to undo", () => {
    const storage = countingStorage({
      [SONG_KEY]: JSON.stringify({
        format: SONG_ENVELOPE_FORMAT,
        version: SONG_ENVELOPE_VERSION,
        revision: 1,
        current: { broken: true },
        previous: titled(base(), "Kurtarılan"),
      }),
    });
    const store = createSongStore(loadSong(storage, FROZEN), storage);
    expect(store.getSnapshot().canUndo).toBe(false);
    expect(store.getSnapshot().canRedo).toBe(false);
  });

  it("leaves the practice setting alone through a total loss", () => {
    const settings = JSON.stringify({ practiceRatePercent: 75 });
    const storage = countingStorage({
      [SONG_KEY]: "{not json",
      [SETTINGS_KEY]: settings,
    });
    loadSong(storage, FROZEN);
    expect(storage.map.get(SETTINGS_KEY)).toBe(settings);
  });

  it("puts the banner down without touching the file", () => {
    const storage = countingStorage({ [SONG_KEY]: "{not json" });
    const store = createSongStore(loadSong(storage, FROZEN), storage);
    expect(store.getSnapshot().recovery).toBe("corrupt_fallback");

    const before = storage.writes;
    store.dismissRecovery();
    expect(store.getSnapshot().recovery).toBeNull();
    expect(store.getSnapshot().song.title).toBe(SAMPLE_SONG.title);
    expect(storage.writes).toBe(before);
  });
});

describe("20. the same file gives the same answer every time", () => {
  it("is byte-equivalent across five loads", () => {
    const raw = JSON.stringify({
      format: SONG_ENVELOPE_FORMAT,
      version: SONG_ENVELOPE_VERSION,
      revision: 3,
      current: { broken: true },
      previous: titled(base(), "Kurtarılan"),
    });
    const runs = Array.from({ length: 5 }, () => {
      const storage = countingStorage({ [SONG_KEY]: raw });
      const result = loadSong(storage, FROZEN);
      return JSON.stringify({
        song: result.song,
        outcome: result.outcome,
        recovery: result.recovery,
        canPersist: result.canPersist,
        file: storage.map.get(SONG_KEY),
      });
    });
    expect(new Set(runs).size).toBe(1);
  });

  it("does not mutate the song it is asked to save", () => {
    const storage = countingStorage();
    const song = base();
    const before = JSON.stringify(song);
    saveSong(song, storage);
    expect(JSON.stringify(song)).toBe(before);
  });
});

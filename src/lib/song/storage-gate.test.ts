/**
 * The unavailable gate, and every physical operation counted (2K-B.1).
 *
 * Two subjects, one discipline. First: a session that cannot write does not
 * edit — the memory-only mode is gone, because an hour of work that looks
 * saved and dies with the tab is the exact loss the envelope exists to
 * prevent. Second: the write accounting is a ledger of real operations, not a
 * summary — every `setItem` and `removeItem`, on every key, in order, with
 * whether it landed. A load path that claims "zero writes" while probing the
 * disk is hiding its own footprint.
 */
import { describe, expect, it } from "vitest";

import { copyBars } from "@/lib/song/bar-transform";
import type { HistoryAction } from "@/lib/song/edit-history";
import { guitarTrack, restSlots, section, song as makeSong } from "@/lib/song/fixtures";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { createSongStore } from "@/lib/song/song-store";
import {
  CORRUPT_KEY_PREFIX,
  WRITE_CHECK_KEY,
  SONG_KEY,
  loadSong,
  saveSong,
  type StorageLike,
} from "@/lib/song/storage";
import {
  SONG_ENVELOPE_FORMAT,
  SONG_ENVELOPE_VERSION,
} from "@/lib/song/storage-envelope";
import type { Bar, Song } from "@/lib/song/schema";

const NOTE: HistoryAction = { kind: "note_edit" };
const FROZEN = () => 1_700_000_000_000;

/** One physical storage operation, exactly as it happened. */
type Op = {
  readonly op: "set" | "remove";
  readonly key: string;
  readonly ok: boolean;
};

type Ledger = StorageLike & {
  ops: Op[];
  map: Map<string, string>;
  /** Keys whose writes throw, so a failure can be aimed at one operation. */
  failKeys: (key: string) => boolean;
};

function ledgerStorage(initial: Record<string, string> = {}): Ledger {
  const map = new Map(Object.entries(initial));
  const storage: Ledger = {
    map,
    ops: [],
    failKeys: () => false,
    getItem: (key) => map.get(key) ?? null,
    setItem(key, value) {
      if (this.failKeys(key)) {
        this.ops.push({ op: "set", key, ok: false });
        const error = new Error("quota");
        error.name = "QuotaExceededError";
        throw error;
      }
      this.ops.push({ op: "set", key, ok: true });
      map.set(key, value);
    },
    removeItem(key) {
      this.ops.push({ op: "remove", key, ok: true });
      map.delete(key);
    },
  };
  return storage;
}

/** The ledger reduced to the shape the matrix talks about. */
const summarise = (ops: readonly Op[]) => ({
  probe: ops.filter((entry) => entry.key === WRITE_CHECK_KEY).length,
  songSet: ops.filter(
    (entry) => entry.op === "set" && entry.key === SONG_KEY && entry.ok,
  ).length,
  songRemove: ops.filter(
    (entry) => entry.op === "remove" && entry.key === SONG_KEY,
  ).length,
  corruptSet: ops.filter(
    (entry) =>
      entry.op === "set" && entry.key.startsWith(CORRUPT_KEY_PREFIX) && entry.ok,
  ).length,
});

const bar = (): Bar => ({
  timeSignature: [4, 4],
  resolution: 8,
  slots: { gtr: restSlots(8) },
});

const base = (): Song =>
  makeSong([guitarTrack({ id: "gtr" })], [section([bar(), bar()])]);

const titled = (song: Song, title: string): Song => ({ ...song, title });

const wrap = (current: unknown, previous: unknown, revision = 4) =>
  JSON.stringify({
    format: SONG_ENVELOPE_FORMAT,
    version: SONG_ENVELOPE_VERSION,
    revision,
    current,
    previous,
  });

// ------------------------------------------------------------------- gate

describe("21. a session that cannot write does not edit", () => {
  it("closes editing when there is no storage API at all", () => {
    const result = loadSong(null, FROZEN);
    expect(result.canPersist).toBe(false);
    expect(result.recovery).toBe("storage_unavailable");
  });

  it("closes editing when storage access itself throws", () => {
    const denied: StorageLike = {
      getItem: () => {
        const error = new Error("denied");
        error.name = "SecurityError";
        throw error;
      },
      setItem: () => {},
      removeItem: () => {},
    };
    const result = loadSong(denied, FROZEN);
    expect(result.canPersist).toBe(false);
    expect(result.recovery).toBe("storage_unavailable");
  });

  it("closes editing when the capability probe is refused", () => {
    const storage = ledgerStorage({ [SONG_KEY]: JSON.stringify(SAMPLE_SONG) });
    storage.failKeys = () => true;
    const result = loadSong(storage, FROZEN);

    // The song is still readable and still shown — read-only.
    expect(result.song).toEqual(SAMPLE_SONG);
    expect(result.canPersist).toBe(false);
    expect(result.recovery).toBe("storage_unavailable");
    // The failed probe is on the ledger, not hidden.
    expect(storage.ops).toEqual([{ op: "set", key: WRITE_CHECK_KEY, ok: false }]);

    /*
     * And the *gate* refuses, not merely the disk. Without the gate a commit
     * would reach `setItem`, fail there, and flip the banner from the
     * non-dismissible "kayıt açılamadı" to the dismissible "tekrar dene" —
     * an app whose explanation for its disabled controls can be put down.
     * The ledger shows the refusal never became a physical attempt.
     */
    const store = createSongStore(result, storage);
    const opsBefore = storage.ops.length;
    expect(store.commit({ ...SAMPLE_SONG, title: "Değişti" }, NOTE)).toBe(false);
    expect(storage.ops.length).toBe(opsBefore);
    expect(store.getSnapshot().recovery).toBe("storage_unavailable");
  });

  it("refuses every mutation at the store gate", () => {
    const source = base();
    const store = createSongStore(
      { song: source, outcome: "unavailable", canPersist: false },
      null,
    );

    expect(store.commit(titled(source, "B"), NOTE)).toBe(false);
    store.undo();
    store.redo();

    const snapshot = store.getSnapshot();
    expect(snapshot.song).toBe(source);
    expect(snapshot.canUndo).toBe(false);
    expect(snapshot.canRedo).toBe(false);
    expect(snapshot.undoDepth).toBe(0);
  });

  it("still allows reading gestures: a copy works without any storage", () => {
    // Copy is a reading, not a mutation — it needs no disk and asks for none.
    const source = base();
    const read = copyBars(source, {
      scope: "track",
      sectionId: "s1",
      trackId: "gtr",
      startBarIndex: 0,
      endBarIndex: 0,
    });
    expect(read.ok).toBe(true);
  });

  it("cannot be dismissed away", () => {
    const store = createSongStore(
      {
        song: SAMPLE_SONG,
        outcome: "unavailable",
        recovery: "storage_unavailable",
        canPersist: false,
      },
      null,
    );
    store.dismissRecovery();
    expect(store.getSnapshot().recovery).toBe("storage_unavailable");
  });
});

// ------------------------------------------------------------------ ledger

describe("22. every load path's physical operations, counted and ordered", () => {
  /*
   * The matrix. Every path pays the capability probe — one `setItem` and one
   * `removeItem` on `aranje.probe` — because "can I save here?" can only be
   * answered by trying, and a probe hidden from the ledger would be the
   * accounting lying about the app's own footprint. On the *song and
   * quarantine keys* the clean paths really are zero.
   */
  const CHECK_OPS: Op[] = [
    { op: "set", key: WRITE_CHECK_KEY, ok: true },
    { op: "remove", key: WRITE_CHECK_KEY, ok: true },
  ];

  it("no key: probe only", () => {
    const storage = ledgerStorage();
    loadSong(storage, FROZEN);
    expect(storage.ops).toEqual(CHECK_OPS);
  });

  it("valid legacy song: probe only", () => {
    const storage = ledgerStorage({ [SONG_KEY]: JSON.stringify(SAMPLE_SONG) });
    loadSong(storage, FROZEN);
    expect(storage.ops).toEqual(CHECK_OPS);
    expect(summarise(storage.ops)).toEqual({
      probe: 2,
      songSet: 0,
      songRemove: 0,
      corruptSet: 0,
    });
  });

  it("valid envelope current: probe only", () => {
    const storage = ledgerStorage({ [SONG_KEY]: wrap(SAMPLE_SONG, null) });
    loadSong(storage, FROZEN);
    expect(storage.ops).toEqual(CHECK_OPS);
  });

  it("future version: probe only, and the file untouched", () => {
    const raw = JSON.stringify({
      format: SONG_ENVELOPE_FORMAT,
      version: 2,
      chunks: [],
    });
    const storage = ledgerStorage({ [SONG_KEY]: raw });
    loadSong(storage, FROZEN);
    expect(storage.ops).toEqual(CHECK_OPS);
    expect(storage.map.get(SONG_KEY)).toBe(raw);
  });

  it("malformed JSON: quarantine set, then main key removed — in that order", () => {
    const storage = ledgerStorage({ [SONG_KEY]: "{not json" });
    loadSong(storage, FROZEN);

    expect(storage.ops).toEqual([
      ...CHECK_OPS,
      { op: "set", key: `${CORRUPT_KEY_PREFIX}1700000000000`, ok: true },
      { op: "remove", key: SONG_KEY, ok: true },
    ]);
    expect(summarise(storage.ops)).toEqual({
      probe: 2,
      songSet: 0,
      songRemove: 1,
      corruptSet: 1,
    });
  });

  it("current broken, previous good: quarantine set, then repair set — no remove", () => {
    const storage = ledgerStorage({
      [SONG_KEY]: wrap({ half: "written" }, titled(base(), "Önce"), 6),
    });
    loadSong(storage, FROZEN);

    expect(storage.ops).toEqual([
      ...CHECK_OPS,
      { op: "set", key: `${CORRUPT_KEY_PREFIX}1700000000000`, ok: true },
      { op: "set", key: SONG_KEY, ok: true },
    ]);
    expect(summarise(storage.ops)).toEqual({
      probe: 2,
      songSet: 1,
      songRemove: 0,
      corruptSet: 1,
    });
  });

  it("both slots broken: quarantine set, then main key removed", () => {
    const storage = ledgerStorage({ [SONG_KEY]: wrap({ a: 1 }, { b: 2 }) });
    loadSong(storage, FROZEN);
    expect(storage.ops).toEqual([
      ...CHECK_OPS,
      { op: "set", key: `${CORRUPT_KEY_PREFIX}1700000000000`, ok: true },
      { op: "remove", key: SONG_KEY, ok: true },
    ]);
  });

  it("normal commit, undo and redo: one song set each, nothing else", () => {
    const storage = ledgerStorage();
    const source = base();
    const store = createSongStore(loadSong(storage, FROZEN), storage);
    storage.ops.length = 0;

    store.commit(titled(source, "B"), NOTE);
    store.commit(titled(source, "C"), NOTE);
    store.undo();
    store.redo();

    expect(storage.ops).toEqual([
      { op: "set", key: SONG_KEY, ok: true },
      { op: "set", key: SONG_KEY, ok: true },
      { op: "set", key: SONG_KEY, ok: true },
      { op: "set", key: SONG_KEY, ok: true },
    ]);
  });
});

// -------------------------------------------------------- aimed failures

describe("23. a rescue never trades the data for its own success", () => {
  const brokenEnvelope = () => wrap({ half: "written" }, titled(base(), "Önce"), 6);

  it("keeps the main value byte-identical when the quarantine write fails", () => {
    const raw = "{not json";
    const storage = ledgerStorage({ [SONG_KEY]: raw });
    // The probe key still works; only the quarantine key is refused — a big
    // value hitting quota that a one-byte probe slid under.
    storage.failKeys = (key) => key.startsWith(CORRUPT_KEY_PREFIX);
    const result = loadSong(storage, FROZEN);

    expect(storage.map.get(SONG_KEY)).toBe(raw);
    expect(result.canPersist).toBe(false);
    expect(result.recovery).toBe("storage_write_failed");
    // The failed attempt is on the ledger.
    expect(storage.ops.some((entry) => entry.op === "set" && !entry.ok)).toBe(true);
    // And nothing ever removed the main key.
    expect(
      storage.ops.filter((entry) => entry.op === "remove" && entry.key === SONG_KEY),
    ).toEqual([]);
  });

  it("keeps the old envelope in place when the repair write fails", () => {
    const raw = brokenEnvelope();
    const storage = ledgerStorage({ [SONG_KEY]: raw });
    storage.failKeys = (key) => key === SONG_KEY;
    const result = loadSong(storage, FROZEN);

    // The reader still gets the recovered song to look at…
    expect(result.song.title).toBe("Önce");
    // …but the rescue is not reported as persisted, and editing closes.
    expect(result.recovery).toBe("storage_write_failed");
    expect(result.canPersist).toBe(false);
    // The old envelope is byte-identical — its previous slot is still the
    // only durable copy of this song, and nothing half-replaced it.
    expect(storage.map.get(SONG_KEY)).toBe(raw);
    // The quarantine copy that did land is kept; an extra copy never hurts.
    expect(
      [...storage.map.keys()].filter((key) => key.startsWith(CORRUPT_KEY_PREFIX))
        .length,
    ).toBe(1);
  });

  it("a repair failure closes editing at the store too", () => {
    const raw = brokenEnvelope();
    const storage = ledgerStorage({ [SONG_KEY]: raw });
    storage.failKeys = (key) => key === SONG_KEY;
    const store = createSongStore(loadSong(storage, FROZEN), storage);

    const shown = store.getSnapshot().song;
    expect(store.commit(titled(shown, "Değişti"), NOTE)).toBe(false);
    expect(store.getSnapshot().song).toBe(shown);
    expect(store.getSnapshot().canUndo).toBe(false);
    expect(storage.map.get(SONG_KEY)).toBe(raw);
  });

  it("recovery is still not a history step", () => {
    const storage = ledgerStorage({ [SONG_KEY]: brokenEnvelope() });
    const store = createSongStore(loadSong(storage, FROZEN), storage);
    expect(store.getSnapshot().canUndo).toBe(false);
    expect(store.getSnapshot().canRedo).toBe(false);
  });

  it("refuses to write over a corrupt value that could not be preserved", () => {
    /*
     * The one way a corrupt raw survives to commit time is a failed
     * quarantine. `saveSong` must refuse rather than overwrite the only copy
     * — the gate already prevents this path, and this is the belt to it.
     */
    const raw = "{not json";
    const storage = ledgerStorage({ [SONG_KEY]: raw });
    storage.failKeys = (key) => key.startsWith(CORRUPT_KEY_PREFIX);
    const store = createSongStore(loadSong(storage, FROZEN), storage);

    expect(store.commit(titled(base(), "Yeni"), NOTE)).toBe(false);
    expect(storage.map.get(SONG_KEY)).toBe(raw);

    // And the refusal lives in `saveSong` itself, not only in the gate above:
    // a caller that reached it directly is still turned away.
    const direct = saveSong(titled(base(), "Yeni"), storage);
    expect(direct.ok).toBe(false);
    expect(storage.map.get(SONG_KEY)).toBe(raw);
  });
});

describe("24. the gate decision is deterministic", () => {
  it("gives the same answer five times over on the same failing storage", () => {
    const runs = Array.from({ length: 5 }, () => {
      const storage = ledgerStorage({ [SONG_KEY]: "{not json" });
      storage.failKeys = (key) => key.startsWith(CORRUPT_KEY_PREFIX);
      const result = loadSong(storage, FROZEN);
      return JSON.stringify({
        recovery: result.recovery,
        canPersist: result.canPersist,
        ops: storage.ops,
        file: storage.map.get(SONG_KEY),
      });
    });
    expect(new Set(runs).size).toBe(1);
  });
});

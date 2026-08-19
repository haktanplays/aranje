import { describe, expect, it } from "vitest";

import { SAMPLE_SONG } from "@/lib/song/sample-song";
import {
  CORRUPT_KEY_PREFIX,
  SONG_KEY,
  STORAGE_PREFIX,
  loadSong,
  saveSong,
  type StorageLike,
} from "@/lib/song/storage";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: StorageLike = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
  return { storage, map };
}

const FROZEN_CLOCK = () => 1_700_000_000_000;

describe("song storage (spec 5.6)", () => {
  it("uses the ASCII key prefix", () => {
    expect(STORAGE_PREFIX).toBe("aranje.");
    expect(SONG_KEY).toBe("aranje.song");
    expect(CORRUPT_KEY_PREFIX).toBe("aranje.corrupt.");
  });

  it("falls back to the sample song when nothing is stored", () => {
    const { storage } = fakeStorage();
    const result = loadSong(storage, FROZEN_CLOCK);
    expect(result.outcome).toBe("empty");
    expect(result.song.title).toBe(SAMPLE_SONG.title);
  });

  it("reads back a song it wrote", () => {
    const { storage } = fakeStorage();
    expect(saveSong(SAMPLE_SONG, storage)).toBe(true);
    const result = loadSong(storage, FROZEN_CLOCK);
    expect(result.outcome).toBe("stored");
    expect(result.song).toEqual(SAMPLE_SONG);
  });

  it("survives malformed JSON and keeps the broken value", () => {
    const { storage, map } = fakeStorage({ [SONG_KEY]: "{not json" });
    const result = loadSong(storage, FROZEN_CLOCK);

    expect(result.outcome).toBe("recovered");
    expect(result.song.title).toBe(SAMPLE_SONG.title);
    expect(result.message).toBeTruthy();
    expect(result.backupKey).toBe(`${CORRUPT_KEY_PREFIX}1700000000000`);
    expect(map.get(result.backupKey ?? "")).toBe("{not json");
    expect(map.has(SONG_KEY)).toBe(false);
  });

  it("survives valid JSON that fails the schema", () => {
    const broken = JSON.stringify({ version: 2, title: "x" });
    const { storage, map } = fakeStorage({ [SONG_KEY]: broken });
    const result = loadSong(storage, FROZEN_CLOCK);

    expect(result.outcome).toBe("recovered");
    expect(result.song.title).toBe(SAMPLE_SONG.title);
    expect(map.get(result.backupKey ?? "")).toBe(broken);
    expect(map.has(SONG_KEY)).toBe(false);
  });

  it("keeps working when storage is missing entirely", () => {
    const result = loadSong(null, FROZEN_CLOCK);
    expect(result.outcome).toBe("unavailable");
    expect(result.song.title).toBe(SAMPLE_SONG.title);
    expect(saveSong(SAMPLE_SONG, null)).toBe(false);
  });

  it("keeps working when storage throws on read", () => {
    const storage: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
      removeItem: () => {},
    };
    const result = loadSong(storage, FROZEN_CLOCK);
    expect(result.outcome).toBe("unavailable");
    expect(result.song.title).toBe(SAMPLE_SONG.title);
  });

  it("reports a refused write instead of throwing", () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    };
    expect(saveSong(SAMPLE_SONG, storage)).toBe(false);
  });

  it("refuses to persist a song that fails the schema", () => {
    const { storage, map } = fakeStorage();
    const invalid = { ...SAMPLE_SONG, bpm: 9000 };
    expect(saveSong(invalid, storage)).toBe(false);
    expect(map.has(SONG_KEY)).toBe(false);
  });
});

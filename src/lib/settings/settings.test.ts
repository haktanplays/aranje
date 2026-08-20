/**
 * Screen settings are stored apart from the song (spec 5.6, 13.8).
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loadSettings,
  saveSettings,
} from "@/lib/settings/settings";
import { CORRUPT_KEY_PREFIX, SONG_KEY, type StorageLike } from "@/lib/song/storage";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: StorageLike & { map: Map<string, string> } = {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
  return storage;
}

describe("reading", () => {
  it("starts at the song's own tempo when nothing is stored", () => {
    expect(loadSettings(memoryStorage())).toEqual(DEFAULT_SETTINGS);
  });

  it("reads a stored preference back after a reload", () => {
    const storage = memoryStorage();
    saveSettings({ practiceRatePercent: 75 }, storage);
    expect(loadSettings(storage)).toEqual({ practiceRatePercent: 75 });
  });

  it("falls back to the song's own tempo on unreadable text", () => {
    expect(loadSettings(memoryStorage({ [SETTINGS_KEY]: "{" }))).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it("falls back on a value outside the bounds or off the step", () => {
    for (const percent of [10, 1000, 97, -5]) {
      const storage = memoryStorage({
        [SETTINGS_KEY]: JSON.stringify({ practiceRatePercent: percent }),
      });
      expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("falls back on a shape this version does not understand", () => {
    const storage = memoryStorage({
      [SETTINGS_KEY]: JSON.stringify({ practiceRatePercent: 75, tempoLock: true }),
    });
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
  });

  it("works when storage itself is unavailable", () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings({ practiceRatePercent: 75 }, null)).toBe(false);
  });
});

describe("the song's recovery is a different responsibility", () => {
  it("never quarantines anything when the settings are broken", () => {
    const storage = memoryStorage({
      [SETTINGS_KEY]: "not json at all",
      [SONG_KEY]: '{"kept":true}',
    });

    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
    expect(storage.map.get(SONG_KEY)).toBe('{"kept":true}');
    expect(
      [...storage.map.keys()].some((key) => key.startsWith(CORRUPT_KEY_PREFIX)),
    ).toBe(false);
  });

  it("writes under its own key and leaves the song's alone", () => {
    const storage = memoryStorage({ [SONG_KEY]: '{"kept":true}' });
    saveSettings({ practiceRatePercent: 60 }, storage);

    expect(storage.map.get(SONG_KEY)).toBe('{"kept":true}');
    expect(JSON.parse(storage.map.get(SETTINGS_KEY) ?? "{}")).toEqual({
      practiceRatePercent: 60,
    });
  });
});

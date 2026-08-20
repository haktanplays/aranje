"use client";

import { useCallback, useSyncExternalStore } from "react";

import { clampPercent } from "@/lib/audio/practice-rate";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type Settings,
} from "@/lib/settings/settings";
import type { StorageLike } from "@/lib/song/storage";

/*
 * The settings live outside React for the same reason the song does: they are
 * in localStorage, which is an external store. Keeping them here rather than in
 * the song store is the point — a bad setting must never look like a bad song.
 */

export type SettingsStore = {
  getSnapshot(): Settings;
  subscribe(listener: () => void): () => void;
  setPracticeRatePercent(percent: number): void;
};

export function createSettingsStore(
  initial: Settings,
  storage?: StorageLike | null,
): SettingsStore {
  let snapshot = initial;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setPracticeRatePercent(percent) {
      const next: Settings = {
        ...snapshot,
        practiceRatePercent: clampPercent(percent),
      };
      if (next.practiceRatePercent === snapshot.practiceRatePercent) return;
      snapshot = next;
      // A refused write is not worth an interruption: the session keeps the
      // speed it was given, and next time the app opens at the default.
      if (storage === undefined) saveSettings(next);
      else saveSettings(next, storage);
      for (const listener of listeners) listener();
    },
  };
}

let browserStore: SettingsStore | null = null;

export function getSettingsStore(): SettingsStore {
  browserStore ??= createSettingsStore(loadSettings());
  return browserStore;
}

export type SettingsHandle = Settings & {
  setPracticeRatePercent(percent: number): void;
};

export function useSettings(): SettingsHandle {
  const store = typeof window === "undefined" ? null : getSettingsStore();

  const snapshot = useSyncExternalStore(
    store ? store.subscribe : () => () => {},
    store ? store.getSnapshot : () => DEFAULT_SETTINGS,
    () => DEFAULT_SETTINGS,
  );

  const setPracticeRatePercent = useCallback(
    (percent: number) => store?.setPracticeRatePercent(percent),
    [store],
  );

  return { ...snapshot, setPracticeRatePercent };
}

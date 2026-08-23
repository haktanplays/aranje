"use client";

import { useCallback, useSyncExternalStore } from "react";

import { getProjectSession } from "@/lib/projects/project-session";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { type SongStoreSnapshot } from "@/lib/song/song-store";
import type { HistoryAction } from "@/lib/song/edit-history";
import type { Song } from "@/lib/song/schema";

/*
 * localStorage is an external store, so it is read through useSyncExternalStore
 * rather than an effect. Since phase 2C the song can also be written, so the
 * store publishes to subscribers and the snapshot is whatever it last set.
 *
 * Undo and redo are the store's too (spec 13.13). They are not component
 * state: the same history has to be the one behind the tab, the arrangement
 * and every sheet, and a hook that kept its own copy would give each surface a
 * different past.
 */

/* Prerender and hydration show the sample song; the stored song replaces it as
   soon as the client can reach storage. */
const SERVER_SNAPSHOT: SongStoreSnapshot = {
  song: SAMPLE_SONG,
  canUndo: false,
  canRedo: false,
  undoLabel: "Geri al",
  redoLabel: "Yinele",
  undoDepth: 0,
  redoDepth: 0,
  persisted: true,
  recovery: null,
  recoveryMessage: null,
  canPersist: true,
};

export type SongHandle = SongStoreSnapshot & {
  /** The one way to change the song. Says what the edit was. */
  commit(next: Song, action: HistoryAction): boolean;
  undo(): void;
  redo(): void;
  dismissRecovery(): void;
};

export function useSong(): SongHandle {
  /*
   * One store, and the project session owns it (2O-A §8). The song the engine
   * reads and the song on screen have to be the same object, and since the
   * song now has a project behind it, "which store" and "which project" are
   * one question with one owner.
   */
  const store = typeof window === "undefined" ? null : getProjectSession().store;

  const snapshot = useSyncExternalStore(
    store ? store.subscribe : () => () => {},
    store ? store.getSnapshot : () => SERVER_SNAPSHOT,
    () => SERVER_SNAPSHOT,
  );

  const commit = useCallback(
    (next: Song, action: HistoryAction) => store?.commit(next, action) ?? false,
    [store],
  );

  const undo = useCallback(() => {
    store?.undo();
  }, [store]);

  const redo = useCallback(() => {
    store?.redo();
  }, [store]);

  const dismissRecovery = useCallback(() => {
    store?.dismissRecovery();
  }, [store]);

  return { ...snapshot, commit, undo, redo, dismissRecovery };
}

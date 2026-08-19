"use client";

import { useCallback, useSyncExternalStore } from "react";

import { SAMPLE_SONG } from "@/lib/song/sample-song";
import {
  getSongStore,
  type SongStoreSnapshot,
} from "@/lib/song/song-store";
import type { Song } from "@/lib/song/schema";

/*
 * localStorage is an external store, so it is read through useSyncExternalStore
 * rather than an effect. Since phase 2C the song can also be written, so the
 * store publishes to subscribers and the snapshot is whatever it last set.
 */

/* Prerender and hydration show the sample song; the stored song replaces it as
   soon as the client can reach storage. */
const SERVER_SNAPSHOT: SongStoreSnapshot = {
  song: SAMPLE_SONG,
  canUndo: false,
  persisted: true,
};

export type SongHandle = SongStoreSnapshot & {
  commit(next: Song): void;
  undo(): void;
};

export function useSong(): SongHandle {
  const store = typeof window === "undefined" ? null : getSongStore();

  const snapshot = useSyncExternalStore(
    store ? store.subscribe : () => () => {},
    store ? store.getSnapshot : () => SERVER_SNAPSHOT,
    () => SERVER_SNAPSHOT,
  );

  const commit = useCallback(
    (next: Song) => {
      store?.commit(next);
    },
    [store],
  );

  const undo = useCallback(() => {
    store?.undo();
  }, [store]);

  return { ...snapshot, commit, undo };
}

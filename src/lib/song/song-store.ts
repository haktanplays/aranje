/**
 * The one song the app is holding, and the only way to change it.
 *
 * An external store rather than React state, for the same reason the loader
 * already was one: localStorage is outside React, and the song has to be
 * readable by things that are not components (the audio engine, the debug
 * handle) without threading a setter through them.
 *
 * Two rules this file exists to keep:
 *
 * - **A write is atomic.** The new song goes to storage and to the subscribers
 *   together, through the same `saveSong` path that already validates before
 *   writing (spec 5.6). A refused write leaves the store where it was.
 * - **Undo is session-only.** Spec 5.6 persists the song, not the history. A
 *   history written to storage would outlive the tab and be replayed against a
 *   song it no longer describes.
 */
import {
  canUndo as historyCanUndo,
  createHistory,
  record,
  undo as historyUndo,
  type History,
} from "@/lib/song/edit-history";
import type { Song } from "@/lib/song/schema";
import { loadSong, saveSong, type LoadResult, type StorageLike } from "@/lib/song/storage";

export type SongStoreSnapshot = {
  song: Song;
  /** Set when the load had something to tell the reader (spec 5.6). */
  message?: string;
  canUndo: boolean;
  /** False when a write was refused, so the screen can say so. */
  persisted: boolean;
};

export type SongStore = {
  getSnapshot(): SongStoreSnapshot;
  subscribe(listener: () => void): () => void;
  /** Replace the song and remember the one being left. */
  commit(next: Song): void;
  /** Step back to the song before the last commit. */
  undo(): void;
  /** Forget the history without touching the song. */
  forgetHistory(): void;
};

export function createSongStore(
  initial: LoadResult,
  storage?: StorageLike | null,
): SongStore {
  let history: History<Song> = createHistory(initial.song);
  let persisted = true;
  const listeners = new Set<() => void>();

  let snapshot: SongStoreSnapshot = {
    song: history.present,
    ...(initial.message === undefined ? {} : { message: initial.message }),
    canUndo: false,
    persisted: true,
  };

  const publish = () => {
    snapshot = {
      song: history.present,
      ...(initial.message === undefined ? {} : { message: initial.message }),
      canUndo: historyCanUndo(history),
      persisted,
    };
    for (const listener of listeners) listener();
  };

  const write = (next: History<Song>) => {
    // Storage first: if it refuses, the screen keeps working in memory and
    // says so, rather than showing a state that was never saved.
    persisted =
      storage === undefined ? saveSong(next.present) : saveSong(next.present, storage);
    history = next;
    publish();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    commit(next) {
      if (next === history.present) return;
      write(record(history, next));
    },
    undo() {
      if (!historyCanUndo(history)) return;
      write(historyUndo(history));
    },
    forgetHistory() {
      history = createHistory(history.present);
      publish();
    },
  };
}

let browserStore: SongStore | null = null;

/** The store the screen uses. Created once, on the client. */
export function getSongStore(): SongStore {
  browserStore ??= createSongStore(loadSong());
  return browserStore;
}

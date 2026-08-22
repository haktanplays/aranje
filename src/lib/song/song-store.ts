/**
 * The one song the app is holding, and the only way to change it.
 *
 * An external store rather than React state, for the same reason the loader
 * already was one: localStorage is outside React, and the song has to be
 * readable by things that are not components (the audio engine, the debug
 * handle) without threading a setter through them.
 *
 * ## One gate (spec 13.13, K-44)
 *
 * Every path that can change the song — a riff edit, a group move, a
 * selection transform, a bar operation, an applied Copilot suggestion — comes
 * through `commit`. That is what makes "one edit, one write, one undo step" a
 * property of the app rather than of five separate call sites that currently
 * happen to agree. A second path would look right on screen and quietly
 * produce two writes, or a history step with nothing behind it.
 *
 * Every commit says what it *was*, so the history can tell the reader what
 * undo is about to reverse. The action is a shape, never a diagnostic.
 *
 * ## What a commit refuses
 *
 * - A candidate the schema will not accept. It never reaches history and
 *   never reaches storage, because a history holding an invalid song is a
 *   history whose undo produces a song the app cannot load.
 * - A candidate that is the same music. Not the same *object* — the same
 *   music: an edit that rebuilt a bar and changed nothing is a step the
 *   reader would find does nothing when they undo it.
 *
 * ## Session only
 *
 * Spec 5.6 persists the song, not the history. A history written to storage
 * would outlive the tab and be replayed against a song it no longer describes.
 * It also never reaches the fingerprint, a Copilot request, or a project file.
 */
import {
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  createEditHistory,
  currentSong,
  recordEdit,
  redo as historyRedo,
  redoAction,
  resetEditHistory,
  sameSong,
  undo as historyUndo,
  undoAction,
  type EditHistory,
  type HistoryAction,
} from "@/lib/song/edit-history";
import { redoLabel, undoLabel } from "@/lib/song/history-labels";
import { songSchema, type Song } from "@/lib/song/schema";
import {
  loadSong,
  saveSong,
  RECOVERY_MESSAGES,
  type LoadResult,
  type RecoveryState,
  type StorageLike,
} from "@/lib/song/storage";

export type SongStoreSnapshot = {
  song: Song;
  /** Set when the load had something to tell the reader (spec 5.6). */
  message?: string;
  canUndo: boolean;
  canRedo: boolean;
  /** "Geri al: Ölçüleri silme" — the accessible name of the undo control. */
  undoLabel: string;
  redoLabel: string;
  /** How many steps lie behind and ahead. Measured, not guessed. */
  undoDepth: number;
  redoDepth: number;
  /** False when a write was refused, so the screen can say so. */
  persisted: boolean;
  /**
   * What the recovery banner should say, if anything (spec 13.14).
   *
   * A closed set rather than free text: whatever went wrong, the reader gets
   * one of four sentences and never a diagnostic.
   */
  recovery: RecoveryState | null;
  /** The sentence for `recovery`, from the one table. */
  recoveryMessage: string | null;
  /**
   * False when this session must not write at all — a file from a newer
   * Aranje is in the way. Editing stays visible but cannot be committed,
   * because a commit would overwrite data this version cannot read.
   */
  canPersist: boolean;
};

export type SongStore = {
  getSnapshot(): SongStoreSnapshot;
  subscribe(listener: () => void): () => void;
  /**
   * Replace the song and remember what did it.
   *
   * Returns whether the song actually changed, so a caller can tell "refused"
   * from "that was already the song".
   */
  commit(next: Song, action: HistoryAction): boolean;
  /** Step back one edit. */
  undo(): void;
  /** Step forward one edit. */
  redo(): void;
  /** Put the recovery banner down. Changes nothing else, and writes nothing. */
  dismissRecovery(): void;
  /**
   * Start again from a song that did not come from an edit.
   *
   * Hydration, the sample-song fallback, and any later "open another project".
   * There is nothing behind these to go back to.
   */
  replaceBaseline(song: Song): void;
};

export function createSongStore(
  initial: LoadResult,
  storage?: StorageLike | null,
): SongStore {
  let history: EditHistory = createEditHistory(initial.song);
  let persisted = true;
  let canPersist = initial.canPersist;
  let recovery: RecoveryState | null = initial.recovery ?? null;
  const listeners = new Set<() => void>();

  const readSnapshot = (): SongStoreSnapshot => ({
    song: currentSong(history),
    ...(initial.message === undefined ? {} : { message: initial.message }),
    canUndo: historyCanUndo(history),
    canRedo: historyCanRedo(history),
    undoLabel: undoLabel(undoAction(history)),
    redoLabel: redoLabel(redoAction(history)),
    undoDepth: history.cursor,
    redoDepth: history.snapshots.length - 1 - history.cursor,
    persisted,
    recovery,
    recoveryMessage: recovery === null ? null : RECOVERY_MESSAGES[recovery],
    canPersist,
  });

  let snapshot: SongStoreSnapshot = readSnapshot();

  const publish = () => {
    snapshot = readSnapshot();
    for (const listener of listeners) listener();
  };

  /**
   * Move the history and write the song it now shows.
   *
   * Exactly one storage write and exactly one publish, whatever moved it —
   * a commit, an undo and a redo are the same event as far as the outside
   * world is concerned: the song changed to this one.
   *
   * ## Storage decides, and it decides first (spec 13.14, K-45)
   *
   * Nothing moves until the write has landed. A refused write used to leave
   * the app showing an edit that was never saved, with a note underneath
   * saying so — which is the app asking the reader to remember which of the
   * things on screen are real. Now the edit simply does not happen, the
   * banner says why, and what is on screen is what is on disk.
   *
   * The exception is storage that is not there at all — a private window, an
   * embedded view. `setItem` was never called and never failed; the session
   * runs in memory and said as much when it opened. Turning that into a
   * read-only app would take editing away from someone whose browser merely
   * declines to remember things.
   */
  const write = (next: EditHistory): boolean => {
    const song = currentSong(next);
    const saved = storage === undefined ? saveSong(song) : saveSong(song, storage);

    if (!saved.ok && saved.reason !== "unavailable") {
      /*
       * Nothing advances: not the song, not the cursor, not the redo branch.
       * The publish is only so the banner can appear — it carries no new song.
       */
      persisted = false;
      recovery =
        saved.reason === "unsupported_version"
          ? "unsupported_version"
          : "storage_write_failed";
      if (saved.reason === "unsupported_version") canPersist = false;
      publish();
      return false;
    }

    persisted = saved.ok;
    if (saved.ok && recovery === "storage_write_failed") recovery = null;
    history = next;
    publish();
    return true;
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    commit(next, action) {
      /*
       * The schema, before anything else. A song that cannot be parsed cannot
       * be stored, and one that cannot be stored has no business being a step
       * someone can come back to.
       */
      if (!songSchema.safeParse(next).success) return false;
      if (sameSong(next, currentSong(history))) return false;
      return write(recordEdit(history, next, action));
    },

    undo() {
      if (!historyCanUndo(history)) return;
      write(historyUndo(history));
    },

    redo() {
      if (!historyCanRedo(history)) return;
      write(historyRedo(history));
    },

    replaceBaseline(song) {
      history = resetEditHistory(song);
      publish();
    },

    dismissRecovery() {
      if (recovery === null) return;
      recovery = null;
      // The banner goes; the song, the history and storage are untouched.
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

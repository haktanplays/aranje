/**
 * Every edit the session has made, as one list and one cursor (spec 13.13).
 *
 * Session only. Spec 5.6 keeps the *song* in localStorage; a history is not
 * part of the song and is deliberately not persisted — a stack that outlived
 * the tab would be replayed against a song that has since changed, and the
 * reader would watch an undo produce music they never wrote. It never reaches
 * the fingerprint, a Copilot request or a project file either, for the same
 * reason: none of them is about what someone did on the way here.
 *
 * ## Why snapshots rather than inverse commands
 *
 * The alternative is to store each command and undo it by applying its
 * inverse. That needs an inverse for all eleven bar commands, all ten
 * selection commands, every riff edit and whatever the Copilot returns — and
 * an inverse is only correct if it is exactly right, so a single wrong one
 * loses music silently and much later. A snapshot cannot be wrong: the song
 * that comes back is the song that was there, byte for byte.
 *
 * The cost is memory, and it is bounded by `historyLimits.maxUndoSteps`.
 *
 * ## One list, one cursor
 *
 * `snapshots` runs oldest to newest and `cursor` says which one is the
 * present. Undo and redo move the cursor and nothing else; only a *commit*
 * changes the list. That is what makes the branch rule fall out rather than
 * be enforced: committing after an undo truncates at the cursor, so the
 * abandoned future is gone rather than hidden somewhere it could return from.
 *
 * `actionFromPrevious` belongs to the snapshot it produced, not to the one
 * before it — so "what would undo reverse?" is the current snapshot's own
 * action, and "what would redo do?" is the next one's.
 */
import { historyLimits } from "@/lib/limits";
import type { BarCommand } from "@/lib/song/bar-transform";
import type { Song } from "@/lib/song/schema";
import type { TransformCommand } from "@/lib/song/transform";
import type { ArrangeSkill } from "@/lib/copilot/contract";

export type SelectionCommandKind = TransformCommand["kind"];
export type BarCommandKind = BarCommand["kind"];

/**
 * What one step of the history was.
 *
 * Carried so undo and redo can say what they are about to do. Deliberately
 * only the *shape* of the edit — never a diagnostic, a provider message or
 * anything a reader did not ask to see.
 */
export type HistoryAction =
  | { readonly kind: "note_edit" }
  /** A group of onsets nudged in time or across strings (spec 13.1). */
  | { readonly kind: "group_move" }
  | { readonly kind: "selection_transform"; readonly command: SelectionCommandKind }
  | {
      readonly kind: "bar_transform";
      readonly command: BarCommandKind;
      readonly scope: "track" | "full";
    }
  | { readonly kind: "copilot_apply"; readonly skill: ArrangeSkill }
  /** A whole project file opened over the current song (spec 13.15). */
  | { readonly kind: "project_import" };

export type HistorySnapshot = {
  readonly song: Song;
  /** The edit that produced this song. `null` on the baseline. */
  readonly actionFromPrevious: HistoryAction | null;
};

export type EditHistory = {
  readonly snapshots: readonly HistorySnapshot[];
  /** Index of the present snapshot. Always a valid index. */
  readonly cursor: number;
};

export function createEditHistory(song: Song): EditHistory {
  return { snapshots: [{ song, actionFromPrevious: null }], cursor: 0 };
}

/** The song the history is currently showing. */
export function currentSong(history: EditHistory): Song {
  const snapshot = history.snapshots[history.cursor];
  // The cursor is maintained as a valid index; the fallback is for the type,
  // and falling back to the oldest snapshot is the safe direction anyway.
  return snapshot?.song ?? history.snapshots[0]!.song;
}

export function canUndo(history: EditHistory): boolean {
  return history.cursor > 0;
}

export function canRedo(history: EditHistory): boolean {
  return history.cursor < history.snapshots.length - 1;
}

/** What an undo would reverse, or `null` when there is nothing to reverse. */
export function undoAction(history: EditHistory): HistoryAction | null {
  if (!canUndo(history)) return null;
  return history.snapshots[history.cursor]?.actionFromPrevious ?? null;
}

/** What a redo would re-apply, or `null` when there is nothing ahead. */
export function redoAction(history: EditHistory): HistoryAction | null {
  if (!canRedo(history)) return null;
  return history.snapshots[history.cursor + 1]?.actionFromPrevious ?? null;
}

/**
 * Add a step.
 *
 * Everything after the cursor is dropped first. Someone who undid twice and
 * then edited has chosen a different future, and keeping the old one around
 * "in case" is how a redo button eventually produces music from a branch the
 * reader abandoned ten minutes ago.
 */
export function recordEdit(
  history: EditHistory,
  song: Song,
  action: HistoryAction,
  limit: number = historyLimits.maxUndoSteps,
): EditHistory {
  const kept = history.snapshots.slice(0, history.cursor + 1);
  const snapshots = [...kept, { song, actionFromPrevious: action }];

  /*
   * The limit counts *transitions*, so the list may hold one more than that:
   * the baseline is not something you can undo to, it is where undoing stops.
   */
  const maxSnapshots = Math.max(1, limit) + 1;
  const overflow = Math.max(0, snapshots.length - maxSnapshots);
  return {
    snapshots: overflow > 0 ? snapshots.slice(overflow) : snapshots,
    cursor: snapshots.length - 1 - overflow,
  };
}

/** Step back one edit. With nothing behind, nothing changes. */
export function undo(history: EditHistory): EditHistory {
  if (!canUndo(history)) return history;
  return { snapshots: history.snapshots, cursor: history.cursor - 1 };
}

/** Step forward one edit. With nothing ahead, nothing changes. */
export function redo(history: EditHistory): EditHistory {
  if (!canRedo(history)) return history;
  return { snapshots: history.snapshots, cursor: history.cursor + 1 };
}

/**
 * Start again from a song that did not come from an edit.
 *
 * Hydration, the sample-song fallback and any later "open another project"
 * are not steps — there is nothing behind them to go back to, and offering an
 * undo that reached a *previous song* would be offering to discard the file
 * someone just opened.
 */
export function resetEditHistory(song: Song): EditHistory {
  return createEditHistory(song);
}

/**
 * Are these the same music?
 *
 * Structural rather than `JSON.stringify`, because two songs can serialise
 * differently and mean the same thing: rebuilding a bar's `slots` with a
 * spread can leave the keys in another order. A commit that changed nothing
 * but key order would still add a history step, and the reader would find an
 * undo that visibly does nothing — which is worse than a missing one, because
 * it makes the whole stack untrustworthy.
 */
export function sameSong(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object" || typeof b !== "object") return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((entry, index) => sameSong(entry, b[index]));
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(right, key) &&
      sameSong(left[key], right[key]),
  );
}

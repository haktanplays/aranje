/**
 * One-step-at-a-time undo, as a pure reducer.
 *
 * Session only. Spec 5.6 keeps the song in localStorage; an undo stack is not
 * part of the song and is deliberately not persisted, so closing the tab ends
 * the history rather than leaving a stale one to be replayed against a song
 * that has since changed.
 *
 * The stack is bounded. An unbounded one would hold every intermediate song a
 * long editing session produced, which is a lot of memory for a phone to carry
 * for something nobody will scroll back through.
 */
export type History<T> = {
  /** Older states, oldest first. */
  past: readonly T[];
  present: T;
};

export const DEFAULT_HISTORY_LIMIT = 20;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present };
}

/** Move to a new state, remembering the one being left. */
export function record<T>(
  history: History<T>,
  next: T,
  limit: number = DEFAULT_HISTORY_LIMIT,
): History<T> {
  if (next === history.present) return history;
  const past = [...history.past, history.present];
  return {
    past: past.length > limit ? past.slice(past.length - limit) : past,
    present: next,
  };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

/** Step back one state. With nothing to step back to, nothing changes. */
export function undo<T>(history: History<T>): History<T> {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return { past: history.past.slice(0, -1), present: previous };
}

/** Forget the history, keeping the current state. Used when the song is replaced. */
export function reset<T>(present: T): History<T> {
  return createHistory(present);
}

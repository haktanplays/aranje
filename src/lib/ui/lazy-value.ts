/**
 * A value computed the first time somebody actually wants it (2R-A §IV).
 *
 * `useMemo` defers work until its dependencies change; it does not defer work
 * until the result is *read*. On a workspace where several surfaces are
 * derived from the same Song and only one of them is on screen, that
 * difference is the whole cost: a tap on a drum cell makes a new Song, and
 * every memo keyed on the Song recomputes — including the arrangement model
 * for a surface that is not mounted.
 *
 * Measured on the contract's ceiling, a single kit tap spent 22,4 ms
 * rebuilding the arrangement and 5,9 ms rebuilding the multi-track model
 * while the reader was looking at the tab (`EDIT-COST-BREAKDOWN.json`).
 *
 * So the memo holds a thunk instead of a value. The thunk's identity is
 * stable for as long as the inputs are, which is what child memos compare on;
 * the work happens at most once, and only if the branch that needs it is
 * actually rendered.
 *
 * This changes *when* a model is built, never *what* is built. The same
 * function is called with the same Song and returns the same model.
 */
export type Lazy<T> = () => T;

/**
 * Wrap a builder so it runs at most once.
 *
 * Meant to be handed to `useMemo`, whose dependency list decides when a fresh
 * thunk — and therefore a fresh computation — is allowed.
 */
export function lazily<T>(build: () => T): Lazy<T> {
  let built: { value: T } | null = null;
  return () => {
    built ??= { value: build() };
    return built.value;
  };
}

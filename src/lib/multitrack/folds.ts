/**
 * Which lanes are folded away, as arithmetic on sets (2Q-A §9, §15).
 *
 * The rule these three functions encode is small and easy to get subtly
 * wrong, and every way of getting it wrong looks the same on screen — a lane
 * that will not open, a fold that follows the reader into somebody else's
 * project, a brand new track that arrives already shut. So it lives here,
 * where it can be asked the question directly, rather than inside a hook
 * that needs a browser and a render to answer anything.
 *
 * Nothing here reads or writes storage. A fold is a fact about this sitting.
 */

/** What the reader has folded, and the project they folded it in. */
export type Folds = {
  readonly projectId: string | null;
  readonly ids: ReadonlySet<string>;
};

export const NO_FOLDS: Folds = { projectId: null, ids: new Set() };

/**
 * The folds that still mean something, given the song that is open now.
 *
 * Settled where it is read rather than written back by an effect (2N-A §3):
 * a stale fold is never true for even one render.
 *
 * - Folds made in another project do not travel: opening a different song
 *   shows every lane.
 * - A fold on a track that has been deleted is not a fold. Left in, it would
 *   come back to life on the next track that happened to be given the same
 *   id.
 * - A track that is not in the set is open, which is why a track somebody
 *   just created arrives open without anyone having to say so.
 */
export function settleFolds(
  stored: Folds,
  projectId: string | null,
  trackIds: readonly string[],
): ReadonlySet<string> {
  if (stored.projectId !== projectId) return new Set();
  const known = new Set(trackIds);
  return new Set([...stored.ids].filter((id) => known.has(id)));
}

/** Fold an open lane, or open a folded one. */
export function toggledFolds(
  settled: ReadonlySet<string>,
  projectId: string | null,
  trackId: string,
): Folds {
  const ids = new Set(settled);
  if (ids.has(trackId)) ids.delete(trackId);
  else ids.add(trackId);
  return { projectId, ids };
}

/**
 * Fold everything except one lane.
 *
 * The track named is left open even if it is not in the song, because the
 * caller is naming the lane being edited and an empty screen is a worse
 * answer than a stale one.
 */
export function othersFolded(
  trackIds: readonly string[],
  projectId: string | null,
  keptTrackId: string,
): Folds {
  return { projectId, ids: new Set(trackIds.filter((id) => id !== keptTrackId)) };
}

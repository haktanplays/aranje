"use client";

/**
 * Changing which track is being worked on (2I-A V1, 2Q-A §8, §14).
 *
 * Three owners have to agree when the reader picks a different instrument,
 * and the agreement is the same wherever the pick comes from — the track
 * sheet, the arrangement's track column, or a lane header in the multi-track
 * view. Composed here so the three doors cannot drift, and so the
 * composition root does not carry the composition.
 *
 * What has to happen, and why:
 *
 * - The note edit session **stops**. It is armed against one track's staff,
 *   and its cell coordinates mean something different on another.
 * - The time selection **clears**. A selection belongs to one track and one
 *   section, so it cannot survive a change of either — carried over, it would
 *   name slots on music the reader never selected.
 * - Then, and only then, the navigation's active track moves.
 */
import { useCallback } from "react";

export function useSelectTrack(options: {
  readonly stopEditing: () => void;
  readonly clearTimeSelection: () => void;
  readonly setTrack: (trackId: string) => void;
}): (trackId: string) => void {
  const { stopEditing, clearTimeSelection, setTrack } = options;
  return useCallback(
    (trackId: string) => {
      stopEditing();
      clearTimeSelection();
      setTrack(trackId);
    },
    [clearTimeSelection, setTrack, stopEditing],
  );
}

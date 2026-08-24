"use client";

/**
 * What the multi-track view remembers, and for how long (2Q-A §4, §9).
 *
 * One thing, and it is a fact about *this sitting* rather than about the
 * music: which lanes the reader has folded away. It does not reach the Song,
 * the storage envelope, the project catalogue, the project file, the
 * fingerprint or a Copilot request — a song is not different music because
 * somebody folded the bass while reading it.
 *
 * ## Why collapse exists at all
 *
 * Not because a brief mentioned it. Eight tracks is the contract's ceiling,
 * and eight open lanes are taller than a phone screen: reaching the last one
 * means scrolling past seven and coming back means scrolling past seven
 * again. Folding a lane keeps it in the list — name, instrument and a thin
 * rhythmic digest — and gives its notation's height back. The measurement
 * behind that is in `eval/multitrack/artifacts/SCALE.json`.
 *
 * ## Settled when read, not written back by an effect
 *
 * The rule the workspace already settled on for the viewed section (2N-A §3):
 * a stored value that has gone stale is resolved *where it is read*. An
 * effect that wrote it back would mean one render in which the view still
 * names a track that is gone, and everything downstream would have to
 * survive that render.
 *
 * So: a different project reads as nothing folded, and an id whose track has
 * been deleted is simply not in the answer. Both are true immediately, in
 * the same render, without a second pass.
 */
import { useCallback, useMemo, useState } from "react";

import { buildMultiTrackModel, type MultiTrackModel } from "@/lib/multitrack/model";
import type { Song } from "@/lib/song/schema";

/** What the reader has folded, and the ways to change it. */
export type MultiTrackSession = {
  /** Track ids folded away. Session-only, settled against the live song. */
  readonly collapsed: ReadonlySet<string>;
  isCollapsed(trackId: string): boolean;
  toggleCollapse(trackId: string): void;
  expandAll(): void;
  /** Fold everything except the track being edited. */
  collapseOthers(activeTrackId: string): void;
};

/** The folds, and the project they were made in. Stored together on purpose. */
type Folded = {
  readonly projectId: string | null;
  readonly ids: ReadonlySet<string>;
};

const NOTHING: Folded = { projectId: null, ids: new Set() };

/** Everything the multi-track surface needs: what to draw, and what is folded. */
export type MultiTrackView = {
  readonly model: MultiTrackModel;
  readonly session: MultiTrackSession;
};

export function useMultiTrackView(options: {
  readonly song: Song;
  readonly viewedSectionId: string;
  readonly activeTrackId: string;
  /** Changes when the reader opens a different project. */
  readonly projectId: string | null;
}): MultiTrackView {
  const { song, viewedSectionId, activeTrackId, projectId } = options;
  const [stored, setStored] = useState<Folded>(NOTHING);

  const trackIds = useMemo(() => song.tracks.map((track) => track.id), [song.tracks]);

  /*
   * The model is memoised on exactly what it reads. Rebuilding it every
   * render would rebuild eight timelines — the placement search included —
   * for a keystroke somewhere else on the screen.
   */
  const model = useMemo(
    () => buildMultiTrackModel(song, viewedSectionId, activeTrackId),
    [song, viewedSectionId, activeTrackId],
  );

  /*
   * The answer, settled: folds from another project do not count, and a fold
   * on a track that no longer exists is not a fold. A new track is not in the
   * set, so it opens — which is what a track somebody just made should do.
   */
  const collapsed = useMemo<ReadonlySet<string>>(() => {
    if (stored.projectId !== projectId) return new Set();
    const known = new Set(trackIds);
    return new Set([...stored.ids].filter((id) => known.has(id)));
  }, [projectId, stored, trackIds]);

  const toggleCollapse = useCallback(
    (trackId: string) => {
      const next = new Set(collapsed);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      setStored({ projectId, ids: next });
    },
    [collapsed, projectId],
  );

  const expandAll = useCallback(() => {
    setStored({ projectId, ids: new Set() });
  }, [projectId]);

  const collapseOthers = useCallback(
    (activeTrackId: string) => {
      setStored({
        projectId,
        ids: new Set(trackIds.filter((id) => id !== activeTrackId)),
      });
    },
    [projectId, trackIds],
  );

  const isCollapsed = useCallback(
    (trackId: string) => collapsed.has(trackId),
    [collapsed],
  );

  const session = useMemo<MultiTrackSession>(
    () => ({ collapsed, isCollapsed, toggleCollapse, expandAll, collapseOthers }),
    [collapsed, collapseOthers, expandAll, isCollapsed, toggleCollapse],
  );

  return { model, session };
}

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

import { lazily, type Lazy } from "@/lib/ui/lazy-value";

import {
  NO_FOLDS,
  othersFolded,
  settleFolds,
  toggledFolds,
  type Folds,
} from "@/lib/multitrack/folds";
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

/** Everything the multi-track surface needs: what to draw, and what is folded. */
export type MultiTrackView = {
  /** Built when the Çoklu surface asks for it, not on every commit (§IV). */
  readonly model: Lazy<MultiTrackModel>;
  readonly session: MultiTrackSession;
};

export function useMultiTrackView(options: {
  readonly song: Song;
  readonly activeTrackId: string;
  /** Changes when the reader opens a different project. */
  readonly projectId: string | null;
}): MultiTrackView {
  const { song, activeTrackId, projectId } = options;
  const [stored, setStored] = useState<Folds>(NO_FOLDS);

  const trackIds = useMemo(() => song.tracks.map((track) => track.id), [song.tracks]);

  /*
   * The model is memoised on exactly what it reads. Rebuilding it every
   * render would rebuild eight timelines — the placement search included —
   * for a keystroke somewhere else on the screen.
   *
   * The section being read is not in that list any more (2Q-C §4). It is the
   * scroll position of one whole-song surface, and rebuilding the surface
   * because the reader scrolled across a bar line is the thing this
   * checkpoint exists to stop.
   *
   * And since 2R-A the memo holds a thunk rather than the model: a commit
   * makes a new Song whatever surface is on screen, and rebuilding eight
   * timelines for a view nobody is looking at cost 5,9 ms of every kit tap on
   * the contract's ceiling (§IV).
   */
  const model = useMemo(
    () => lazily(() => buildMultiTrackModel(song, activeTrackId)),
    [song, activeTrackId],
  );

  /*
   * The answer, settled: folds from another project do not count, and a fold
   * on a track that no longer exists is not a fold. A new track is not in the
   * set, so it opens — which is what a track somebody just made should do.
   */
  const collapsed = useMemo<ReadonlySet<string>>(
    () => settleFolds(stored, projectId, trackIds),
    [projectId, stored, trackIds],
  );

  const toggleCollapse = useCallback(
    (trackId: string) => setStored(toggledFolds(collapsed, projectId, trackId)),
    [collapsed, projectId],
  );

  const expandAll = useCallback(() => {
    setStored({ projectId, ids: new Set() });
  }, [projectId]);

  const collapseOthers = useCallback(
    (activeTrackId: string) =>
      setStored(othersFolded(trackIds, projectId, activeTrackId)),
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

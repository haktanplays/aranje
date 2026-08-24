"use client";

/**
 * The staff the tab draws, and which song it is drawn from (2O-B).
 *
 * One derivation, one owner. The timeline is expensive enough to be worth
 * remembering and specific enough that two callers deriving it separately
 * would eventually derive it differently — so it is remembered here, once.
 *
 * The `previewSong` argument is what makes a ghost possible: a controller
 * holding an edit the reader has not committed hands it in, and the staff
 * draws that instead. The section runs are deliberately *not* built from it —
 * a bar count that flickered while a chord was being chosen would be the app
 * changing the subject.
 */
import { useMemo } from "react";

import { buildTrackTimeline, sectionRuns, type TrackTimeline } from "@/lib/tab/timeline";
import type { Song } from "@/lib/song/schema";

export function useTabTimeline(options: {
  song: Song;
  /** A song being previewed, or null for the real one. */
  previewSong: Song | null;
  trackId: string;
}): { timeline: TrackTimeline; runs: ReturnType<typeof sectionRuns> } {
  const { song, previewSong, trackId } = options;

  const timeline = useMemo(
    () => buildTrackTimeline(previewSong ?? song, trackId),
    [previewSong, song, trackId],
  );

  const runs = useMemo(() => sectionRuns(song), [song]);

  return { timeline, runs };
}

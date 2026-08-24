"use client";

/**
 * What the tab is currently showing (2O-B).
 *
 * A composition, not an owner. Three things belong together because they are
 * one answer to one question — *which song is on the staff right now* — and
 * keeping them apart in the composition root meant spelling that relationship
 * out three times:
 *
 * - the chord builder, which may be holding a song the reader has not
 *   committed yet;
 * - the timeline, drawn from that song when there is one and from the real
 *   one otherwise, so the ghost the reader sees is the edit itself rather
 *   than an impression of it;
 * - the section runs, which are about the real song either way — a bar count
 *   that flickered while a chord was being chosen would be the app changing
 *   the subject.
 *
 * Nothing here holds state of its own or makes a decision; it hands back what
 * its three parts said.
 */
import { useChordAudition } from "@/lib/workspace/use-chord-audition";
import { useTabTimeline } from "@/lib/workspace/use-tab-timeline";

import {
  useChordBuilder,
  type ChordBuilderHandle,
} from "@/lib/workspace/use-chord-builder";
import type { sectionRuns, TrackTimeline } from "@/lib/tab/timeline";
import type { HistoryAction } from "@/lib/song/edit-history";
import type { Song, Track } from "@/lib/song/schema";

export type TabView = {
  readonly chords: ChordBuilderHandle;
  readonly timeline: TrackTimeline;
  readonly runs: ReturnType<typeof sectionRuns>;
  /** Play one shape briefly, through the preview path that already exists. */
  audition(voicingId: string): void;
};

export function useTabView(options: {
  song: Song;
  track: Track | undefined;
  canPersist: boolean;
  commit(next: Song, action: HistoryAction): boolean;
  pause(): void;
}): TabView {
  const { song, track, canPersist, commit, pause } = options;

  const chords = useChordBuilder({ song, track, canPersist, commit, pause });

  const { timeline, runs } = useTabTimeline({
    song,
    previewSong: chords.preview,
    trackId: track?.id ?? "",
  });

  const audition = useChordAudition({
    song,
    track,
    open: chords.isOpen,
    voicings: chords.voicings,
    velocity: chords.velocity,
    articulation: chords.articulation,
    pause,
  });

  return { chords, timeline, runs, audition };
}

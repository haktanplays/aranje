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
 * 2V-B.4 §7 added a fourth part on the same ground: the shelf's staged
 * proposal. It belongs here for the same reason the chord builder's preview
 * does — it is another answer to "which song is on the staff right now" — and
 * putting it here is what lets the staff draw the proposal and the amber mark
 * it, from one value, without the composition root holding either.
 *
 * Nothing here holds state of its own or makes a decision; it hands back what
 * its parts said.
 */
import { useAudition, type Audition } from "@/lib/workspace/use-audition";
import { useEditIntent, type EditIntent } from "@/lib/workspace/use-edit-intent";
import { useTabTimeline } from "@/lib/workspace/use-tab-timeline";
import { draftGhosts, type PenGhost } from "@/lib/tab/pen-ghost";

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
  audition: Audition;
  /** The shelf's staged proposal: propose it, hear it, keep it (§7). */
  readonly intent: EditIntent;
  /** The slots that proposal would change, for the staff to draw amber. */
  readonly ghosts: readonly PenGhost[];
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

  const audition = useAudition({
    song,
    track,
    open: chords.isOpen,
    voicings: chords.voicings,
    velocity: chords.velocity,
    articulation: chords.articulation,
    pause,
  });

  const intent = useEditIntent({ commit, previewSong: audition.song });

  const { timeline, runs } = useTabTimeline({
    song,
    /* Two previews, never at once: the chord builder is a full-screen state,
       and the shelf's proposal only exists while the reader is in the shelf. */
    previewSong: intent.draft?.song ?? chords.preview,
    trackId: track?.id ?? "",
  });

  const ghosts = draftGhosts({
    preview: intent.draft?.song ?? null,
    current: song,
    trackId: track?.id ?? "",
    sectionId: intent.draft?.ghost.sectionId ?? "",
  });

  return { chords, timeline, runs, audition, intent, ghosts };
}

"use client";

/**
 * The one lifecycle controller (spec 13.17, 2L-B §2).
 *
 * Every song, section and track command from every sheet passes through
 * here, and only here: the sheets hand a typed command in and get a typed
 * outcome back — they never see `commit`, storage, the history cursor or a
 * validator. The pure cores decide what the song becomes; this hook decides
 * what the *session* does about it, in a fixed order:
 *
 *   1. the core refuses → `rejected`, with the sentence from the one table;
 *   2. the result is the same song → `noop`, and nothing is disturbed —
 *      no pause, no cleared selection, no write, no history step;
 *   3. writing is closed → `blocked`, before any ground is touched;
 *   4. otherwise the ground callback runs, the one commit happens, and the
 *      command's own after-step normalises the active section or track.
 *
 * The ground callbacks are injected from the composition root because they
 * belong to other owners (playback, selections, clipboards, navigation) —
 * this hook never imports another controller, it is handed exactly the two
 * moves it may ask for. Loop and playhead need nothing from us: the engine
 * re-derives both from the committed song, on the same path undo and redo
 * already use (spec 2L-B §12).
 */
import { useCallback } from "react";

import { sameSong, type HistoryAction } from "@/lib/song/edit-history";
import {
  LIFECYCLE_BLOCKED_MESSAGE,
  LIFECYCLE_MESSAGES,
} from "@/lib/song/lifecycle-messages";
import { survivorIndex } from "@/lib/song/lifecycle-guard";
import {
  applySongCommand,
  type SongLifecycleCommand,
} from "@/lib/song/song-lifecycle";
import {
  applySectionCommand,
  type SectionCommand,
} from "@/lib/song/section-lifecycle";
import {
  applyTrackCommand,
  type TrackCommand,
} from "@/lib/song/track-lifecycle";
import type {
  LifecycleCommandKind,
  LifecycleResult,
} from "@/lib/song/lifecycle-types";
import type { Song } from "@/lib/song/schema";
import type { ValidationIssue } from "@/lib/validators";

export type LifecycleOutcome =
  | { readonly status: "applied"; readonly warnings: readonly ValidationIssue[] }
  /** The command would change nothing; nothing was touched or written. */
  | { readonly status: "noop" }
  | { readonly status: "rejected"; readonly message: string }
  /** Writing is closed (`canPersist` false); nothing was touched. */
  | { readonly status: "blocked"; readonly message: string };

export type LifecycleHandle = {
  /** False while writing is closed. Sheets disable their apply controls. */
  readonly canApply: boolean;
  runSong(command: SongLifecycleCommand): LifecycleOutcome;
  runSection(command: SectionCommand): LifecycleOutcome;
  runTrack(command: TrackCommand): LifecycleOutcome;
};

/** Commands that change the shape under selections and the transport. */
const STRUCTURAL_SECTION: ReadonlySet<SectionCommand["kind"]> = new Set([
  "create_section",
  "duplicate_section",
  "move_section",
  "delete_section",
]);

const STRUCTURAL_TRACK: ReadonlySet<TrackCommand["kind"]> = new Set([
  "create_track",
  "duplicate_track",
  "move_track",
  "delete_track",
  "update_track_setup",
  "replace_track_setup_and_clear_content",
]);

export function useLifecycle(options: {
  song: Song;
  canPersist: boolean;
  commit(next: Song, action: HistoryAction): boolean;
  /** The structural ground: pause, selections, ghosts, clipboards, focus. */
  onBeforeStructural(): void;
  /** What the navigation currently points at, for the survivor rules. */
  activeSectionId: string | null;
  selectedTrackId: string | null;
  /** The two normalisation moves this hook may ask the root for. */
  setActiveSection(sectionId: string): void;
  selectTrack(trackId: string): void;
}): LifecycleHandle {
  const {
    song,
    canPersist,
    commit,
    onBeforeStructural,
    activeSectionId,
    selectedTrackId,
    setActiveSection,
    selectTrack,
  } = options;

  /**
   * The shared tail of every command: refuse, no-op, block, or ground —
   * commit — normalise, in that order and no other.
   */
  const finish = useCallback(
    (
      result: LifecycleResult,
      command: LifecycleCommandKind,
      ground: (() => void) | null,
      after?: (next: Song) => void,
    ): LifecycleOutcome => {
      if (!result.ok) {
        return {
          status: "rejected",
          message: LIFECYCLE_MESSAGES[result.error.code],
        };
      }
      if (sameSong(result.song, song)) return { status: "noop" };
      if (!canPersist) {
        return { status: "blocked", message: LIFECYCLE_BLOCKED_MESSAGE };
      }
      ground?.();
      if (!commit(result.song, { kind: "lifecycle", command })) {
        return { status: "noop" };
      }
      after?.(result.song);
      return { status: "applied", warnings: result.warnings };
    },
    [canPersist, commit, song],
  );

  /*
   * No song command grounds the session any more (2O-A §18). "New song" used
   * to replace the open one and needed everything put down first; it now makes
   * a project of its own and the library owns that ground. What is left here —
   * renaming, key, tempo — changes three fields and disturbs nothing.
   */
  const runSong = useCallback(
    (command: SongLifecycleCommand): LifecycleOutcome =>
      finish(applySongCommand(song, command), command.kind, null),
    [finish, song],
  );

  const runSection = useCallback(
    (command: SectionCommand): LifecycleOutcome => {
      /*
       * The survivor rule needs the index as it is *now*: after the commit
       * the deleted section is gone and its index with it.
       */
      const deletedId =
        command.kind === "delete_section" ? command.sectionId : null;
      const deletedIndex =
        deletedId === null
          ? -1
          : song.sections.findIndex((entry) => entry.id === deletedId);
      return finish(
        applySectionCommand(song, command),
        command.kind,
        STRUCTURAL_SECTION.has(command.kind) ? onBeforeStructural : null,
        (next) => {
          if (deletedIndex < 0 || activeSectionId !== deletedId) return;
          const survivor =
            next.sections[survivorIndex(deletedIndex, next.sections.length)];
          if (survivor) setActiveSection(survivor.id);
        },
      );
    },
    [activeSectionId, finish, onBeforeStructural, setActiveSection, song],
  );

  const runTrack = useCallback(
    (command: TrackCommand): LifecycleOutcome => {
      const deletedId =
        command.kind === "delete_track" ? command.trackId : null;
      const deletedIndex =
        deletedId === null
          ? -1
          : song.tracks.findIndex((entry) => entry.id === deletedId);
      return finish(
        applyTrackCommand(song, command),
        command.kind,
        STRUCTURAL_TRACK.has(command.kind) ? onBeforeStructural : null,
        (next) => {
          if (deletedIndex < 0 || selectedTrackId !== deletedId) return;
          const survivor =
            next.tracks[survivorIndex(deletedIndex, next.tracks.length)];
          if (survivor) selectTrack(survivor.id);
        },
      );
    },
    [finish, onBeforeStructural, selectTrack, selectedTrackId, song],
  );

  return { canApply: canPersist, runSong, runSection, runTrack };
}

"use client";

/**
 * The three owners that move a whole song in or out (2O-A §5).
 *
 * A backup file, an audio or MIDI export, and the project library are
 * different features, but they compose in exactly one place and they share
 * exactly one thing: the ground that has to be put down before another song
 * appears on screen. Grouping them here keeps that ground a single argument
 * rather than three call sites in the composition root that have to agree.
 *
 * It composes handles it is *given* and reaches for no controller of its own,
 * so it stays a sibling of them rather than a layer above.
 */
import { useProjectFile, type ProjectFileHandle } from "@/lib/project/use-project-file";
import { useExport, type ExportHandle } from "@/lib/workspace/use-export";
import {
  useProjectLibrary,
  type ProjectLibraryHandle,
} from "@/lib/workspace/use-project-library";
import type { HistoryAction } from "@/lib/song/edit-history";
import type { Song } from "@/lib/song/schema";

export type WorkspaceFiles = {
  readonly project: ProjectFileHandle;
  readonly exporter: ExportHandle;
  readonly library: ProjectLibraryHandle;
};

export function useWorkspaceFiles(options: {
  song: Song;
  canPersist: boolean;
  commit(next: Song, action: HistoryAction): boolean;
  /** Who is being listened to — the mixer owns that, not this. */
  audibleTrackIds: readonly string[];
  pausePlayback(): void;
  /** Stop, drop the loop, rewind, and put every editing surface down. */
  onBeforeApply(): void;
  onApplied(): void;
}): WorkspaceFiles {
  const { song, canPersist, commit, audibleTrackIds, pausePlayback } = options;

  /* Export reads; it never writes. `pause` is the only thing it asks of the
     live app. */
  const exporter = useExport({ song, audibleTrackIds, pausePlayback });

  const project = useProjectFile({
    song,
    canPersist,
    commit,
    onBeforeApply: options.onBeforeApply,
    onApplied: options.onApplied,
  });

  /*
   * Opening another project is the same event as applying an imported one, as
   * far as the session is concerned: a different song lands, and everything
   * measured against the old one has to be gone first.
   */
  const library = useProjectLibrary({
    onBeforeSwitch: options.onBeforeApply,
    canPersist,
  });

  return { project, exporter, library };
}

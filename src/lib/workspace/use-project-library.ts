"use client";

/**
 * The project library, as the screen sees it (spec 13.21 §5, 2O-A).
 *
 * A thin owner. Every decision it appears to make belongs to somebody else:
 * the catalog contract, the storage layer, the five pure commands, the Song
 * Contract and the validator chain. What lives here is what only a session
 * can know — which sheet is open, which project the reader is about to delete,
 * and what to put down before a different song lands on the screen.
 *
 * It does not embed the catalog logic, and it must not: a controller that
 * knew how to allocate an id would be a second allocator, and the two would
 * disagree the first time one of them was changed.
 */
import { useCallback, useMemo, useState } from "react";

import {
  createProject,
  deleteProject,
  duplicateProject,
  importProjectAsNew,
  openProject,
  type ProjectCommandResult,
  type ProjectEnv,
} from "@/lib/projects/project-commands";
import type { ProjectCatalogV1 } from "@/lib/projects/project-catalog";
import { PROJECT_MESSAGES, type ProjectErrorCode } from "@/lib/projects/project-errors";
import { getProjectSession } from "@/lib/projects/project-session";
import { readRecord } from "@/lib/projects/project-storage";
import {
  summarizeSong,
  unreadableSummary,
  type ProjectSummary,
} from "@/lib/projects/project-summary";
import type { Song } from "@/lib/song/schema";

export type ProjectLibraryHandle = {
  /** Every project, in library order, summarised from its own song. */
  readonly projects: readonly ProjectSummary[];
  readonly activeProjectId: string | null;
  /** False while writing is closed: the library can be read, not changed. */
  readonly canModify: boolean;
  /** The last refusal, as one safe sentence. Never a diagnostic. */
  readonly error: string | null;
  /** The project the reader is being asked to confirm deleting. */
  readonly pendingDelete: ProjectSummary | null;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
  /**
   * When the list was opened.
   *
   * "Bugün 22:14" needs a now, and reading one during render is both impure
   * and wrong: the answer would change under the reader while they scroll. It
   * is taken once, in the event that opened the sheet, which is also the
   * moment the reader means by "today".
   */
  readonly openedAt: number;
  createFrom(templateId: string): boolean;
  openProject(id: string): boolean;
  duplicate(id: string): boolean;
  askDelete(id: string): void;
  cancelDelete(): void;
  confirmDelete(): boolean;
  importAsNew(song: Song): boolean;
  /** The song of any project, active or not, for a backup. Null when unreadable. */
  songOf(id: string): Song | null;
  dismissError(): void;
};

export function useProjectLibrary(options: {
  /** Everything that must be put down before another song appears. */
  onBeforeSwitch(): void;
  /** Whether the app may write at all — the same gate the song store uses. */
  canPersist: boolean;
}): ProjectLibraryHandle {
  const { onBeforeSwitch, canPersist } = options;

  const session = typeof window === "undefined" ? null : getProjectSession();
  const [isOpen, setOpen] = useState(false);
  const [openedAt, setOpenedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  /* Bumped after every successful command, so the summaries are re-read. */
  const [revision, setRevision] = useState(0);

  const catalog: ProjectCatalogV1 | null = session?.catalog ?? null;
  const storage = session?.storage ?? null;
  const canModify = canPersist && session?.canPersist === true && catalog !== null;

  /**
   * The list, read from the projects themselves.
   *
   * Never from a cache in the catalog: a cached bar count is right until the
   * first edit, and after that it is a number the app is showing its reader
   * that nothing in the app believes.
   */
  const projects = useMemo<ProjectSummary[]>(() => {
    void revision;
    if (!catalog || !storage) return [];
    return catalog.projectIds.map((id) => {
      const record = readRecord(storage, id);
      const isActive = id === catalog.activeProjectId;
      if (record.kind === "record" || record.kind === "recovered_previous") {
        return summarizeSong(id, record.song, {
          isActive,
          updatedAt: record.updatedAt,
        });
      }
      return unreadableSummary(
        id,
        record.kind === "future_version" ? "future_version" : "unreadable",
        isActive,
      );
    });
  }, [catalog, storage, revision]);

  const refuse = useCallback((code: ProjectErrorCode) => {
    setError(PROJECT_MESSAGES[code]);
  }, []);

  /**
   * Run a command and take the session with it.
   *
   * The order matters: the ground is put down only after the command has
   * succeeded. A failed switch must leave the reader's selections, clipboards
   * and playback exactly as they were — clearing them first would punish them
   * for an operation that never happened.
   */
  const run = useCallback(
    (command: (env: ProjectEnv) => ProjectCommandResult, switching: boolean): boolean => {
      if (!session || !catalog || !storage) return false;
      if (!canModify) {
        refuse("project_storage_unavailable");
        return false;
      }
      const result = command({ storage, catalog, now: Date.now() });
      if (!result.ok) {
        refuse(result.error.code);
        return false;
      }
      setError(null);
      if (switching) onBeforeSwitch();
      session.openProject(result.activeProjectId, result.song, result.catalog);
      setRevision((value) => value + 1);
      return true;
    },
    [canModify, catalog, onBeforeSwitch, refuse, session, storage],
  );

  const songOf = useCallback(
    (id: string): Song | null => {
      if (!storage) return null;
      const record = readRecord(storage, id);
      return record.kind === "record" || record.kind === "recovered_previous"
        ? record.song
        : null;
    },
    [storage],
  );

  const pendingDelete =
    pendingDeleteId === null
      ? null
      : (projects.find((entry) => entry.id === pendingDeleteId) ?? null);

  return {
    projects,
    activeProjectId: catalog?.activeProjectId ?? null,
    canModify,
    error,
    pendingDelete,
    isOpen,
    openedAt,
    open: () => {
      setOpenedAt(Date.now());
      setOpen(true);
    },
    close: () => {
      setOpen(false);
      setPendingDeleteId(null);
      setError(null);
    },
    createFrom: (templateId) => run((env) => createProject(env, templateId), true),
    openProject: (id) => run((env) => openProject(env, id), true),
    duplicate: (id) => run((env) => duplicateProject(env, id), true),
    askDelete: (id) => setPendingDeleteId(id),
    cancelDelete: () => setPendingDeleteId(null),
    confirmDelete: () => {
      if (pendingDeleteId === null) return false;
      const target = pendingDeleteId;
      const wasActive = target === catalog?.activeProjectId;
      const done = run((env) => deleteProject(env, target), wasActive);
      if (done) setPendingDeleteId(null);
      return done;
    },
    importAsNew: (song) => run((env) => importProjectAsNew(env, song), true),
    songOf,
    dismissError: () => setError(null),
  };
}

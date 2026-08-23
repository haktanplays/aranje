"use client";

/**
 * The project-file flows, held together in one place (spec 13.15, 2L-A).
 *
 * Everything between the pure contract and the screen lives here: reading a
 * picked file, the import preview state, the apply orchestration, and the
 * Blob/Object-URL lifecycle of a download. Deliberately a hook and not part
 * of `Workspace` — a file reader callback or a revoke timer that lived in the
 * workspace would be one more thing growing the component that already owns
 * every other surface.
 *
 * ## Preview changes nothing
 *
 * Between "file picked" and "Projeyi aç", the current song, storage, history,
 * playback, selection and clipboard are untouched: the parsed song exists
 * only in this hook's state, and "Vazgeç" drops it. The one mutation is
 * `apply`, and it goes through the same commit gate as every edit.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { sameSong, type HistoryAction } from "@/lib/song/edit-history";
import { songSchema, type Song } from "@/lib/song/schema";
import type { ValidationIssue } from "@/lib/validators";
import {
  exportProject,
  importTooLarge,
  parseProjectText,
  projectPreview,
  type ProjectPreview,
} from "@/lib/project/project-file";
import {
  EXPORT_BLOCKED_MESSAGE,
  PROJECT_FILE_MESSAGES,
} from "@/lib/project/project-file-errors";
import {
  PROJECT_FILE_MIME,
  projectFileName,
} from "@/lib/project/project-file-name";

export type ProjectFileState =
  | { readonly status: "idle" }
  | {
      readonly status: "preview";
      readonly fileName: string;
      readonly song: Song;
      readonly warnings: readonly ValidationIssue[];
      readonly preview: ProjectPreview;
    }
  | { readonly status: "error"; readonly message: string };

export type ProjectFileHandle = {
  readonly state: ProjectFileState;
  /** Set when the last backup attempt was refused; cleared by the next one. */
  readonly exportError: string | null;
  /** Serialise the current song and hand the browser a download. */
  downloadBackup(): void;
  /** The same, for any project's song — including one that is not open. */
  downloadProject(song: Song | null): void;
  /** A picked file: size gate first, then read, then the pure parse. */
  openFile(file: File): void;
  /** Put the previewed song in place of the current one, as one edit. */
  apply(): void;
  /** Drop every transient import state. Changes nothing else. */
  cancel(): void;
};

export function useProjectFile(options: {
  song: Song;
  canPersist: boolean;
  commit(next: Song, action: HistoryAction): boolean;
  /**
   * Runs just before the commit: the workspace uses it to stop playback,
   * drop the loop, rewind, and put every editing surface and clipboard down.
   */
  onBeforeApply(): void;
  /** Runs after a successful commit — the sheet closes itself through this. */
  onApplied(): void;
}): ProjectFileHandle {
  const { song, canPersist, commit, onBeforeApply, onApplied } = options;

  const [state, setState] = useState<ProjectFileState>({ status: "idle" });
  const [exportError, setExportError] = useState<string | null>(null);

  /*
   * Every Object URL this hook has minted and not yet revoked. Revocation is
   * queued rather than immediate — a URL revoked in the same task as the
   * click can race the download that click started — and the unmount cleanup
   * revokes whatever is still pending, so no URL outlives the screen.
   */
  const pendingUrls = useRef<Set<string>>(new Set());

  useEffect(() => {
    const urls = pendingUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  /**
   * Back up any song, not only the open one (2O-A §20).
   *
   * The library backs up a project the reader is not looking at — before
   * deleting it, most importantly — and it must not have to open it first.
   * The same pure serializer, the same file name rule, the same single Object
   * URL: there is no second export path, only a second caller.
   *
   * A null song is a project that could not be read. Nothing is written and no
   * empty file is offered: a backup of a project this app cannot open would be
   * a file that claims to hold music it does not.
   */
  const downloadProject = useCallback((target: Song | null) => {
    if (target === null) {
      setExportError(EXPORT_BLOCKED_MESSAGE);
      return;
    }
    const result = exportProject(target);
    if (!result.ok) {
      setExportError(EXPORT_BLOCKED_MESSAGE);
      return;
    }
    setExportError(null);

    const blob = new Blob([result.text], { type: PROJECT_FILE_MIME });
    const url = URL.createObjectURL(blob);
    pendingUrls.current.add(url);

    // Inside the user gesture that called this, which is what lets the
    // browser treat it as a download rather than a popup.
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = projectFileName(target.title);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => {
      URL.revokeObjectURL(url);
      pendingUrls.current.delete(url);
    }, 0);
  }, []);

  const downloadBackup = useCallback(() => {
    downloadProject(song);
  }, [downloadProject, song]);

  const openFile = useCallback((file: File) => {
    // The byte count refuses before a single byte is read (spec 13.15).
    if (importTooLarge(file.size)) {
      setState({ status: "error", message: PROJECT_FILE_MESSAGES.file_too_large });
      return;
    }

    file.text().then(
      (text) => {
        const result = parseProjectText(text);
        if (!result.ok) {
          setState({ status: "error", message: PROJECT_FILE_MESSAGES[result.code] });
          return;
        }
        setState({
          status: "preview",
          fileName: file.name,
          song: result.song,
          warnings: result.warnings,
          preview: projectPreview(result.song, result.warnings),
        });
      },
      () => {
        setState({ status: "error", message: PROJECT_FILE_MESSAGES.file_read_failed });
      },
    );
  }, []);

  const apply = useCallback(() => {
    if (state.status !== "preview") return;
    /*
     * The button is disabled when the session cannot persist; this is the
     * belt to that suspender, so a call that slips past a disabled control
     * still changes nothing.
     */
    if (!canPersist) {
      setState({
        status: "error",
        message: PROJECT_FILE_MESSAGES.storage_unavailable,
      });
      return;
    }

    // Validated *again* at the moment of use (spec 13.15) — the preview may
    // have been sitting open for an hour.
    const parsed = songSchema.safeParse(state.song);
    if (!parsed.success) {
      setState({ status: "error", message: PROJECT_FILE_MESSAGES.song_invalid });
      return;
    }

    if (sameSong(parsed.data, song)) {
      setState({
        status: "error",
        message: PROJECT_FILE_MESSAGES.import_no_change,
      });
      return;
    }

    onBeforeApply();
    if (!commit(parsed.data, { kind: "project_import" })) {
      /*
       * The store refused the write. Nothing advanced, and the recovery
       * banner above the workspace is already saying why — the preview stays
       * so the reader can decide what to do with the file still in hand.
       */
      return;
    }
    setState({ status: "idle" });
    onApplied();
  }, [canPersist, commit, onApplied, onBeforeApply, song, state]);

  const cancel = useCallback(() => {
    setState({ status: "idle" });
    setExportError(null);
  }, []);

  return {
    state,
    exportError,
    downloadBackup,
    downloadProject,
    openFile,
    apply,
    cancel,
  };
}

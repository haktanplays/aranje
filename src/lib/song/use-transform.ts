"use client";

/**
 * Selection and transform state for the screen (spec 13.1, K-37).
 *
 * The one place a component may reach the transform core from. Nothing else
 * calls `applyTransform`, and nothing else writes a transform's result into the
 * store — a component that applied a Song itself would be a second commit path
 * and the single-undo promise would quietly stop being true.
 *
 * Two things this owns that the pure core deliberately does not:
 *
 * - **Preview.** A ghost is computed by running the real command against the
 *   current song and *throwing the result away*. It is never committed, so
 *   previewing cannot write, and what the reader sees is what would actually
 *   happen rather than a drawing of what we hope would happen.
 * - **Pending nudges.** Tapping the right arrow five times is one musical
 *   thought, so it accumulates into one pending transform and lands as one
 *   commit and one undo step when the sheet is applied.
 *
 * Selection and clipboard are session state. Neither is written to the Song or
 * to localStorage, and both are dropped when the track or section changes.
 */
import { useCallback, useMemo, useState } from "react";

import {
  applyTransform,
  copySelection,
  type TransformCommand,
  type TransformErrorCode,
} from "@/lib/song/transform";
import { EMPTY_CLIPBOARD, type Clipboard, type TimeSelection } from "@/lib/song/time-selection";
import { summariseSelection, type SelectionSummary } from "@/lib/song/selection-summary";
import { transformMessage } from "@/lib/song/transform-messages";
import type { HistoryAction } from "@/lib/song/edit-history";
import type { Song } from "@/lib/song/schema";
import type { ValidationIssue } from "@/lib/validators/types";

/** What a ghost preview says about a command that has not been applied. */
export type Preview =
  | { readonly ok: true; readonly song: Song; readonly selection: TimeSelection; readonly warnings: readonly ValidationIssue[] }
  | { readonly ok: false; readonly code: TransformErrorCode; readonly message: string };

export type TransformHandle = {
  readonly selection: TimeSelection | null;
  readonly summary: SelectionSummary | null;
  readonly clipboard: Clipboard;
  readonly hasClipboard: boolean;
  /** Set after a refusal; cleared by the next action. */
  readonly error: string | null;
  /** Set after a success that carried warnings. Never blocks. */
  readonly notice: string | null;
  /** The command a sheet has staged but not applied. */
  readonly pending: TransformCommand | null;
  readonly preview: Preview | null;

  select(next: TimeSelection | null): void;
  clear(): void;
  /**
   * Forget what was copied. Only opening a project asks for this (2L-A):
   * an edit or an undo keeps the clipboard, but a clipboard cut from a song
   * that has been wholly replaced would paste another song's music.
   */
  clearClipboard(): void;
  copy(): void;
  /** Stage a command and compute its ghost. Writes nothing. */
  stage(command: TransformCommand | null): void;
  /** Commit the staged command, or a one-shot command directly. */
  apply(command?: TransformCommand): boolean;
  /** Preview a command without staging it, for a confirmation step. */
  previewOf(command: TransformCommand): Preview | null;
};

type Store = {
  getSnapshot(): { song: Song };
  commit(next: Song, action: HistoryAction): boolean;
};

export function useTransform(store: Store, song: Song): TransformHandle {
  const [selection, setSelection] = useState<TimeSelection | null>(null);
  const [clipboard, setClipboard] = useState<Clipboard>(EMPTY_CLIPBOARD);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<TransformCommand | null>(null);
  /**
   * Whether the core widened the last selection to keep a chain whole.
   *
   * State rather than a ref: the summary is derived from it during render, and
   * a ref read at render time is both a lint error and a real staleness bug —
   * the badge would lag the selection by one commit.
   */
  const [expanded, setExpanded] = useState(false);

  const summary = useMemo(
    () => (selection ? summariseSelection(song, selection, { expanded }) : null),
    [song, selection, expanded],
  );

  const runPreview = useCallback(
    (command: TransformCommand): Preview | null => {
      if (!selection) return null;
      const result = applyTransform(song, selection, command);
      if (!result.ok) {
        return { ok: false, code: result.error.code, message: transformMessage(result.error.code) };
      }
      return {
        ok: true,
        song: result.song,
        selection: result.selection,
        warnings: result.warnings,
      };
    },
    [selection, song],
  );

  const preview = useMemo(
    () => (pending ? runPreview(pending) : null),
    [pending, runPreview],
  );

  const select = useCallback(
    (next: TimeSelection | null) => {
      setError(null);
      setNotice(null);
      setPending(null);
      if (!next) {
        setExpanded(false);
        setSelection(null);
        return;
      }
      // Ask the core where the selection really is, so the band the reader
      // sees is the music the command will act on — chain and all.
      const normalised = copySelection(song, next);
      if (normalised.ok) {
        setExpanded(
          normalised.selection.startTicks !== next.startTicks ||
            normalised.selection.endTicks !== next.endTicks,
        );
        setSelection(normalised.selection);
        return;
      }
      setExpanded(false);
      setSelection(next);
    },
    [song],
  );

  const clear = useCallback(() => {
    setExpanded(false);
    setSelection(null);
    setPending(null);
    setError(null);
    setNotice(null);
  }, []);

  const clearClipboard = useCallback(() => {
    setClipboard(EMPTY_CLIPBOARD);
  }, []);

  const copy = useCallback(() => {
    if (!selection) return;
    const result = copySelection(song, selection);
    if (!result.ok) {
      setError(transformMessage(result.error.code));
      return;
    }
    // Reading changes nothing: no commit, no write, no undo step.
    setClipboard(result.clipboard);
    setError(null);
    setNotice("Seçim kopyalandı.");
  }, [selection, song]);

  const apply = useCallback(
    (command?: TransformCommand): boolean => {
      const target = command ?? pending;
      if (!selection || !target) return false;

      const result = applyTransform(store.getSnapshot().song, selection, target);
      if (!result.ok) {
        // A refusal touches neither the store nor the history.
        setError(transformMessage(result.error.code));
        return false;
      }

      // Cut fills the clipboard only once the commit has actually happened.
      if (target.kind === "cut_selection") {
        const read = copySelection(store.getSnapshot().song, selection);
        if (read.ok) setClipboard(read.clipboard);
      }

      // One commit, and it says what it was — that is the sentence the undo
      // control will read back to the reader.
      store.commit(result.song, {
        kind: "selection_transform",
        command: target.kind,
      });
      setExpanded(false);
      setSelection(result.selection);
      setPending(null);
      setError(null);
      setNotice(
        result.warnings.length > 0
          ? "Uygulandı. Birkaç yerde el pozisyonu zorlanıyor olabilir."
          : null,
      );
      return true;
    },
    [pending, selection, store],
  );

  return {
    selection,
    summary,
    clipboard,
    hasClipboard: clipboard.events.length > 0 || clipboard.widthTicks > 0,
    error,
    notice,
    pending,
    preview,
    select,
    clear,
    clearClipboard,
    copy,
    stage: setPending,
    apply,
    previewOf: runPreview,
  };
}

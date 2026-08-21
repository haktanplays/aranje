"use client";

/**
 * The only place the bar-command core reaches the screen (spec 13.12, K-43).
 *
 * Same shape as `use-transform.ts`, and for the same reason: "one apply, one
 * write, one undo" is a promise about *how many callers commit*, and it can
 * only be kept if there is one. A component that ran `applyBarCommand` and
 * wrote the result itself would look right and quietly produce two history
 * entries, or one with nothing behind it.
 *
 * Everything here is session state. The selection, the clipboard and the
 * staged command are where someone's finger is, not properties of the piece —
 * none of them is written to the Song, reaches the fingerprint, or travels to
 * the Copilot.
 *
 * ## Preview runs the real thing
 *
 * A ghost is the actual command against the actual song, with the resulting
 * song thrown away. That is the only way a preview cannot promise something
 * the commit will not do: it is the same code path, and the only difference is
 * that nobody keeps the answer.
 */
import { useCallback, useMemo, useState } from "react";

import { BAR_MESSAGES } from "@/lib/song/bar-messages";
import {
  applyBarCommand,
  copyBars,
  type BarClipboard,
  type BarCommand,
} from "@/lib/song/bar-transform";
import {
  barSelectionLength,
  expandBarSelection,
  expansionNotice,
  type BarSelection,
} from "@/lib/song/bar-selection";
import type { HistoryAction } from "@/lib/song/edit-history";
import type { Song } from "@/lib/song/schema";

/** The store bridge, so this file never imports the store itself. */
export type BarStore = {
  getSnapshot: () => { song: Song };
  commit: (song: Song, action: HistoryAction) => boolean;
};

export type BarPreview =
  | { readonly ok: true; readonly text: string }
  | {
      readonly ok: false;
      readonly text: string;
      /** True when overwriting would let it through. */
      readonly canReplace: boolean;
    };

export type BarTransformHandle = {
  readonly selection: BarSelection | null;
  /** "Ritim Gitar · 2 ölçü" or "Tüm enstrümanlar · 2 ölçü". */
  readonly summary: string | null;
  /** Said when the selection grew to keep a chain whole. */
  readonly notice: string | null;
  readonly error: string | null;
  readonly pending: BarCommand | null;
  readonly preview: BarPreview | null;
  /**
   * The song the staged command would produce, for drawing the ghost.
   *
   * Never committed and never stored — it exists for exactly as long as the
   * preview is on screen. Handing it out is what lets the reader see the
   * outcome rather than read a sentence about it, and it is the same object
   * the apply would commit, so the picture cannot promise something else.
   */
  readonly previewSong: Song | null;
  readonly hasClipboard: boolean;
  readonly clipboardScope: "track" | "full" | null;
  readonly clipboardSummary: string | null;
  /** Takes hold of bars, widening the range if a chain crosses its edge. */
  select: (selection: BarSelection) => void;
  clear: () => void;
  copy: () => void;
  stage: (command: BarCommand) => void;
  /**
   * Stage a paste of whatever is on the clipboard.
   *
   * A method rather than an exposed clipboard, so no component can build a
   * paste around a clipboard from the other scope. The core would refuse it —
   * but the refusal would be a message the reader has to read, where this is a
   * control that is simply not offered.
   */
  stagePaste: () => void;
  stageInsertCopied: (side: "before" | "after") => void;
  cancel: () => void;
  /** Commits the staged command. One write, one history entry. */
  apply: (options?: { readonly replace?: boolean }) => boolean;
};

/** How a selection reads in the action bar. */
function summarise(
  selection: BarSelection,
  trackName: (trackId: string) => string,
): string {
  const bars = `${barSelectionLength(selection)} ölçü`;
  return selection.scope === "track"
    ? `${trackName(selection.trackId)} · ${bars}`
    : `Tüm enstrümanlar · ${bars}`;
}

/** What a staged command is about to do, in one sentence. */
function describe(command: BarCommand, selection: BarSelection): string {
  const bars = barSelectionLength(selection);
  const scope = selection.scope === "full" ? "bütün enstrümanlarda" : "bu enstrümanda";
  switch (command.kind) {
    case "cut_bars":
      return `${bars} ölçü ${scope} kesilecek.`;
    case "delete_bars":
      return selection.scope === "full"
        ? `${bars} ölçü şarkıdan çıkarılacak.`
        : `${bars} ölçünün içeriği ${scope} silinecek.`;
    case "paste_bar_contents":
      return `Panodaki içerik ${bars} ölçüye yazılacak.`;
    case "insert_copied_bars":
      return command.side === "before"
        ? "Kopyalanan ölçüler seçimin önüne eklenecek."
        : "Kopyalanan ölçüler seçimin arkasına eklenecek.";
    case "duplicate_bars":
      return selection.scope === "full"
        ? `${bars} ölçü hemen arkasına kopyalanacak.`
        : `${bars} ölçünün içeriği hemen arkasına kopyalanacak.`;
    case "repeat_bars":
      return command.mode.kind === "count"
        ? `${bars} ölçü ${command.mode.count} kez tekrarlanacak.`
        : "Bölüm sonuna kadar tekrarlanacak.";
    case "insert_blank_bar_before":
      return "Seçimin önüne boş bir ölçü eklenecek.";
    case "insert_blank_bar_after":
      return "Seçimin arkasına boş bir ölçü eklenecek.";
    case "move_bars_left":
      return `${bars} ölçü bir ölçü sola taşınacak.`;
    case "move_bars_right":
      return `${bars} ölçü bir ölçü sağa taşınacak.`;
    case "copy_bars":
      return "Kopyalama şarkıyı değiştirmez.";
  }
}

export function useBarTransform(
  store: BarStore,
  song: Song,
  trackName: (trackId: string) => string,
): BarTransformHandle {
  const [selection, setSelection] = useState<BarSelection | null>(null);
  const [clipboard, setClipboard] = useState<BarClipboard | null>(null);
  const [pending, setPending] = useState<BarCommand | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Take hold of a range of bars.
   *
   * Expansion happens here rather than at the first operation, because a
   * selection that will be widened is a selection the reader should see
   * widened — being told after pressing "Kes" that it actually cut three bars
   * is being told too late. The command core expands again on its own; that
   * is deliberate duplication of a *pure* function, not of a decision, and it
   * means an operation is safe however the selection reached it.
   */
  const select = useCallback(
    (next: BarSelection) => {
      setPending(null);
      const expanded = expandBarSelection(song, next);
      if (!expanded.ok) {
        // A chain out of the section is refused at the selection itself: there
        // is no state in which the reader holds bars this app cannot move.
        setSelection(null);
        setNotice(null);
        setError(expanded.error.message);
        return;
      }
      setSelection(expanded.selection);
      setError(null);
      setNotice(
        expansionNotice(
          expanded.grewBy,
          barSelectionLength(expanded.selection),
        ),
      );
    },
    [song],
  );

  const clear = useCallback(() => {
    setSelection(null);
    setPending(null);
    setError(null);
    setNotice(null);
  }, []);

  const cancel = useCallback(() => {
    setPending(null);
    setError(null);
  }, []);

  const copy = useCallback(() => {
    if (!selection) return;
    const result = copyBars(store.getSnapshot().song, selection);
    if (!result.ok) {
      setError(BAR_MESSAGES[result.error.code]);
      return;
    }
    setClipboard(result.clipboard);
    setSelection(result.selection);
    setNotice(result.notice ?? "Ölçüler kopyalandı.");
    setError(null);
  }, [selection, store]);

  const stage = useCallback((command: BarCommand) => {
    setPending(command);
    setError(null);
  }, []);

  const stagePaste = useCallback(() => {
    if (!clipboard) return;
    setPending({ kind: "paste_bar_contents", clipboard });
    setError(null);
  }, [clipboard]);

  const stageInsertCopied = useCallback(
    (side: "before" | "after") => {
      if (!clipboard) return;
      setPending({ kind: "insert_copied_bars", clipboard, side });
      setError(null);
    },
    [clipboard],
  );

  /*
   * The ghost. It runs the real command against the real song and keeps only
   * the verdict — so it can never show an outcome the commit would not
   * produce, and it can never produce one the reader did not ask for.
   */
  const ghost = useMemo(() => {
    if (!selection || !pending) return null;
    return applyBarCommand(song, selection, pending);
  }, [pending, selection, song]);

  const preview = useMemo((): BarPreview | null => {
    if (!ghost || !selection || !pending) return null;
    if (ghost.ok) {
      return { ok: true, text: describe(pending, selection) };
    }
    return {
      ok: false,
      text: BAR_MESSAGES[ghost.error.code],
      canReplace: ghost.error.code === "target_occupied",
    };
  }, [ghost, pending, selection]);

  const apply = useCallback(
    (options: { readonly replace?: boolean } = {}): boolean => {
      if (!selection || !pending) return false;
      const command: BarCommand =
        options.replace &&
        (pending.kind === "paste_bar_contents")
          ? { ...pending, replace: true }
          : pending;

      const result = applyBarCommand(store.getSnapshot().song, selection, command);
      if (!result.ok) {
        setError(BAR_MESSAGES[result.error.code]);
        return false;
      }
      // The one commit. One storage write, one history entry (spec 5.6).
      store.commit(result.song, {
        kind: "bar_transform",
        command: command.kind,
        scope: selection.scope,
      });
      setSelection(result.selection);
      setPending(null);
      setError(null);
      setNotice(result.notice);

      // A cut only fills the clipboard once the song has actually changed.
      if (command.kind === "cut_bars") {
        const read = copyBars(song, selection);
        if (read.ok) setClipboard(read.clipboard);
      }
      return true;
    },
    [pending, selection, song, store],
  );

  const summary = useMemo(
    () => (selection ? summarise(selection, trackName) : null),
    [selection, trackName],
  );

  const clipboardSummary = useMemo(() => {
    if (!clipboard) return null;
    const bars = `${clipboard.barCount} ölçü`;
    return clipboard.kind === "track_bars"
      ? `${trackName(clipboard.trackId)} · ${bars}`
      : `Tüm enstrümanlar · ${bars}`;
  }, [clipboard, trackName]);

  return {
    selection,
    summary,
    notice,
    error,
    pending,
    preview,
    previewSong: ghost?.ok ? ghost.song : null,
    hasClipboard: clipboard !== null,
    clipboardScope: clipboard ? (clipboard.kind === "track_bars" ? "track" : "full") : null,
    clipboardSummary,
    select,
    clear,
    copy,
    stage,
    stagePaste,
    stageInsertCopied,
    cancel,
    apply,
  };
}

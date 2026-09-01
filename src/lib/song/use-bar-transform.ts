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

import { BAR_MESSAGES, needsReplaceConfirmation } from "@/lib/song/bar-messages";
import {
  acceptsReplace,
  applyBarCommand,
  copyBars,
  withReplace,
  type BarClipboard,
  type BarCommand,
} from "@/lib/song/bar-transform";
import {
  barSelectionLength,
  expandBarSelection,
  expansionNotice,
  type BarSelection,
} from "@/lib/song/bar-selection";
import {
  publishWorkspaceEdit,
  songFingerprint,
  type WorkspaceEditAction,
} from "@/lib/song/workspace-events";
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
  /** Forget what was copied. Only opening a project asks for this (2L-A). */
  clearClipboard: () => void;
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

/**
 * Which commands can be re-run as an overwrite.
 *
 * Exactly the ones whose `BarCommand` carries a `replace` flag the core reads.
 * Written as a switch on the kind rather than a `"replace" in command` test,
 * so adding a command that ought to be overwritable is a decision someone
 * makes here rather than something that happens by the shape of a literal.
 */
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

/**
 * Which editor action a bar command is (2V-B.1 §13).
 *
 * The measure vocabulary and the note vocabulary are different words for the
 * same six verbs, and the acceptance descriptor asks about the verb. Both
 * inserts and the two blank-bar commands are `other`: they are real edits
 * that this round does not have a task for, and calling one of them "paste"
 * to fit the enum would make a wrong event look like a right one.
 */
const BAR_EDIT_ACTION_OF: Readonly<Record<BarCommand["kind"], WorkspaceEditAction>> = {
  copy_bars: "copy",
  cut_bars: "cut",
  paste_bar_contents: "paste",
  insert_copied_bars: "paste",
  duplicate_bars: "duplicate",
  repeat_bars: "repeat",
  insert_blank_bar_before: "other",
  insert_blank_bar_after: "other",
  delete_bars: "delete",
  move_bars_left: "move",
  move_bars_right: "move",
};

/** The bars a selection covers, in the key the rest of the app uses. */
function barKeysOf(selection: BarSelection): string[] {
  const keys: string[] = [];
  for (let index = selection.startBarIndex; index <= selection.endBarIndex; index += 1) {
    keys.push(`${selection.sectionId}:${index}`);
  }
  return keys;
}

/** Whose music a bar command moves: one track, or all of them. */
function barTrackIds(song: Song, selection: BarSelection): string[] {
  return selection.scope === "track"
    ? [selection.trackId]
    : song.tracks.map((track) => track.id);
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

  const clearClipboard = useCallback(() => {
    setClipboard(null);
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
    publishWorkspaceEdit({
      action: "copy",
      scope: "measures",
      mutating: false,
      songBefore: songFingerprint(song),
      songAfter: songFingerprint(song),
      sectionId: selection.sectionId,
      trackIds: barTrackIds(song, selection),
      startTicks: 0,
      endTicks: 0,
      barKeys: barKeysOf(selection),
    });
    setNotice(result.notice ?? "Ölçüler kopyalandı.");
    setError(null);
  }, [selection, song, store]);

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
      /*
       * Two questions, and both have to say yes (2U-B §7). The core must
       * consider this collision answerable by an overwrite, *and* the staged
       * command must be one that carries a `replace` flag for it to answer
       * with. Asking only the first was the defect: "Yerine koy" appeared on a
       * move, whose collision no overwrite resolves, and pressing it re-ran
       * the identical command and produced the identical refusal.
       */
      canReplace:
        needsReplaceConfirmation(ghost.error.code) && acceptsReplace(pending),
    };
  }, [ghost, pending, selection]);

  const apply = useCallback(
    (options: { readonly replace?: boolean } = {}): boolean => {
      if (!selection || !pending) return false;
      /*
       * A confirmed overwrite is the same command again with the flag set —
       * for every command that has one. The old version named a single kind,
       * so a confirmed duplicate or repeat re-ran unchanged and refused for
       * the second time (2U-B §7).
       */
      const overwriting = options.replace === true ? withReplace(pending) : null;
      /*
       * A replace nobody can honour is a bug in whatever offered the control,
       * not something to swallow: returning quietly here would look exactly
       * like the silent no-op this round removed.
       */
      if (options.replace === true && overwriting === null) {
        throw new Error(
          `"Yerine koy" ${pending.kind} için sunulmamalıydı: bu komut üzerine yazmayı desteklemiyor.`,
        );
      }
      const command: BarCommand = overwriting ?? pending;

      const result = applyBarCommand(store.getSnapshot().song, selection, command);
      if (!result.ok) {
        setError(BAR_MESSAGES[result.error.code]);
        return false;
      }
      // The one commit. One storage write, one history entry (spec 5.6).
      const before = store.getSnapshot().song;
      const committed = store.commit(result.song, {
        kind: "bar_transform",
        command: command.kind,
        scope: selection.scope,
      });
      /* Only when the write landed: a refusal changed nothing (§13). */
      if (committed) {
        publishWorkspaceEdit({
          action: BAR_EDIT_ACTION_OF[command.kind],
          scope: "measures",
          mutating: true,
          songBefore: songFingerprint(before),
          songAfter: songFingerprint(result.song),
          sectionId: selection.sectionId,
          trackIds: barTrackIds(before, selection),
          startTicks: 0,
          endTicks: 0,
          barKeys: barKeysOf(selection),
        });
      }
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
    clearClipboard,
    copy,
    stage,
    stagePaste,
    stageInsertCopied,
    cancel,
    apply,
  };
}

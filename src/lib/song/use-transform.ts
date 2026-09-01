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
import {
  chainImpact,
  type ChainImpact,
  type ChainPolicy,
} from "@/lib/song/chain-preflight";
import { EMPTY_CLIPBOARD, type Clipboard, type TimeSelection } from "@/lib/song/time-selection";
import { summariseSelection, type SelectionSummary } from "@/lib/song/selection-summary";
import { transformMessage } from "@/lib/song/transform-messages";
import {
  publishWorkspaceEdit,
  songFingerprint,
  type WorkspaceEditAction,
} from "@/lib/song/workspace-events";
import type { HistoryAction } from "@/lib/song/edit-history";
import type { Song } from "@/lib/song/schema";
import type { ValidationIssue } from "@/lib/validators/types";

/** What a ghost preview says about a command that has not been applied. */
export type Preview =
  | { readonly ok: true; readonly song: Song; readonly selection: TimeSelection; readonly warnings: readonly ValidationIssue[] }
  | { readonly ok: false; readonly code: TransformErrorCode; readonly message: string };

/**
 * A command waiting on the reader's decision about the music around it.
 *
 * The command is held rather than run, so nothing has happened yet: no ghost,
 * no write, no history step. `then` records what it was on its way to doing,
 * so choosing an option resumes exactly that rather than a similar thing.
 */
export type ChainDecision = {
  readonly command: TransformCommand;
  readonly then: "stage" | "apply" | "copy";
  readonly impact: ChainImpact;
};

export type TransformHandle = {
  readonly selection: TimeSelection | null;
  readonly summary: SelectionSummary | null;
  /** What the current selection would cut, read before anything runs. */
  readonly impact: ChainImpact | null;
  /** The decision already taken for this selection, if any. */
  readonly chainPolicy: ChainPolicy | null;
  /** Set when an action is waiting for that decision. Nothing has run. */
  readonly chainDecision: ChainDecision | null;
  /** Answer it, and carry on with whatever was waiting. */
  chooseChainPolicy(policy: ChainPolicy): void;
  /** Drop the waiting action. Song, clipboard, storage and history untouched. */
  cancelChainDecision(): void;
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

/**
 * Which editor action a transform command is, in the canon's words.
 *
 * Written out rather than derived from the string, because the two
 * vocabularies are allowed to diverge: `move_selection_time` is "move" to a
 * reader whatever the core decides to call it next year, and a silent
 * mismatch would make an event unmatchable rather than make it fail.
 */
const EDIT_ACTIONS: Readonly<Record<TransformCommand["kind"], WorkspaceEditAction>> = {
  copy_selection: "copy",
  cut_selection: "cut",
  delete_selection: "delete",
  paste_selection: "paste",
  duplicate_selection: "duplicate",
  move_selection_time: "move",
  repeat_selection: "repeat",
  transpose_pitch: "other",
  restring_same_pitch: "other",
  translate_fret_shape: "other",
};

function editActionOf(kind: TransformCommand["kind"]): WorkspaceEditAction {
  return EDIT_ACTIONS[kind];
}

export function useTransform(store: Store, song: Song): TransformHandle {
  const [selection, setSelection] = useState<TimeSelection | null>(null);
  const [clipboard, setClipboard] = useState<Clipboard>(EMPTY_CLIPBOARD);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<TransformCommand | null>(null);
  /**
   * The decision about the music around the selection, and the action waiting
   * on it (spec 13.20 §2).
   *
   * Both are cleared whenever the selection changes: a policy chosen for one
   * chord means nothing about the next one, and a policy that outlived its
   * selection would be the old silent expansion wearing a different name.
   */
  const [chainPolicy, setChainPolicy] = useState<ChainPolicy | null>(null);
  const [chainDecision, setChainDecision] = useState<ChainDecision | null>(null);

  const summary = useMemo(
    () => (selection ? summariseSelection(song, selection) : null),
    [song, selection],
  );

  const impact = useMemo(
    () => (selection ? chainImpact(song, selection) : null),
    [song, selection],
  );

  /*
   * One options object, built in one place.
   *
   * Preview and commit both take their policy from here, so the scope shown
   * and the scope written are the same value rather than two computations that
   * happen to agree today. That is the regression this checkpoint most needs
   * to make impossible: a ghost promising "only the chord" while the commit
   * moves the whole run.
   */
  const options = useMemo(
    () => (chainPolicy === null ? {} : { chainPolicy }),
    [chainPolicy],
  );

  const runPreview = useCallback(
    (command: TransformCommand): Preview | null => {
      if (!selection) return null;
      const result = applyTransform(song, selection, command, options);
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
    [options, selection, song],
  );

  const preview = useMemo(
    () => (pending ? runPreview(pending) : null),
    [pending, runPreview],
  );

  /** True when this command cannot run until the reader has decided. */
  const needsDecision = useCallback(
    (): boolean =>
      impact !== null &&
      impact.kind !== "no_chain_impact" &&
      impact.kind !== "crosses_section_boundary" &&
      chainPolicy === null,
    [chainPolicy, impact],
  );

  /**
   * Hold exactly what the caller handed over (spec 13.20 §1).
   *
   * This used to run the range through the transform core first and store what
   * came back, which meant a press on one chord became the whole legato chain
   * before the band was ever drawn. The reader had no way to ask for the chord
   * they touched, because no state anywhere remembered it.
   *
   * The chain has not stopped mattering. It is a fact about the *command* —
   * what would break if this music moved — and it is worked out by the
   * preflight when an action is chosen, where the reader can be shown it and
   * given a choice. Selecting stays a statement about a finger.
   */
  const select = useCallback((next: TimeSelection | null) => {
    setError(null);
    setNotice(null);
    setPending(null);
    setChainPolicy(null);
    setChainDecision(null);
    setSelection(next);
  }, []);

  const clear = useCallback(() => {
    setSelection(null);
    setPending(null);
    setError(null);
    setNotice(null);
    setChainPolicy(null);
    setChainDecision(null);
  }, []);

  const clearClipboard = useCallback(() => {
    setClipboard(EMPTY_CLIPBOARD);
  }, []);

  /**
   * Copy, with the decision applied to the clipboard rather than to the song.
   *
   * "Yalnız akoru kopyala" has to mean the clipboard does not carry a bond to
   * a note it left behind, or the next paste would produce a hammer-on leaning
   * on whatever happened to be in front of it.
   */
  const runCopy = useCallback(
    (policy: ChainPolicy | null) => {
      if (!selection) return;
      const result = copySelection(
        song,
        selection,
        policy === null ? {} : { chainPolicy: policy },
      );
      if (!result.ok) {
        setError(transformMessage(result.error.code));
        return;
      }
      // Reading changes nothing: no commit, no write, no undo step.
      setClipboard(result.clipboard);
      setError(null);
      setNotice("Seçim kopyalandı.");
      /*
       * And it says so. A copy is a real production command with a real
       * event; what makes it read-only is `mutating: false` and two equal
       * fingerprints, not the absence of an announcement (§13).
       */
      const fingerprint = songFingerprint(song);
      publishWorkspaceEdit({
        action: "copy",
        scope: "notes",
        mutating: false,
        songBefore: fingerprint,
        songAfter: fingerprint,
        sectionId: selection.sectionId,
        trackIds: [selection.trackId],
        startTicks: selection.startTicks,
        endTicks: selection.endTicks,
        barKeys: [],
      });
    },
    [selection, song],
  );

  const runApply = useCallback(
    (target: TransformCommand, policy: ChainPolicy | null): boolean => {
      if (!selection) return false;
      const withPolicy = policy === null ? {} : { chainPolicy: policy };

      const result = applyTransform(
        store.getSnapshot().song,
        selection,
        target,
        withPolicy,
      );
      if (!result.ok) {
        // A refusal touches neither the store nor the history.
        setError(transformMessage(result.error.code));
        return false;
      }

      // Cut fills the clipboard only once the commit has actually happened.
      if (target.kind === "cut_selection") {
        const read = copySelection(store.getSnapshot().song, selection, withPolicy);
        if (read.ok) setClipboard(read.clipboard);
      }

      // One commit, and it says what it was — that is the sentence the undo
      // control will read back to the reader.
      const before = store.getSnapshot().song;
      const committed = store.commit(result.song, {
        kind: "selection_transform",
        command: target.kind,
      });
      /*
       * Announced only if the commit actually landed (§13). A refused write —
       * a full disk, a song from a newer version — has changed nothing, and
       * an event for it would be the acceptance round passing a step the
       * reader's music never took.
       */
      if (committed) {
        publishWorkspaceEdit({
          action: editActionOf(target.kind),
          scope: "notes",
          mutating: true,
          songBefore: songFingerprint(before),
          songAfter: songFingerprint(result.song),
          sectionId: selection.sectionId,
          trackIds: [selection.trackId],
          startTicks: selection.startTicks,
          endTicks: selection.endTicks,
          barKeys: [],
        });
      }
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
    [selection, store],
  );

  /*
   * The gate, on every way in.
   *
   * `stage`, `apply` and `copy` all pass through here, so there is no action
   * that can start without the decision having been made. Asking at *stage*
   * time rather than at apply time is deliberate: the ghost a reader nudges
   * around has to be the real one, and a ghost computed before the policy
   * exists could only be a refusal.
   */
  const gate = useCallback(
    (command: TransformCommand, then: ChainDecision["then"]): boolean => {
      if (needsDecision() && impact !== null) {
        setChainDecision({ command, then, impact });
        setError(null);
        return false;
      }
      return true;
    },
    [impact, needsDecision],
  );

  const stage = useCallback(
    (command: TransformCommand | null) => {
      if (command === null) {
        setPending(null);
        return;
      }
      if (!gate(command, "stage")) return;
      setPending(command);
    },
    [gate],
  );

  const apply = useCallback(
    (command?: TransformCommand): boolean => {
      const target = command ?? pending;
      if (!selection || !target) return false;
      if (!gate(target, "apply")) return false;
      return runApply(target, chainPolicy);
    },
    [chainPolicy, gate, pending, runApply, selection],
  );

  const copy = useCallback(() => {
    if (!selection) return;
    if (!gate({ kind: "copy_selection" }, "copy")) return;
    runCopy(chainPolicy);
  }, [chainPolicy, gate, runCopy, selection]);

  /**
   * The reader decided. Remember it, and resume exactly what was waiting.
   *
   * Resuming rather than asking the reader to press the button again is the
   * difference between a decision and an interruption.
   */
  const chooseChainPolicy = useCallback(
    (policy: ChainPolicy) => {
      setChainPolicy(policy);
      const waiting = chainDecision;
      setChainDecision(null);
      if (!waiting) return;
      if (waiting.then === "stage") {
        setPending(waiting.command);
        return;
      }
      if (waiting.then === "copy") {
        runCopy(policy);
        return;
      }
      runApply(waiting.command, policy);
    },
    [chainDecision, runApply, runCopy],
  );

  /** "Vazgeç": the song, the clipboard, storage and the history all untouched. */
  const cancelChainDecision = useCallback(() => {
    setChainDecision(null);
    setPending(null);
  }, []);

  return {
    selection,
    summary,
    impact,
    chainPolicy,
    chainDecision,
    chooseChainPolicy,
    cancelChainDecision,
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
    stage,
    apply,
    previewOf: runPreview,
  };
}

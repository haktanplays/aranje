/**
 * What a covered run offers while the reader is writing (K-59 §3).
 *
 * The compact selection toolbar shows four verbs and keeps the rest behind a
 * drawer. Which handle each verb calls is a fact about the selection session,
 * not about the row that draws them — and the composition root is not the
 * place to spell nine callbacks out, because that is exactly how a root grows
 * back into the file everything lived in (K-47).
 *
 * Every verb here is a handle that already existed. Nothing new is staged, no
 * command is invented, and this file writes nothing: it names the calls.
 */
import type { IntentComposer } from "@/lib/workspace/use-intent-composer";
import type { SelectionSession } from "@/lib/workspace/use-selection-session";

/** Everything the selection toolbar can ask for. */
export type SelectionActions = {
  readonly notice: string | null;
  readonly error: string | null;
  /** The legato brush's own door; owned by the edit area, which has it open. */
  onConnect(): void;
  onMove(): void;
  onContinue(): void;
  onCopy(): void;
  onCut(): void;
  onDuplicate(): void;
  onRepeat(): void;
  onDelete(): void;
};

/** The one line the edit header says about a covered run, and its way out. */
export type SelectionHeader = { readonly summary: string; onCancel(): void };

function selectionHeader(input: CoveredRunInput): SelectionHeader | null {
  if (!input.editing || !input.time.handle.selection) return null;
  return {
    summary: input.time.handle.summary?.text ?? "Seçim",
    onCancel: input.time.clear,
  };
}

/** All of it except the door, which only the edit area can open. */
export type SelectionVerbs = Omit<SelectionActions, "onConnect">;

/** One answer for both places a covered run appears while writing. */
export type CoveredRun = {
  readonly header: SelectionHeader;
  readonly verbs: SelectionVerbs;
};

export type CoveredRunInput = {
  readonly editing: boolean;
  readonly time: SelectionSession["time"];
  /** Only `pick` is used: "Devam" picks the pattern tool up, nothing else. */
  readonly composer: Pick<IntentComposer, "pick">;
};

export function coveredRun(input: CoveredRunInput): CoveredRun | null {
  const header = selectionHeader(input);
  const verbs = selectionVerbs(input);
  return header && verbs ? { header, verbs } : null;
}

function selectionVerbs(input: CoveredRunInput): SelectionVerbs | null {
  const { time } = input;
  if (!input.editing || !time.handle.selection) return null;
  return {
    notice: time.handle.notice ?? null,
    error: time.handle.error ?? null,
    onMove: () => time.openSheet("move"),
    onContinue: () =>
      input.composer.pick({ kind: "continue_pattern", mode: "repeat" }),
    // Reading only: no commit, no write, no undo step.
    onCopy: time.handle.copy,
    onCut: () => time.handle.apply({ kind: "cut_selection" }),
    onDuplicate: () => time.handle.apply({ kind: "duplicate_selection" }),
    onRepeat: () => time.openSheet("repeat"),
    onDelete: () => time.handle.apply({ kind: "delete_selection" }),
  };
}

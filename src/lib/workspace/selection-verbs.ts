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
import {
  offeredVerbs,
  selectionCapabilities,
  type SelectionVerb,
  type VerbOffer,
} from "@/lib/song/selection-capability";
import { describeTimeSelection } from "@/lib/song/selection-descriptor";
import type { Song } from "@/lib/song/schema";
import type { SelectionSession } from "@/lib/workspace/use-selection-session";

/** Everything the selection toolbar can ask for. */
export type SelectionActions = {
  readonly notice: string | null;
  readonly error: string | null;
  /**
   * What this selection may be asked to do, computed once (2U-A §3).
   *
   * The drawer draws what is offered and greys what is disabled, with the
   * reason the model gave. It does not decide for itself — a screen that
   * works out whether a run can be joined by counting notes will offer
   * "Bağla" on one note the day the counting is off by one.
   */
  readonly offers: readonly VerbOffer[];
  /** True while "Devam" is waiting for the reader to say where to reach to. */
  readonly extendArmed: boolean;
  /** The legato brush's own door; owned by the edit area, which has it open. */
  onConnect(): void;
  onMove(): void;
  onContinue(): void;
  onCopy(): void;
  onCut(): void;
  onPaste(): void;
  onDuplicate(): void;
  onRepeat(): void;
  onDelete(): void;
};

/** Which verb each drawer entry runs, so the two lists cannot drift apart. */
export const DRAWER_VERBS: readonly {
  readonly key: keyof SelectionActions;
  readonly verb: SelectionVerb;
}[] = [
  { key: "onCopy", verb: "copy" },
  { key: "onCut", verb: "cut" },
  /*
   * "Yapıştır" was missing from this list, and that was the whole of the
   * founder's clipboard defect (2U-B §3). The capability model had been
   * offering it correctly all along — a range clipboard on an empty target
   * answers `available`, deliberately ahead of the "no notes selected" rule —
   * but the drawer draws this list, so a verb absent here can never appear
   * however loudly the model offers it. Copying worked, the notice appeared,
   * and then the one verb that would use it was not on the menu.
   */
  { key: "onPaste", verb: "paste" },
  { key: "onDuplicate", verb: "duplicate" },
  { key: "onRepeat", verb: "repeat" },
  { key: "onDelete", verb: "delete" },
];

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
  /** Read to describe the selection; never written through. */
  readonly song: Song;
};

export function coveredRun(input: CoveredRunInput): CoveredRun | null {
  const header = selectionHeader(input);
  const verbs = selectionVerbs(input);
  return header && verbs ? { header, verbs } : null;
}

function selectionVerbs(input: CoveredRunInput): SelectionVerbs | null {
  const { time } = input;
  if (!input.editing || !time.handle.selection) return null;

  const descriptor = describeTimeSelection(input.song, time.handle.selection);
  const section = input.song.sections.find(
    (entry) => entry.id === time.handle.selection?.sectionId,
  );
  const offers = descriptor
    ? offeredVerbs(
        selectionCapabilities(descriptor, {
          hasClipboard: time.handle.hasClipboard,
          /* The time clipboard only ever holds a run of notes. */
          clipboardScope: time.handle.hasClipboard ? "range" : null,
          sectionBarCount: section?.bars.length ?? 0,
        }),
      )
    : [];

  return {
    notice: time.handle.notice ?? null,
    error: time.handle.error ?? null,
    offers,
    extendArmed: time.extendArmed,
    onMove: () => time.openSheet("move"),
    /*
     * "Devam" reaches from the end of what is held (2U-A §3).
     *
     * It used to pick up the pattern-continuation composer tool. That tool is
     * not lost — it is one tap away behind the Ritim door, where it has been
     * since K-59 — but a verb sitting on a selection toolbar should do
     * something to the selection, and "carry on from here" is the one reach a
     * covered run needs that its two handles cannot give it: on a one-slot
     * selection they are 34px apart and a finger cannot pick between them.
     */
    onContinue: time.toggleExtend,
    // Reading only: no commit, no write, no undo step.
    onCopy: time.handle.copy,
    onCut: () => time.handle.apply({ kind: "cut_selection" }),
    /* Stages and previews; the write happens at "Uygula" in the sheet. */
    onPaste: time.pasteHere,
    onDuplicate: () => time.handle.apply({ kind: "duplicate_selection" }),
    onRepeat: () => time.openSheet("repeat"),
    onDelete: () => time.handle.apply({ kind: "delete_selection" }),
  };
}

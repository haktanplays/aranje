/**
 * What each acceptance step requires, said exactly once (§3).
 *
 * ## The defect this replaces
 *
 * The round's expectations used to live as small strings on the step list,
 * and everything else — the question screen's status line, the "Sonraki adım"
 * gate, the evidence checklist, the result formatter and the browser runner —
 * re-derived what a step meant from its own reading of them. Three
 * consequences, all measured on `b039d9c`:
 *
 * 1. Read-only steps were expressed as `no_write`, so the gate passed them the
 *    instant the step opened. A fresh session reported "Editör kanıtı geldi."
 *    on step 1 before the reader had touched anything.
 * 2. Step 10's title said "Sil, sonra geri al" while its gate required a redo,
 *    because the two sentences were written in different places.
 * 3. The result could say a second instrument was heard while the row for the
 *    question said "ölçülmedi", because the summary was computed from the
 *    fixture rather than from the row.
 *
 * So the contract becomes one typed value per step, and instruction, gate,
 * checklist and report all read *this*. Changing what a step means is one
 * edit, and the four surfaces cannot drift apart because there is nothing for
 * them to drift from.
 *
 * ## The rule the contracts encode
 *
 * Every step demands **positive evidence that its action happened**. Not one
 * of them is satisfied by an absence. "Nothing was written" is still checked,
 * and still matters — it is how we know the round did not touch the reader's
 * own project — but it lives in the isolation record, where an invariant
 * belongs, and it can no longer complete anything.
 */
import type { WorkspaceEditAction } from "@/lib/song/workspace-events";
import { heardWithTracks, type WitnessFacts } from "@/lib/acceptance/production-witness";
import type { BatchTrace } from "@/lib/acceptance/batch-steps";

/**
 * The evidence a step is waiting for.
 *
 * Split by *what kind of thing must be observed* rather than by step number,
 * so two steps that need the same proof share one branch and one test.
 */
export type StepContract =
  /** A selection was drawn, then reached forward from the same start. */
  | { readonly kind: "selection_extended" }
  /** A real range was held and the surface offered both listening verbs. */
  | { readonly kind: "actions_revealed" }
  /** A one-shot audition of the selection started and finished. */
  | { readonly kind: "auditioned" }
  /** A selection loop started, came round, and was turned off. */
  | { readonly kind: "looped" }
  /** Playback ran, paused with a still tick, and resumed forward. */
  | { readonly kind: "paused_resumed" }
  /** An audition whose track filter was exactly one instrument (11A). */
  | { readonly kind: "listen_one_track" }
  /** An audition whose track filter carried every instrument (11B). */
  | { readonly kind: "listen_all_tracks" }
  /** One committed edit of this action, and nothing else. */
  | { readonly kind: "one_write"; readonly action: WorkspaceEditAction }
  /** Written, then taken back to the exact bytes it started on. */
  | { readonly kind: "undo_restores"; readonly action: WorkspaceEditAction }
  /** Written, taken back, and put forward again onto the written bytes. */
  | { readonly kind: "redo_returns"; readonly action: WorkspaceEditAction }
  /**
   * Deliberately survey-only: there is no action, only a question.
   *
   * Named rather than reached by omission, so a step that has no contract
   * because nobody wrote one cannot be mistaken for a step that is meant to
   * have none. The closing step is the only member and it says so.
   */
  | { readonly kind: "survey_only" };

/** One line of the checklist the reader reads while they work. */
export type ContractItem = {
  readonly id: string;
  readonly label: string;
  readonly present: boolean;
};

/**
 * Whether a step's isolation invariant is "this writes" or "this must not".
 *
 * Kept beside the contract and reported beside it, never mixed into it.
 */
export type WritingContract = Extract<
  StepContract,
  { kind: "one_write" | "undo_restores" | "redo_returns" }
>;

export function writesSong(contract: StepContract): contract is WritingContract {
  return (
    contract.kind === "one_write" ||
    contract.kind === "undo_restores" ||
    contract.kind === "redo_returns"
  );
}

const ACTION_LABELS: Readonly<Record<string, string>> = {
  paste: "«Yapıştır» ile nota eklendi",
  duplicate: "«Çoğalt» yapıldı",
  move: "«Taşı» yapıldı",
  repeat: "«Tekrarla» yapıldı",
  delete: "«Sil» yapıldı",
  copy: "«Kopyala» yapıldı",
  cut: "«Kes» yapıldı",
};

const wrote = (trace: BatchTrace, action: string): boolean =>
  trace.events.some((event) => event.mutating && event.action === action);

/**
 * The checklist for a step, every line derived from something observed.
 *
 * The order is the order the reader produces the evidence in, so the first
 * unticked line is always the next thing to do.
 */
export function contractItems(
  contract: StepContract,
  trace: BatchTrace,
  facts: WitnessFacts,
): readonly ContractItem[] {
  switch (contract.kind) {
    case "survey_only":
      return [];
    case "selection_extended":
      return [
        { id: "held", label: "Bir seçim oluştu", present: facts.selectionHeld },
        {
          id: "extended",
          label: "Seçimin sonu ileri taşındı",
          present: facts.selectionExtended,
        },
      ];
    case "actions_revealed":
      return [
        { id: "held", label: "Bir nota aralığı seçildi", present: facts.selectionHeld },
        {
          id: "verbs",
          label: "«Seçimi dinle» ve «Seçimden döngü» göründü",
          present: facts.listenOffered,
        },
      ];
    case "auditioned":
      return [
        { id: "started", label: "Seçim çalmaya başladı", present: facts.auditionStarted },
        { id: "ended", label: "Seçimin sonunda durdu", present: facts.auditionEnded },
      ];
    case "looped":
      return [
        { id: "started", label: "Seçim döngüsü başladı", present: facts.loopStarted },
        { id: "round", label: "Döngü başa döndü", present: facts.loopTraversed },
        { id: "stopped", label: "Döngü kapatıldı", present: facts.loopStopped },
      ];
    case "paused_resumed":
      return [
        { id: "played", label: "Çalma başladı", present: facts.played },
        { id: "paused", label: "Duraklatıldı", present: facts.paused },
        {
          id: "still",
          label: "Duraklarken playhead yerinde kaldı",
          present: facts.tickHeldWhilePaused,
        },
        { id: "resumed", label: "Aynı yerden devam etti", present: facts.resumedForward },
      ];
    case "listen_one_track":
      return [
        {
          id: "one",
          label: "Tek enstrümanla bir dinleme yapıldı",
          present: facts.listenFilters.some((filter) => filter.length === 1),
        },
      ];
    case "listen_all_tracks":
      return [
        {
          id: "all",
          label: "Birden fazla enstrümanla bir dinleme yapıldı",
          present: facts.listenFilters.some((filter) => filter.length >= 2),
        },
      ];
    default:
      return writeItems(contract, trace);
  }
}

function writeItems(
  contract: WritingContract,
  trace: BatchTrace,
): readonly ContractItem[] {
  const states = trace.states;
  const first = states[0];
  const written = states[1];
  const last = states[states.length - 1];
  const moved = (trace.revisions[trace.revisions.length - 1] ?? 0) - (trace.revisions[0] ?? 0);

  const items: ContractItem[] = [
    {
      id: "edit",
      label: ACTION_LABELS[contract.action] ?? "Değişiklik yapıldı",
      present: wrote(trace, contract.action) && states.length >= 2 && moved >= 1,
    },
  ];
  if (contract.kind === "one_write") return items;

  items.push({
    id: "undo",
    label: "«Geri al» ile eski hâline dönüldü",
    present: states.length >= 3 && first !== undefined && states.slice(1).includes(first),
  });
  if (contract.kind === "undo_restores") return items;

  items.push({
    id: "redo",
    label: "«İleri al» ile değişiklik yeniden geldi",
    present:
      states.length >= 4 && written !== undefined && last === written && last !== first,
  });
  return items;
}

/**
 * Is this step's contract satisfied?
 *
 * Every branch is an `every`, and `survey_only` is the one contract with
 * nothing to satisfy — which is why it is written out rather than falling
 * through to a default that would quietly pass anything unrecognised.
 */
export function contractMet(
  contract: StepContract,
  trace: BatchTrace,
  facts: WitnessFacts,
): boolean {
  if (contract.kind === "survey_only") return true;
  return contractItems(contract, trace, facts).every((item) => item.present);
}

/**
 * Did the isolation invariant hold for this step?
 *
 * Reported next to the contract, never folded into it. A read-only step that
 * somehow wrote is a defect worth seeing, and a step that wrote exactly what
 * it promised is not evidence that the reader did anything.
 */
export function isolationHeld(contract: StepContract, trace: BatchTrace): boolean {
  const moved = (trace.revisions[trace.revisions.length - 1] ?? 0) - (trace.revisions[0] ?? 0);
  return writesSong(contract) ? true : trace.states.length <= 1 && moved === 0;
}

/** The exact set of instruments 11A/11B asked the engine for, if any. */
export function scopeFilterFor(
  contract: StepContract,
  facts: WitnessFacts,
): readonly string[] | null {
  if (contract.kind === "listen_one_track") {
    return facts.listenFilters.find((filter) => filter.length === 1) ?? null;
  }
  if (contract.kind === "listen_all_tracks") {
    return facts.listenFilters.find((filter) => filter.length >= 2) ?? null;
  }
  return null;
}

export { heardWithTracks };

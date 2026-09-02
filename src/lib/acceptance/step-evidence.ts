/**
 * Which piece of evidence a step is still waiting for (2V-B.2 §3).
 *
 * ## The dead end this exists to end
 *
 * The founder reached step 10 on a physical phone and could not leave it. The
 * instruction said *delete, then undo*; the gate required *delete, then undo,
 * then redo*, because the ledger's `redoHash` column is fed by that third
 * press. Both were defensible on their own. Together they produced a screen
 * with a disabled button, no sound, no error and nothing at all to read — so
 * the only available conclusion was that the test had frozen.
 *
 * A gate that cannot be satisfied is bad; a gate that cannot be *understood*
 * is worse, because the reader cannot even tell you what stopped them. So the
 * judgement is no longer a single boolean: the same trace that decides whether
 * a step passed also says, one line at a time, which parts arrived and which
 * are still missing.
 *
 * ## Why this is not simply the shortfall list
 *
 * `judgeBatchStep` names what is *wrong*, which is the right shape for a
 * report and the wrong shape for a person mid-task. "redo_did_not_return"
 * tells a reader nothing about what to press. This names the whole sequence —
 * including the parts already done — so the screen reads as progress with a
 * next action rather than as a failure with no exit.
 */
import type { BatchExpectation, BatchTrace } from "@/lib/acceptance/batch-steps";

export type EvidenceItem = {
  /** Stable, for tests and for the report. */
  readonly id: string;
  /** What the reader has to do, in their words. */
  readonly label: string;
  readonly present: boolean;
};

/**
 * Did a mutating event of the required action arrive?
 *
 * The same predicate `judgeBatchStep` uses, so the checklist and the gate
 * cannot disagree about whether the edit happened.
 */
function wrote(trace: BatchTrace, action: string): boolean {
  return trace.events.some((event) => event.mutating && event.action === action);
}

/**
 * The evidence this step is built from, in the order the reader produces it.
 *
 * Every item is derived from the trace, never from a press: an item that went
 * true because a button was tapped would be the button-press defect that this
 * whole acceptance model exists to avoid.
 */
export function stepEvidence(
  expect: BatchExpectation,
  trace: BatchTrace,
): readonly EvidenceItem[] {
  if (expect.kind === "no_write") {
    return [
      {
        id: "nothing_written",
        label: "Hiçbir şey yazılmadı",
        present: trace.states.length <= 1,
      },
    ];
  }

  const states = trace.states;
  const first = states[0];
  const written = states[1];
  const last = states[states.length - 1];

  const items: EvidenceItem[] = [
    {
      id: "edit",
      label: EDIT_LABELS[expect.action] ?? "Değişiklik yapıldı",
      present: wrote(trace, expect.action) && states.length >= 2,
    },
  ];

  if (expect.kind === "undo_restores" || expect.kind === "redo_returns") {
    items.push({
      id: "undo",
      label: "«Geri al» ile eski hâline döndü",
      present:
        states.length >= 3 && first !== undefined && states.slice(1).includes(first),
    });
  }

  if (expect.kind === "redo_returns") {
    items.push({
      id: "redo",
      label: "«İleri al» ile değişiklik geri geldi",
      present:
        states.length >= 4 &&
        written !== undefined &&
        last === written &&
        last !== first,
    });
  }

  return items;
}

/**
 * The verb each write step is waiting for, said the way the button says it.
 *
 * A reader looking for "duplicate" on a Turkish screen finds nothing; they
 * find "Çoğalt". The map is exhaustive over the actions the round's steps
 * actually require, and anything else falls back to a general sentence rather
 * than showing an English command name.
 */
const EDIT_LABELS: Readonly<Record<string, string>> = {
  paste: "«Yapıştır» ile nota eklendi",
  duplicate: "«Çoğalt» yapıldı",
  move: "«Taşı» yapıldı",
  repeat: "«Tekrarla» yapıldı",
  delete: "«Sil» yapıldı",
  copy: "«Kopyala» yapıldı",
  cut: "«Kes» yapıldı",
};

/** What is still missing, for a screen that has to say so. */
export function missingEvidence(
  expect: BatchExpectation,
  trace: BatchTrace,
): readonly EvidenceItem[] {
  return stepEvidence(expect, trace).filter((item) => !item.present);
}

/**
 * One sentence naming the next thing to press, or null when nothing is due.
 *
 * Deliberately the *first* missing item rather than all of them: a reader who
 * has not deleted yet cannot act on "and then redo", and a screen that lists
 * three pending things at once reads as three problems instead of one step.
 */
export function nextEvidenceHint(
  expect: BatchExpectation,
  trace: BatchTrace,
): string | null {
  const missing = missingEvidence(expect, trace);
  const next = missing[0];
  if (!next) return null;
  if (next.id === "redo") {
    /*
     * The one the founder actually hit, and the one whose name is not in the
     * instruction it belongs to. Worth saying in full rather than as a
     * checklist line.
     */
    return "Bu adım «İleri al»ı da bekliyor: notaları geri aldıktan sonra ileri al'a dokun.";
  }
  if (next.id === "undo") return "Bu adım «Geri al»a dokunmanı bekliyor.";
  if (next.id === "nothing_written") {
    return "Bu adımda bir şey yazıldı; bu adım yalnızca dinleme/seçme adımı.";
  }
  return `Bu adım şunu bekliyor: ${next.label}.`;
}

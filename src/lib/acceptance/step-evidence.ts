/**
 * Which piece of evidence a step is still waiting for (2V-B.2 §3, 2V-B.2c §3).
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
 * ## What changed underneath it
 *
 * The list itself now comes from `step-contract.ts`, which is the one place a
 * step's requirements are written. This module used to keep its own copy, and
 * two copies of "what does step 10 need" is how the title and the gate came
 * to disagree in the first place. What is left here is the part that is
 * genuinely this file's own: turning the first unmet requirement into a
 * sentence a person can act on.
 */
import { contractItems, type ContractItem } from "@/lib/acceptance/step-contract";
import { EMPTY_WITNESS, type WitnessFacts } from "@/lib/acceptance/production-witness";
import type { BatchExpectation, BatchTrace } from "@/lib/acceptance/batch-steps";

export type EvidenceItem = ContractItem;

/**
 * The evidence this step is built from, in the order the reader produces it.
 *
 * Every item is derived from the trace or from observed production state,
 * never from a press: an item that went true because a button was tapped
 * would be the button-press defect this whole acceptance model exists to
 * avoid — and an item that went true because *nothing happened* was the
 * defect Codex measured on `b039d9c`.
 */
export function stepEvidence(
  expect: BatchExpectation,
  trace: BatchTrace,
  facts: WitnessFacts = EMPTY_WITNESS,
): readonly EvidenceItem[] {
  return contractItems(expect, trace, facts);
}

/** What is still missing, for a screen that has to say so. */
export function missingEvidence(
  expect: BatchExpectation,
  trace: BatchTrace,
  facts: WitnessFacts = EMPTY_WITNESS,
): readonly EvidenceItem[] {
  return stepEvidence(expect, trace, facts).filter((item) => !item.present);
}

/**
 * One sentence naming the next thing to do, or null when nothing is due.
 *
 * Deliberately the *first* missing item rather than all of them: a reader who
 * has not deleted yet cannot act on "and then redo", and a screen that lists
 * three pending things at once reads as three problems instead of one step.
 */
export function nextEvidenceHint(
  expect: BatchExpectation,
  trace: BatchTrace,
  facts: WitnessFacts = EMPTY_WITNESS,
): string | null {
  const next = missingEvidence(expect, trace, facts)[0];
  if (!next) return null;
  if (next.id === "redo") {
    /*
     * The one the founder actually hit. Its name is now in the step's title
     * too, but the sentence stays: a title is read once and a gate is read
     * every time the button refuses.
     */
    return "Bu adım «İleri al»ı da bekliyor: notaları geri aldıktan sonra ileri al'a dokun.";
  }
  if (next.id === "undo") return "Bu adım «Geri al»a dokunmanı bekliyor.";
  return `Bu adım şunu bekliyor: ${next.label}.`;
}

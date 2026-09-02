/**
 * The canonical row for every step, and the only thing a summary may read
 * (2V-B.2c §2 rule 8, §3 steps 9, 11 and 13).
 *
 * ## The contradiction this replaces
 *
 * The report Codex copied off `b039d9c` said, in one block:
 *
 * ```
 * 11B filtresi: ölçülmedi
 * İkinci enstrüman duyuldu: evet
 * measureScope … cevap: allScopeTogether=—
 * ```
 *
 * Three sentences about one question, disagreeing, because three different
 * places computed them: the row read the answers, the filter line read the
 * scope recording, and the hearing line read a boolean the page had derived
 * from the fixture having two tracks. None of them was lying on its own
 * terms. Together they told a founder that somebody had heard something in a
 * run where nobody had been asked.
 *
 * So there is one row per step, built once, and every count, heading and
 * summary line in the block is a projection of those rows. A number that
 * disagrees with a row is now impossible to write, because there is nothing
 * else to write it from.
 *
 * ## The two axes, kept apart
 *
 * A row carries a **technical evidence state** and a **human outcome**, and
 * they never substitute for each other (§2 rules 3 and 4). A reader answering
 * "Evet" moves `human`; it cannot move `evidence`. A production event
 * arriving moves `evidence`; it cannot answer a question. A row where the two
 * disagree is not a bug in the model — it is the most informative row the
 * round can produce, and it is printed as two columns so it stays visible.
 */
import {
  BATCH_BROKEN,
  BATCH_STEPS,
  isBatchHedged,
  type BatchAnswers,
  type BatchShortfall,
  type BatchStep,
} from "@/lib/acceptance/batch-steps";
import { contractItems } from "@/lib/acceptance/step-contract";
import { EMPTY_WITNESS } from "@/lib/acceptance/production-witness";

/**
 * What the page knows about a step's production evidence.
 *
 * Five named states rather than a boolean, because the four ways a step can
 * fail to be `valid` need four different sentences, and the one that used to
 * be missing — "reached, nothing arrived" — is the one a false green hides in.
 */
export type EvidenceState =
  /** The step was reached and the evidence it needs has not arrived. */
  | "pending"
  /** Every item the contract asks for was observed. */
  | "valid"
  /** Events arrived and were rejected: wrong build, session, song or action. */
  | "refused"
  /** Evidence arrived and contradicted the contract, or isolation broke. */
  | "failed"
  /** The round stopped before this step was reached. Never attempted. */
  | "blocked";

/** Whether the round left the reader's own project alone, on this step. */
export type IsolationState = "held" | "broken" | "not_measured";

/** What the person said, which is a different axis from what was measured. */
export type HumanOutcome =
  /** At least one of this step's questions has no answer. */
  | "unanswered"
  /** Every question answered, none of them the named broken answer. */
  | "confirmed"
  /** Answered, with at least one "kısmen"-shaped answer. */
  | "hedged"
  /** The reader named the product doing the wrong thing. */
  | "broken";

/** What the round recorded about one step, as it left it. */
export type StepState = {
  readonly evidence: EvidenceState;
  readonly isolation: IsolationState;
};

export type StepRow = {
  readonly id: string;
  readonly title: string;
  /** What this step required, in words, taken from the one contract registry. */
  readonly required: string;
  readonly evidence: EvidenceState;
  readonly isolation: IsolationState;
  readonly human: HumanOutcome;
  /** Every question of this step with the answer given, or "—". */
  readonly answers: string;
  /**
   * True for the one step that asks for no gesture.
   *
   * Carried on the row rather than re-derived from the wording, so the block
   * can say "gerekmiyor" instead of "geldi" — a closing question that
   * reported evidence as having arrived would be claiming, in the report's
   * own vocabulary, that something was done.
   */
  readonly survey: boolean;
};

/** The Turkish the block prints for each evidence state. */
export const EVIDENCE_TEXT: Readonly<Record<EvidenceState, string>> = {
  pending: "gelmedi",
  valid: "geldi",
  refused: "REDDEDİLDİ",
  failed: "ÇELİŞTİ",
  blocked: "denenmedi",
};

export const ISOLATION_TEXT: Readonly<Record<IsolationState, string>> = {
  held: "yazma yok",
  broken: "YAZMA VAR",
  not_measured: "ölçülmedi",
};

export const HUMAN_TEXT: Readonly<Record<HumanOutcome, string>> = {
  unanswered: "cevaplanmadı",
  confirmed: "onayladı",
  hedged: "kararsız",
  broken: "BOZUK dedi",
};

/**
 * What a step requires, said once, from the contract registry.
 *
 * Not a hand-written table. The block used to keep its own map from step id
 * to a phrase, which is how it came to print "yazma yok → geçti" for eight
 * steps: the phrase said the requirement was an absence because the
 * expectation said so, and both were wrong in the same place.
 */
const EMPTY_TRACE = { states: [], revisions: [], events: [] } as const;

export function requiredText(step: BatchStep): string {
  const items = contractItems(step.expect, EMPTY_TRACE, EMPTY_WITNESS);
  if (items.length === 0) return "eylem yok, yalnız soru";
  return items.map((item) => item.label).join(" + ");
}

/**
 * The evidence state of a step the round has finished with.
 *
 * The order matters and is the model's core rule: `valid` is reachable only
 * by having every contract item present, and nothing about an absence, a
 * press or an answer appears in this function at all.
 */
export function evidenceStateOf(input: {
  /** Did the reader ever arrive at this step? */
  readonly reached: boolean;
  readonly passed: boolean;
  readonly shortfalls: readonly BatchShortfall[];
  /** Production events that arrived for this step and were rejected (§13). */
  readonly refusals: number;
}): EvidenceState {
  if (!input.reached) return "blocked";
  if (input.passed) return "valid";
  /*
   * A shortfall other than "nothing arrived" is a contradiction, not a gap:
   * the song was written twice, an undo did not come back, a reading step
   * mutated the record. Those are `failed`, and they outrank a refusal
   * because they say something went wrong rather than something was ignored.
   */
  if (input.shortfalls.some((name) => name !== "no_production_event")) return "failed";
  if (input.refusals > 0) return "refused";
  return "pending";
}

/** What the reader said about a step, from their answers alone. */
export function humanOutcomeOf(step: BatchStep, answers: BatchAnswers): HumanOutcome {
  const given = step.questions.map((question) => ({
    id: question.id,
    value: answers[question.id] ?? null,
  }));
  if (given.length === 0) return "confirmed";
  if (given.some((entry) => entry.value === null || entry.value === "")) {
    return "unanswered";
  }
  if (given.some((entry) => entry.value === BATCH_BROKEN[entry.id])) return "broken";
  if (given.some((entry) => isBatchHedged(entry.value))) return "hedged";
  return "confirmed";
}

/**
 * The rows, one per step, in the order the round runs them.
 *
 * A step the round never recorded is `blocked` and `not_measured` — never
 * "held", because a step nobody reached wrote nothing for the same reason it
 * did nothing, and reporting that as a passed invariant is the exact mistake
 * this round exists to remove.
 */
export function buildStepRows(input: {
  readonly states: Readonly<Record<string, StepState | undefined>>;
  readonly answers: BatchAnswers;
}): readonly StepRow[] {
  return BATCH_STEPS.map((step) => {
    const state = input.states[step.id];
    return {
      id: step.id,
      title: step.title,
      required: requiredText(step),
      evidence: state?.evidence ?? "blocked",
      isolation: state?.isolation ?? "not_measured",
      human: humanOutcomeOf(step, input.answers),
      survey: step.expect.kind === "survey_only",
      answers:
        step.questions
          .map((question) => `${question.id}=${input.answers[question.id] ?? "—"}`)
          .join(", ") || "—",
    };
  });
}

/** A step counts as measured only when its evidence actually arrived. */
export function measuredFromRows(
  rows: readonly StepRow[],
): Readonly<Record<string, boolean | null>> {
  const out: Record<string, boolean | null> = {};
  for (const row of rows) {
    out[row.id] = row.evidence === "blocked" ? null : row.evidence === "valid";
  }
  return out;
}

/**
 * Ways the block could contradict itself, checked rather than trusted.
 *
 * Every name here is a sentence that appeared, or could have appeared, in the
 * report Codex measured. They are computed from the finished rows and the
 * finished verdict, so a future edit that reintroduces a parallel boolean has
 * to get past a check that reads only the rows.
 *
 * Returns the violated names; an honest report returns nothing.
 */
export function reportInvariants(input: {
  readonly rows: readonly StepRow[];
  readonly verdict: string;
  /** The hearing line's word, exactly as the block will print it (§3 step 12). */
  readonly heard: string;
}): readonly string[] {
  const broken: string[] = [];
  const row = (id: string) => input.rows.find((entry) => entry.id === id);

  /* Rule 1: an absence never completes anything. */
  if (input.rows.some((entry) => entry.evidence === "valid" && entry.isolation !== "held")) {
    broken.push("valid_without_isolation");
  }
  /* Rule 6: a stopped run keeps what it measured and passes nothing else. */
  if (input.verdict === "PASS" && input.rows.some((entry) => entry.evidence !== "valid")) {
    broken.push("pass_with_unproven_step");
  }
  if (
    input.verdict === "BLOCKED" &&
    !input.rows.some((entry) => entry.evidence === "blocked")
  ) {
    broken.push("blocked_without_unreached_step");
  }
  /* Rule 9: a perception is reported only where a person supplied one. */
  const hearing = row("measureScope");
  if (hearing && hearing.human === "unanswered" && input.heard !== "ölçülmedi") {
    broken.push("hearing_without_answer");
  }
  if (hearing && hearing.human !== "unanswered" && input.heard === "ölçülmedi") {
    broken.push("answer_without_hearing");
  }
  return broken;
}

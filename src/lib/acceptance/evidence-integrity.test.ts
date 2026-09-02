/**
 * The harness may not pass an action that never happened (2V-B.2 §2).
 *
 * ## What these reproduce
 *
 * Codex opened the deployed route on `b039d9c`, reloaded to a fresh session
 * (`2vb1-ba67fwv4`), performed **none** of step 1's instructed actions — no
 * power chord, no long press, no «Devam», no extension — and the question
 * screen already said "Editör kanıtı geldi." and "✓ Hiçbir şey yazılmadı".
 * Two presses of "Evet" then enabled "Sonraki adım".
 *
 * The same reload showed steps 3, 4 and 5 reported as technically passed
 * ("ölçüm: yazma yok → geçti") though no audition, loop or pause ever ran;
 * and an early-finish report that correctly said `BLOCKED` with 11B
 * "ölçülmedi" also said "İkinci enstrüman duyuldu: evet".
 *
 * Every test in this file is written against the *rule*, not against the
 * current implementation, and each one fails on the tree that produced that
 * run. They are the contract the rest of this round is built to satisfy.
 */
import { describe, expect, it } from "vitest";

import {
  BATCH_STEPS,
  batchVerdict,
  judgeBatchStep,
  type BatchEnvironment,
  type BatchTrace,
} from "@/lib/acceptance/batch-steps";
import { stepEvidence } from "@/lib/acceptance/step-evidence";

/** The trace a step has the instant it opens, before the reader does anything. */
const untouched = (): BatchTrace =>
  ({
    states: ["s0"],
    revisions: [1],
    history: [1],
    writes: [0],
    events: [],
  }) as BatchTrace;

describe("a step that was never performed is never passed", () => {
  it("refuses every step that has an action, on an untouched trace", () => {
    /*
     * The measured false positive. Read-only steps were expressed as
     * `no_write` and judged by "nothing was written", which is true of a step
     * nobody has touched — so eight of the thirteen passed on arrival.
     *
     * `survey_only` is the single deliberate exemption and is named rather
     * than reached by omission: step 12 asks a question and has nothing for
     * the reader to do. Everything else must be earned.
     */
    const acting = BATCH_STEPS.filter((step) => step.expect.kind !== "survey_only");
    expect(acting.length).toBe(BATCH_STEPS.length - 1);
    for (const step of acting) {
      const judgement = judgeBatchStep(step.expect, untouched());
      expect(judgement.passed, `${step.id} passed with no action`).toBe(false);
    }
  });

  it("exempts exactly one step, and says so in its own contract", () => {
    const survey = BATCH_STEPS.filter((step) => step.expect.kind === "survey_only");
    expect(survey.map((step) => step.id)).toEqual(["finish"]);
  });

  it("shows no evidence as present before anything is done", () => {
    /* The checklist said "✓ Hiçbir şey yazılmadı" on arrival, which reads as
       a completed requirement rather than an isolation fact. */
    for (const step of BATCH_STEPS) {
      if (step.expect.kind === "survey_only") continue;
      const items = stepEvidence(step.expect, untouched());
      for (const item of items) {
        expect(item.present, `${step.id}/${item.id} present with no action`).toBe(
          false,
        );
      }
    }
  });
});

describe("hearing is only ever what the founder said", () => {
  const base = (): BatchEnvironment => ({
    touchPoints: 0,
    consoleErrors: [],
    userStorageBefore: "x",
    userStorageAfter: "x",
    measured: {},
    trackScopeFilter: ["gtr"],
    measureScopeFilter: ["gtr", "bass"],
  });

  it("does not turn an unanswered 11B into a PASS", () => {
    /* The environment carried `secondTrackAudible` derived from the fixture
       having two tracks, so the report claimed a perception nobody supplied. */
    expect(batchVerdict({ ...base(), endedEarly: true }, {})).toBe("BLOCKED");
  });
});

describe("step 10 says one thing everywhere", () => {
  it("names the redo in its title, because the gate requires it", () => {
    const step = BATCH_STEPS.find((entry) => entry.id === "deleteUndo");
    expect(step).toBeDefined();
    expect(step!.expect.kind).toBe("redo_returns");
    /* The contract measured is delete → undo → redo; the title said only
       "Sil, sonra geri al", which is the mismatch that stranded the founder. */
    expect(step!.title).toContain("ileri al");
  });
});

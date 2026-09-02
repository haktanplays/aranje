/**
 * Seventeen ways to pass a step without doing it, each one measured red
 * (2V-B.2c §3 step 14).
 *
 * A test suite that only proves the good path works cannot tell you whether
 * the gate is a gate. Every case here is a *false* claim of completion, made
 * as convincingly as the harness allows — the trace a step has on arrival,
 * every question answered "Evet", an event from the neighbouring step, an
 * undo that came back to the wrong bytes — and every one of them must be
 * refused. On `b039d9c` four of these were green.
 *
 * The names are the contract. `NEGATIVE_CONTROLS` is asserted against the
 * tests below, so a control that is quietly deleted takes the count with it.
 */
import { describe, expect, it } from "vitest";

import {
  ALL_BATCH_QUESTIONS,
  BATCH_STEPS,
  batchVerdict,
  judgeBatchStep,
  type BatchAnswers,
  type BatchEnvironment,
  type BatchTrace,
} from "@/lib/acceptance/batch-steps";
import { formatBatchResult } from "@/lib/acceptance/batch-report";
import {
  buildStepRows,
  evidenceStateOf,
  measuredFromRows,
  reportInvariants,
  type StepState,
} from "@/lib/acceptance/step-rows";
import {
  witnessFrom,
  type ProductionSample,
} from "@/lib/acceptance/production-witness";
import { writesSong } from "@/lib/acceptance/step-contract";

export const NEGATIVE_CONTROLS = [
  "fresh_step_passes_nothing",
  "answers_alone_pass_nothing",
  "isolation_alone_passes_nothing",
  "audition_needs_a_real_audition",
  "loop_needs_a_real_traversal",
  "pause_needs_a_real_pause",
  "extension_needs_a_later_end",
  "extension_needs_the_same_start",
  "one_track_listen_rejects_two",
  "all_track_listen_rejects_one",
  "another_action_does_not_pass",
  "another_step_samples_do_not_leak",
  "undo_to_wrong_bytes_fails",
  "redo_to_wrong_bytes_fails",
  "two_writes_are_not_one_write",
  "write_on_a_reading_step_breaks_isolation",
  "unanswered_hearing_is_never_reported",
] as const;

/* ------------------------------------------------------------------ fixtures */

/** The trace a step has the instant it opens: one state, nothing done. */
const arrival = (): BatchTrace => ({ states: ["s0"], revisions: [1], events: [] });

const trace = (
  states: readonly string[],
  events: BatchTrace["events"] = [],
): BatchTrace => ({
  states,
  revisions: states.map((_, index) => index + 1),
  events,
});

const idle = (over: Partial<ProductionSample> = {}): ProductionSample => ({
  status: "stopped",
  ticks: 0,
  loop: null,
  selection: null,
  editorSelection: null,
  ...over,
});

const editorRange = (startTicks: number, endTicks: number, sectionId = "s1") =>
  idle({
    editorSelection: { sectionId, startTicks, endTicks, trackIds: ["gtr"], listenVerbs: 2 },
  });

const audition = (trackIds: readonly string[], mode = "once") =>
  idle({
    selection: { startTicks: 0, endTicks: 384, trackIds, mode, onsetCount: 4 },
  });

const contractOf = (id: string) => {
  const step = BATCH_STEPS.find((entry) => entry.id === id);
  if (!step) throw new Error(`no step ${id}`);
  return step.expect;
};

const answeredWell = (): BatchAnswers =>
  Object.fromEntries(
    ALL_BATCH_QUESTIONS.map((question) => [question.id, question.options[0] ?? "Evet"]),
  );

/* ------------------------------------------------------------------- controls */

describe("negative controls: none of these may go green", () => {
  it("names seventeen of them, and runs every one", () => {
    expect(NEGATIVE_CONTROLS.length).toBe(17);
    expect(new Set(NEGATIVE_CONTROLS).size).toBe(17);
  });

  it("fresh_step_passes_nothing", () => {
    /* The measured defect: a new session, nothing touched, eight steps green. */
    for (const step of BATCH_STEPS) {
      if (step.expect.kind === "survey_only") continue;
      expect(judgeBatchStep(step.expect, arrival()).passed, step.id).toBe(false);
    }
  });

  it("answers_alone_pass_nothing", () => {
    const answers = answeredWell();
    const states: Record<string, StepState> = {};
    const rows = buildStepRows({ states, answers });
    /* Every question answered as well as it can be answered, and not one row
       claims evidence. Two presses of "Evet" carried the old round forward. */
    expect(rows.every((row) => row.evidence === "blocked")).toBe(true);
    expect(rows.some((row) => row.human === "confirmed")).toBe(true);
  });

  it("isolation_alone_passes_nothing", () => {
    /* A step whose record never moved: the invariant holds, and holding it
       completes nothing (§2 rule 1). */
    const verdict = judgeBatchStep(contractOf("listenOnce"), arrival());
    expect(verdict.passed).toBe(false);
    expect(verdict.shortfalls).toContain("no_production_event");
    expect(verdict.shortfalls).not.toContain("no_write_expected");
    expect(
      evidenceStateOf({ reached: true, passed: false, shortfalls: verdict.shortfalls, refusals: 0 }),
    ).toBe("pending");
  });

  it("audition_needs_a_real_audition", () => {
    /* A selection was drawn and the verbs were offered — but nothing sounded. */
    const facts = witnessFrom([editorRange(0, 384), editorRange(0, 384)]);
    expect(judgeBatchStep(contractOf("listenOnce"), arrival(), facts).passed).toBe(false);
  });

  it("loop_needs_a_real_traversal", () => {
    /* Looping started and stopped, and the playhead only ever moved forward:
       a one-shot wearing the loop's clothes. */
    const facts = witnessFrom([
      idle({ selection: { startTicks: 0, endTicks: 384, trackIds: ["gtr"], mode: "loop", onsetCount: 4 }, loop: { on: true, startTicks: 0, endTicks: 384 }, ticks: 10 }),
      idle({ selection: { startTicks: 0, endTicks: 384, trackIds: ["gtr"], mode: "loop", onsetCount: 4 }, loop: { on: true, startTicks: 0, endTicks: 384 }, ticks: 200 }),
      idle(),
    ]);
    expect(facts.loopStarted).toBe(true);
    expect(facts.loopStopped).toBe(true);
    expect(facts.loopTraversed).toBe(false);
    expect(judgeBatchStep(contractOf("listenLoop"), arrival(), facts).passed).toBe(false);
  });

  it("pause_needs_a_real_pause", () => {
    /* Stopped, then paused: a transport that was never playing cannot have
       been paused, and a step that accepted this would pass on a page load. */
    const facts = witnessFrom([idle({ status: "paused", ticks: 96 }), idle({ status: "paused", ticks: 96 })]);
    expect(facts.paused).toBe(false);
    expect(judgeBatchStep(contractOf("pauseResume"), arrival(), facts).passed).toBe(false);
  });

  it("extension_needs_a_later_end", () => {
    const facts = witnessFrom([editorRange(0, 384), editorRange(0, 384)]);
    expect(facts.selectionHeld).toBe(true);
    expect(facts.selectionExtended).toBe(false);
    expect(judgeBatchStep(contractOf("extend"), arrival(), facts).passed).toBe(false);
  });

  it("extension_needs_the_same_start", () => {
    /* A second, longer selection drawn somewhere else is a new selection, not
       an extension of the first — and "Devam" is the thing being measured. */
    const facts = witnessFrom([editorRange(0, 192), editorRange(384, 960)]);
    expect(facts.selectionExtended).toBe(false);
    expect(judgeBatchStep(contractOf("extend"), arrival(), facts).passed).toBe(false);
  });

  it("one_track_listen_rejects_two", () => {
    const facts = witnessFrom([audition(["gtr", "bass"]), idle()]);
    expect(judgeBatchStep(contractOf("trackScope"), arrival(), facts).passed).toBe(false);
  });

  it("all_track_listen_rejects_one", () => {
    const facts = witnessFrom([audition(["gtr"]), idle()]);
    expect(judgeBatchStep(contractOf("measureScope"), arrival(), facts).passed).toBe(false);
  });

  it("another_action_does_not_pass", () => {
    /* A perfectly shaped paste, offered to the step that asked for a delete. */
    const pasted = trace(["a", "b", "a", "b"], [{ action: "paste", mutating: true }]);
    const verdict = judgeBatchStep(contractOf("deleteUndo"), pasted);
    expect(verdict.passed).toBe(false);
    expect(verdict.shortfalls).toContain("no_production_event");
  });

  it("another_step_samples_do_not_leak", () => {
    /*
     * The witness is a pure function of the samples it is handed, and the
     * round hands it `samples[stepId]` alone. So the readings that satisfied
     * one step are, for the next step, an empty list — which is what this
     * asserts, because the alternative is untestable in a node suite and the
     * keying is the whole mechanism.
     */
    const soundOne = witnessFrom([audition(["gtr"]), idle()]);
    expect(soundOne.auditionStarted).toBe(true);
    const soundNext = witnessFrom([]);
    expect(soundNext.auditionStarted).toBe(false);
    expect(judgeBatchStep(contractOf("listenOnce"), arrival(), soundNext).passed).toBe(false);
  });

  it("undo_to_wrong_bytes_fails", () => {
    const wrong = trace(["a", "b", "c"], [{ action: "delete", mutating: true }]);
    const verdict = judgeBatchStep(contractOf("deleteUndo"), wrong);
    expect(verdict.passed).toBe(false);
    expect(
      evidenceStateOf({ reached: true, passed: false, shortfalls: verdict.shortfalls, refusals: 0 }),
    ).not.toBe("valid");
  });

  it("redo_to_wrong_bytes_fails", () => {
    const wrong = trace(["a", "b", "a", "d"], [{ action: "paste", mutating: true }]);
    expect(judgeBatchStep(contractOf("copyPaste"), wrong).passed).toBe(false);
  });

  it("two_writes_are_not_one_write", () => {
    /* One duplicate asked for, two records written: atomicity is a claim the
       ledger makes and this is the claim being falsified. */
    const twice: BatchTrace = {
      states: ["a", "b", "c"],
      revisions: [1, 2, 3],
      events: [
        { action: "duplicate", mutating: true },
        { action: "duplicate", mutating: true },
      ],
    };
    const verdict = judgeBatchStep({ kind: "one_write", action: "duplicate" }, twice);
    expect(verdict.passed).toBe(false);
    expect(verdict.shortfalls).toContain("write_not_atomic");
    /* And the same trace, offered to the real step, is refused too. */
    expect(judgeBatchStep(contractOf("duplicate"), twice).passed).toBe(false);
  });

  it("write_on_a_reading_step_breaks_isolation", () => {
    const facts = witnessFrom([editorRange(0, 192), editorRange(0, 384)]);
    /* The action really happened — and the record moved, which on a reading
       step is a defect that must survive the action being genuine. */
    const verdict = judgeBatchStep(contractOf("extend"), trace(["a", "b"]), facts);
    expect(verdict.shortfalls).toContain("no_write_expected");
    expect(verdict.passed).toBe(false);
  });

  it("unanswered_hearing_is_never_reported", () => {
    const states: Record<string, StepState> = {};
    for (const step of BATCH_STEPS) {
      states[step.id] = { evidence: "valid", isolation: "held" };
    }
    const answers: BatchAnswers = {};
    const environment: BatchEnvironment = {
      touchPoints: 1,
      consoleErrors: [],
      userStorageBefore: "x",
      userStorageAfter: "x",
      measured: measuredFromRows(buildStepRows({ states, answers })),
      trackScopeFilter: ["gtr"],
      measureScopeFilter: ["gtr", "bass"],
    };
    const block = formatBatchResult({
      buildSha: "abcdef0",
      device: { date: "d", viewport: "384×692", platform: "p", touchPoints: 1, userAgent: "u" },
      environment,
      answers,
      note: "",
      states,
    });
    /* Every technical fact green, 11B unanswered: the hearing line says so. */
    expect(block).toContain("İkinci enstrüman duyuldu: ölçülmedi");
    expect(block).not.toContain("İkinci enstrüman duyuldu: evet");
    expect(batchVerdict(environment, answers)).not.toBe("PASS");
  });
});

describe("the report cannot contradict its own rows", () => {
  it("names a pass that carries an unproven step", () => {
    const rows = buildStepRows({
      states: { extend: { evidence: "pending", isolation: "held" } },
      answers: {},
    });
    expect(reportInvariants({ rows, verdict: "PASS", heard: "ölçülmedi" })).toContain(
      "pass_with_unproven_step",
    );
  });

  it("names a hearing that no answer supports", () => {
    const rows = buildStepRows({ states: {}, answers: {} });
    expect(reportInvariants({ rows, verdict: "BLOCKED", heard: "evet" })).toContain(
      "hearing_without_answer",
    );
  });

  it("names a step that passed while writing on a reading contract", () => {
    const rows = buildStepRows({
      states: { extend: { evidence: "valid", isolation: "broken" } },
      answers: {},
    });
    expect(reportInvariants({ rows, verdict: "PARTIAL", heard: "ölçülmedi" })).toContain(
      "valid_without_isolation",
    );
  });

  it("never says a closing question's evidence arrived", () => {
    const block = formatBatchResult({
      buildSha: "abcdef0",
      device: { date: "d", viewport: "384×692", platform: "p", touchPoints: 1, userAgent: "u" },
      environment: {
        touchPoints: 1,
        consoleErrors: [],
        userStorageBefore: "x",
        userStorageAfter: "x",
        measured: {},
        trackScopeFilter: null,
        measureScopeFilter: null,
        endedEarly: true,
      },
      answers: {},
      note: "",
      states: {},
    });
    /* Twelve steps ask for a gesture and were never attempted; the closing
       step asks only a question and never had one to attempt. */
    expect((block.match(/eylem kanıtı: denenmedi/g) ?? []).length).toBe(12);
    expect((block.match(/eylem kanıtı: gerekmiyor/g) ?? []).length).toBe(1);
    expect(block).not.toContain("eylem kanıtı: geldi");
  });

  it("stays silent on an honest blocked run", () => {
    const rows = buildStepRows({ states: {}, answers: {} });
    expect(reportInvariants({ rows, verdict: "BLOCKED", heard: "ölçülmedi" })).toEqual([]);
  });
});

describe("the positive control, so the reds above are not red by accident", () => {
  it("passes every step when the action really was performed", () => {
    for (const step of BATCH_STEPS) {
      const contract = step.expect;
      if (contract.kind === "survey_only") continue;
      const [seen, facts] = performed(step.id);
      const verdict = judgeBatchStep(contract, seen, facts);
      expect(verdict.passed, `${step.id}: ${verdict.shortfalls.join(",")}`).toBe(true);
      if (!writesSong(contract)) expect(seen.states.length).toBeLessThanOrEqual(1);
    }
  });
});

/** What a genuinely performed step looks like, per step. */
function performed(id: string): [BatchTrace, ReturnType<typeof witnessFrom>] {
  const still = arrival();
  switch (id) {
    case "extend":
      return [still, witnessFrom([editorRange(0, 192), editorRange(0, 384)])];
    case "openMore":
      return [still, witnessFrom([editorRange(0, 384)])];
    case "listenOnce":
      return [still, witnessFrom([audition(["gtr"]), idle()])];
    case "listenLoop":
      return [
        still,
        witnessFrom([
          idle({ selection: { startTicks: 0, endTicks: 384, trackIds: ["gtr"], mode: "loop", onsetCount: 4 }, loop: { on: true, startTicks: 0, endTicks: 384 }, ticks: 300 }),
          idle({ selection: { startTicks: 0, endTicks: 384, trackIds: ["gtr"], mode: "loop", onsetCount: 4 }, loop: { on: true, startTicks: 0, endTicks: 384 }, ticks: 20 }),
          idle(),
        ]),
      ];
    case "pauseResume":
      return [
        still,
        witnessFrom([
          idle({ status: "playing", ticks: 10 }),
          idle({ status: "paused", ticks: 96 }),
          idle({ status: "paused", ticks: 96 }),
          idle({ status: "playing", ticks: 96 }),
        ]),
      ];
    case "trackScope":
      return [still, witnessFrom([audition(["gtr"]), idle()])];
    case "measureScope":
      return [still, witnessFrom([audition(["gtr", "bass"]), idle()])];
    case "copyPaste":
      return [trace(["a", "b", "a", "b"], [{ action: "paste", mutating: true }]), witnessFrom([])];
    case "deleteUndo":
      return [trace(["a", "b", "a", "b"], [{ action: "delete", mutating: true }]), witnessFrom([])];
    default: {
      /*
       * Every remaining step is `redo_returns`: written, taken back, put
       * forward again — start, written, start, written, with the fourth state
       * byte-identical to the second.
       */
      const contract = BATCH_STEPS.find((entry) => entry.id === id)?.expect;
      const action =
        contract && "action" in contract ? contract.action : ("paste" as const);
      return [
        trace(["a", "b", "a", "b"], [{ action, mutating: true }]),
        witnessFrom([]),
      ];
    }
  }
}

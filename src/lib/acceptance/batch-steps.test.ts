/**
 * The step model, the answers and what completes a step (2V-B.1 §13, §14).
 */
import { describe, expect, it } from "vitest";

import {
  ALL_BATCH_QUESTIONS,
  BATCH_BROKEN,
  BATCH_STEPS,
  batchVerdict,
  isBatchHedged,
  judgeBatchStep,
  stepAnswered,
  type BatchAnswers,
  type BatchEnvironment,
  type BatchTrace,
} from "@/lib/acceptance/batch-steps";

const trace = (
  states: readonly string[],
  revisions: readonly number[],
  events: BatchTrace["events"] = [],
): BatchTrace => ({ states, revisions, events });

const pasted = [{ action: "paste" as const, mutating: true }];
const deleted = [{ action: "delete" as const, mutating: true }];

describe("the steps themselves", () => {
  it("has one screen per step and never two questions about one gesture", () => {
    expect(BATCH_STEPS.length).toBeGreaterThanOrEqual(12);
    const ids = BATCH_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("splits the two listening scopes into two steps", () => {
    /*
     * One step asking about two gestures is why the last round could not
     * tell whether the measure heading and the track row used different
     * filters (§14). Two steps, two measurements.
     */
    const track = BATCH_STEPS.find((step) => step.id === "trackScope");
    const measure = BATCH_STEPS.find((step) => step.id === "measureScope");
    expect(track?.questions.map((question) => question.id)).toEqual([
      "trackScopeOnly",
    ]);
    expect(measure?.questions.map((question) => question.id)).toEqual([
      "allScopeTogether",
    ]);
    expect(track?.questions[0]?.prompt).toBe("Yalnız gitarı mı duydun?");
    expect(measure?.questions[0]?.prompt).toBe("Gitar ve bası birlikte mi duydun?");
    /* The second one needs a bar two instruments really play in. */
    expect(measure?.passage).toBe("shared_bar");
  });

  it("no longer asks the founder to audit duplicate action ownership", () => {
    expect(ALL_BATCH_QUESTIONS.map((question) => question.id)).not.toContain(
      "moreNoDuplicate",
    );
  });

  it("asks the delete step in the words the round specified", () => {
    const step = BATCH_STEPS.find((entry) => entry.id === "deleteUndo");
    expect(step?.questions[0]?.prompt).toBe("Aynı notalar aynı yere geri geldi mi?");
  });

  it("names a required action on every writing step", () => {
    for (const step of BATCH_STEPS) {
      if (step.expect.kind === "no_write") continue;
      expect(step.expect.action).toBeTruthy();
    }
  });

  it("gives every breaking question a named broken answer that it offers", () => {
    for (const question of ALL_BATCH_QUESTIONS) {
      if (!question.breaking) continue;
      const broken = BATCH_BROKEN[question.id];
      expect(broken).toBeTruthy();
      expect(question.options).toContain(broken);
    }
  });
});

describe("no answer starts filled in", () => {
  it("counts a step unanswered until every question has a value", () => {
    expect(stepAnswered("listenOnce", {})).toBe(false);
    expect(
      stepAnswered("listenOnce", { onceStart: "Evet", onceScope: "Evet" }),
    ).toBe(false);
    expect(
      stepAnswered("listenOnce", {
        onceStart: "Evet",
        onceScope: "Evet",
        onceEnd: "Evet",
      }),
    ).toBe(true);
  });

  it("treats an explicitly cleared answer as unanswered", () => {
    expect(stepAnswered("duplicate", { duplicatePlaced: null })).toBe(false);
    expect(stepAnswered("duplicate", { duplicatePlaced: "" })).toBe(false);
  });

  it("keeps one step's answer out of another step", () => {
    /* Every question id is unique, so an answer cannot key into two steps. */
    const ids = ALL_BATCH_QUESTIONS.map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("what completes a step", () => {
  it("passes a reading step on a still record and nothing else", () => {
    expect(judgeBatchStep({ kind: "no_write" }, trace(["a"], [1])).passed).toBe(true);
    expect(judgeBatchStep({ kind: "no_write" }, trace(["a", "b"], [1, 2])).passed).toBe(
      false,
    );
  });

  it("refuses a write step with no production event at all", () => {
    /*
     * The trace looks perfect: one new state, revision up by one. Without
     * the editor having said what it did, this is a song that changed for
     * reasons nobody recorded — which is exactly what "the bytes changed"
     * could not tell apart (§13).
     */
    const verdict = judgeBatchStep(
      { kind: "one_write", action: "duplicate" },
      trace(["a", "b"], [1, 2]),
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.shortfalls).toContain("no_production_event");
  });

  it("refuses a write step whose event was a different action", () => {
    const verdict = judgeBatchStep(
      { kind: "one_write", action: "duplicate" },
      trace(["a", "b"], [1, 2], pasted),
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.shortfalls).toContain("wrong_action");
  });

  it("passes a write step when the record and the editor agree", () => {
    const verdict = judgeBatchStep(
      { kind: "one_write", action: "paste" },
      trace(["a", "b"], [1, 2], pasted),
    );
    expect(verdict.passed).toBe(true);
    expect(verdict.shortfalls).toEqual([]);
  });

  it("refuses a write step whose record moved twice", () => {
    const verdict = judgeBatchStep(
      { kind: "one_write", action: "paste" },
      trace(["a", "b", "c"], [1, 2, 3], pasted),
    );
    expect(verdict.shortfalls).toContain("write_not_atomic");
  });

  it("requires an undo step to come back byte-identical", () => {
    expect(
      judgeBatchStep(
        { kind: "undo_restores", action: "delete" },
        trace(["a", "b", "a"], [1, 2, 3], deleted),
      ).passed,
    ).toBe(true);
    expect(
      judgeBatchStep(
        { kind: "undo_restores", action: "delete" },
        trace(["a", "b", "c"], [1, 2, 3], deleted),
      ).shortfalls,
    ).toContain("undo_did_not_restore");
  });

  it("requires a redo step to return to the written bytes", () => {
    expect(
      judgeBatchStep(
        { kind: "redo_returns", action: "paste" },
        trace(["a", "b", "a", "b"], [1, 2, 3, 4], pasted),
      ).passed,
    ).toBe(true);
    expect(
      judgeBatchStep(
        { kind: "redo_returns", action: "paste" },
        trace(["a", "b", "a", "c"], [1, 2, 3, 4], pasted),
      ).shortfalls,
    ).toContain("redo_did_not_return");
  });

  it("cannot be passed by pressing a button", () => {
    /* Nothing was done. Every writing step fails, and says why. */
    for (const step of BATCH_STEPS) {
      if (step.expect.kind === "no_write") continue;
      const verdict = judgeBatchStep(step.expect, trace(["a"], [1]));
      expect(verdict.passed).toBe(false);
      expect(verdict.shortfalls).toContain("no_production_event");
    }
  });
});

describe("the verdict", () => {
  const clean: BatchEnvironment = {
    touchPoints: 5,
    consoleErrors: [],
    userStorageBefore: "x",
    userStorageAfter: "x",
    measured: Object.fromEntries(BATCH_STEPS.map((step) => [step.id, true])),
    trackScopeFilter: ["gtr"],
    measureScopeFilter: ["gtr", "bass"],
    secondTrackAudible: true,
  };
  const allAnswered: BatchAnswers = Object.fromEntries(
    ALL_BATCH_QUESTIONS.map((question) => [
      question.id,
      question.options.find((option) => option !== BATCH_BROKEN[question.id]) ?? "Evet",
    ]),
  );

  it("passes a complete run on a real touch device", () => {
    expect(batchVerdict(clean, allAnswered)).toBe("PASS");
  });

  it("never passes without touch", () => {
    expect(batchVerdict({ ...clean, touchPoints: 0 }, allAnswered)).toBe("PARTIAL");
  });

  it("fails when the two listening scopes used the same filter", () => {
    /*
     * Both founder answers can be "yes" here, and both can be honest: two
     * gestures that send the same music to the engine sound the same. Only
     * the page can tell (§14).
     */
    expect(
      batchVerdict(
        { ...clean, measureScopeFilter: ["gtr"] },
        allAnswered,
      ),
    ).toBe("FAIL");
  });

  it("fails when the second instrument turns out to be silent", () => {
    expect(batchVerdict({ ...clean, secondTrackAudible: false }, allAnswered)).toBe(
      "FAIL",
    );
  });

  it("stays partial until both filters have been measured", () => {
    expect(batchVerdict({ ...clean, measureScopeFilter: null }, allAnswered)).toBe(
      "PARTIAL",
    );
  });

  it("fails on a device write, a console error, or a broken step", () => {
    expect(batchVerdict({ ...clean, userStorageAfter: "y" }, allAnswered)).toBe("FAIL");
    expect(batchVerdict({ ...clean, consoleErrors: ["boom"] }, allAnswered)).toBe(
      "FAIL",
    );
    expect(
      batchVerdict(
        { ...clean, measured: { ...clean.measured, move: false } },
        allAnswered,
      ),
    ).toBe("FAIL");
  });

  it("fails when a founder says the product did the wrong thing", () => {
    expect(
      batchVerdict(clean, { ...allAnswered, deleteCameBack: "Hayır" }),
    ).toBe("FAIL");
  });

  it("is partial while any question is unanswered", () => {
    const missing = { ...allAnswered };
    delete missing.onceStart;
    expect(batchVerdict(clean, missing)).toBe("PARTIAL");
  });
});

describe("hedged answers", () => {
  it("names the middle options and nothing else", () => {
    expect(isBatchHedged("Kısmen")).toBe(true);
    expect(isBatchHedged("Emin değilim")).toBe(true);
    expect(isBatchHedged("Biraz")).toBe(true);
    expect(isBatchHedged("Evet")).toBe(false);
    expect(isBatchHedged(null)).toBe(false);
  });
});

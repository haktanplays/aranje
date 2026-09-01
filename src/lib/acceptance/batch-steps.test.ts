/**
 * The batched founder round, and what it refuses to call a pass (2V-B §9, §12).
 *
 * The rule this file exists for: pressing "Sonraki" without doing the step
 * must not count. Three rounds have now been reported green by a run in which
 * the thing being tested never happened — a paste that was never applied, a
 * guide phase satisfied by touching nothing — so every writing step is judged
 * against a trace of the project record rather than against a founder's tick.
 */
import { describe, expect, it } from "vitest";

import {
  ALL_BATCH_QUESTIONS,
  BATCH_BROKEN,
  BATCH_STEPS,
  batchVerdict,
  judgeBatchStep,
  type BatchAnswers,
  type BatchEnvironment,
} from "@/lib/acceptance/batch-steps";
import { formatBatchResult } from "@/lib/acceptance/batch-report";

const trace = (states: readonly string[], revisions: readonly number[]) => ({
  states,
  revisions,
});

const allMeasured = (value: boolean | null) =>
  Object.fromEntries(BATCH_STEPS.map((step) => [step.id, value]));

const goodAnswers = (): BatchAnswers =>
  Object.fromEntries(
    ALL_BATCH_QUESTIONS.map((question) => [question.id, question.options[0]!]),
  );

const environment = (over: Partial<BatchEnvironment> = {}): BatchEnvironment => ({
  touchPoints: 5,
  consoleErrors: [],
  userStorageBefore: "seed",
  userStorageAfter: "seed",
  measured: allMeasured(true),
  ...over,
});

describe("the guide is twelve short steps in the reader's own words", () => {
  it("has at most twelve of them", () => {
    expect(BATCH_STEPS.length).toBeLessThanOrEqual(12);
    expect(BATCH_STEPS.length).toBe(12);
  });

  it("gives every step one task and something to notice", () => {
    for (const step of BATCH_STEPS) {
      expect(step.task.trim().length, step.id).toBeGreaterThan(0);
      /* One sentence, so a screen is one thing to do. */
      expect(step.task.split(".").filter((part) => part.trim()).length, step.id)
        .toBeLessThanOrEqual(2);
    }
  });

  it("never says a technical word", () => {
    const forbidden =
      /tick|slot|scope|descriptor|capability|scheduler|schema|validator|commit|revision|byte/i;
    for (const step of BATCH_STEPS) {
      expect(`${step.title} ${step.task} ${step.watchFor}`, step.id).not.toMatch(
        forbidden,
      );
      for (const question of step.questions) {
        expect(question.prompt, question.id).not.toMatch(forbidden);
      }
    }
  });

  it("names the production controls the reader has to find", () => {
    const words = BATCH_STEPS.map((step) => step.task).join(" ");
    for (const control of [
      "Devam",
      "Daha fazla",
      "Seçimi dinle",
      "Seçimden döngü",
      "Kopyala",
      "Çoğalt",
      "Taşı",
      "Tekrarla",
      "Sil",
      "Geri al",
      "Bu enstrüman",
      "Tüm enstrümanlar",
    ]) {
      expect(words, control).toContain(control);
    }
  });

  it("asks the founder only what a person can answer", () => {
    /*
     * §9: bytes, history and storage are the page's job. A question that asked
     * a founder to eyeball a diff would be a question nobody can answer
     * honestly, and the answer would go in the block as if they had.
     */
    for (const question of ALL_BATCH_QUESTIONS) {
      expect(question.prompt, question.id).not.toMatch(
        /kayıt|depola|geçmiş adım|bayt/i,
      );
    }
  });

  it("knows which answer means the product did the wrong thing", () => {
    for (const question of ALL_BATCH_QUESTIONS) {
      if (!question.breaking) continue;
      const broken = BATCH_BROKEN[question.id];
      expect(broken, question.id).toBeDefined();
      expect(question.options, question.id).toContain(broken);
      /* Never the first option, which is always the good one. */
      expect(question.options[0], question.id).not.toBe(broken);
    }
  });
});

describe("what the page measures for itself", () => {
  it("fails a no-write step that wrote", () => {
    expect(judgeBatchStep({ kind: "no_write" }, trace(["a"], [1]))).toBe(true);
    expect(judgeBatchStep({ kind: "no_write" }, trace(["a", "b"], [1, 2]))).toBe(false);
    /* Same bytes, new revision: a write that happened to be idempotent. */
    expect(judgeBatchStep({ kind: "no_write" }, trace(["a"], [1, 2]))).toBe(false);
  });

  it("fails a writing step where nothing happened", () => {
    /* Pressing "Sonraki" and nothing else. This is the whole rule. */
    for (const kind of ["one_write", "undo_restores", "redo_returns"] as const) {
      expect(judgeBatchStep({ kind }, trace(["a"], [1])), kind).toBe(false);
    }
  });

  it("wants exactly one commit from a single edit", () => {
    expect(judgeBatchStep({ kind: "one_write" }, trace(["a", "b"], [1, 2]))).toBe(true);
    /* Two states is two edits, and the step asked for one. */
    expect(judgeBatchStep({ kind: "one_write" }, trace(["a", "b", "c"], [1, 2, 3]))).toBe(
      false,
    );
    /* One state twice over is a preview, not a commit. */
    expect(judgeBatchStep({ kind: "one_write" }, trace(["a", "b"], [1, 1]))).toBe(false);
  });

  it("wants undo to land on the very bytes it started from", () => {
    expect(
      judgeBatchStep({ kind: "undo_restores" }, trace(["a", "b", "a"], [1, 2, 3])),
    ).toBe(true);
    /* Nearly-back is not back. */
    expect(
      judgeBatchStep({ kind: "undo_restores" }, trace(["a", "b", "c"], [1, 2, 3])),
    ).toBe(false);
    /* A deleted-then-retyped run is two edits, not an undo. */
    expect(judgeBatchStep({ kind: "undo_restores" }, trace(["a", "b"], [1, 2]))).toBe(
      false,
    );
  });

  it("wants redo to put back exactly what undo took", () => {
    expect(
      judgeBatchStep(
        { kind: "redo_returns" },
        trace(["a", "b", "a", "b"], [1, 2, 3, 4]),
      ),
    ).toBe(true);
    /* Ends somewhere else: redo did not restore the same music. */
    expect(
      judgeBatchStep(
        { kind: "redo_returns" },
        trace(["a", "b", "a", "c"], [1, 2, 3, 4]),
      ),
    ).toBe(false);
    /* Never came back at all. */
    expect(
      judgeBatchStep({ kind: "redo_returns" }, trace(["a", "b"], [1, 2])),
    ).toBe(false);
  });

  it("expects a write from exactly the steps that write", () => {
    const writing = BATCH_STEPS.filter((step) => step.expect.kind !== "no_write").map(
      (step) => step.id,
    );
    expect(writing).toEqual(["copyPaste", "duplicate", "move", "repeat", "deleteUndo"]);
  });
});

describe("the verdict", () => {
  it("passes only a real device with everything measured and answered", () => {
    expect(batchVerdict(environment(), goodAnswers())).toBe("PASS");
  });

  it("never calls a desktop a physical pass", () => {
    expect(batchVerdict(environment({ touchPoints: 0 }), goodAnswers())).toBe("PARTIAL");
  });

  it("fails on a step the page measured as broken", () => {
    expect(
      batchVerdict(
        environment({ measured: { ...allMeasured(true), duplicate: false } }),
        goodAnswers(),
      ),
    ).toBe("FAIL");
  });

  it("fails when the founder says the product did the wrong thing", () => {
    for (const question of ALL_BATCH_QUESTIONS.filter((entry) => entry.breaking)) {
      const answers = { ...goodAnswers(), [question.id]: BATCH_BROKEN[question.id]! };
      expect(batchVerdict(environment(), answers), question.id).toBe("FAIL");
    }
  });

  it("fails when the reader's own store moved", () => {
    expect(
      batchVerdict(environment({ userStorageAfter: "changed" }), goodAnswers()),
    ).toBe("FAIL");
  });

  it("fails on a console error", () => {
    expect(batchVerdict(environment({ consoleErrors: ["boom"] }), goodAnswers())).toBe(
      "FAIL",
    );
  });

  it("never passes a run with a skipped step", () => {
    /*
     * §12: "founder batch'i adım atlayarak PASS yapmak" is not a pass. A step
     * that was never measured leaves `null`, and `null` is not `true`.
     */
    expect(
      batchVerdict(
        environment({ measured: { ...allMeasured(true), move: null } }),
        goodAnswers(),
      ),
    ).toBe("PARTIAL");
  });

  it("never passes a run with an unanswered question", () => {
    const answers = { ...goodAnswers(), onceScope: null };
    expect(batchVerdict(environment(), answers)).toBe("PARTIAL");
  });
});

describe("the block a founder copies back", () => {
  const block = (over: Partial<BatchEnvironment> = {}, answers = goodAnswers()) =>
    formatBatchResult({
      buildSha: "abcdef1234567890",
      device: {
        date: "2026-09-01T10:00:00.000Z",
        viewport: "384×740",
        platform: "Linux armv8l",
        touchPoints: over.touchPoints ?? 5,
        userAgent: "test",
      },
      environment: environment(over),
      answers,
      note: "",
    });

  it("carries the build, the screen, the device and the verdict", () => {
    const text = block();
    expect(text).toContain("Build: abcdef1");
    expect(text).toContain("Ekran: 384×740");
    expect(text).toContain("Dokunma noktası: 5");
    expect(text).toContain("Verdict: PASS");
  });

  it("says a desktop is not a device, in the block itself", () => {
    const text = block({ touchPoints: 0 });
    expect(text).toContain("fiziksel cihaz kanıtı değildir");
    expect(text).toContain("Verdict: PARTIAL");
  });

  it("shows the page's measurement beside the founder's answer, per step", () => {
    const text = block({ measured: { ...allMeasured(true), deleteUndo: false } });
    for (const step of BATCH_STEPS) expect(text, step.id).toContain(step.title);
    expect(text).toContain("ölçüm:");
    expect(text).toContain("cevap:");
    expect(text).toContain("KALDI");
    expect(text).toContain("Verdict: FAIL");
  });

  it("never claims anything about how it sounded", () => {
    const text = block();
    expect(text).not.toMatch(/organik|ses kalitesi|daha iyi|gerçekçi/i);
  });

  it("counts the steps nobody measured", () => {
    const text = block({ measured: { ...allMeasured(true), repeat: null } });
    expect(text).toContain("Ölçülmemiş adım: 1");
  });
});

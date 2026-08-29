/**
 * What the page may say, and what it may never say (2U-A handoff §6, §9).
 *
 * The load-bearing test in this file is the last one. Everything else is
 * arithmetic; that one is the rule the whole handoff exists to protect.
 */
import { describe, expect, it } from "vitest";

import { versionGate } from "@/lib/acceptance/build-id";
import {
  ALL_QUESTIONS,
  automatedVerdict,
  formatEditorResult,
  type EditorObservations,
} from "@/lib/acceptance/editor-report";
import {
  ALL_CHECK_KEYS,
  EDITOR_STEPS,
  emptyChecks,
  stepVerdict,
} from "@/lib/acceptance/editor-steps";

const allTrue = () =>
  Object.fromEntries(ALL_CHECK_KEYS.map((key) => [key, true as const]));

const observations = (
  over: Partial<EditorObservations> = {},
): EditorObservations => ({
  checks: allTrue(),
  consoleErrors: [],
  userStorageBefore: "same",
  userStorageAfter: "same",
  ...over,
});

const allAnswered = () =>
  Object.fromEntries(ALL_QUESTIONS.map((question) => [question.id, "Evet"]));

const device = {
  date: "2026-08-29",
  viewport: "390x844",
  platform: "Android",
  touchPoints: 5,
  userAgent: "test",
};

describe("the seven steps", () => {
  it("are seven, each with a title, a phase and something to measure", () => {
    expect(EDITOR_STEPS).toHaveLength(7);
    for (const step of EDITOR_STEPS) {
      expect(step.title.length, step.id).toBeGreaterThan(3);
      expect(step.phases.length, step.id).toBeGreaterThan(0);
      expect(
        step.phases.length + step.standingChecks.length,
        step.id,
      ).toBeGreaterThan(0);
    }
  });

  /* One instruction per screen is the handoff's own shape, and it is also
   * what makes a per-operation measurement possible at all. */
  it("gives every phase one instruction and one expectation", () => {
    for (const step of EDITOR_STEPS) {
      for (const phase of step.phases) {
        expect(phase.text.length, phase.id).toBeGreaterThan(8);
        expect(phase.expect.kind, phase.id).toBeTruthy();
      }
    }
  });

  it("asks for a write exactly where an edit is expected", () => {
    const writes = EDITOR_STEPS.flatMap((step) =>
      step.phases.filter((phase) => phase.expect.kind === "one_write"),
    );
    /* Paste, eight movements, four measure ops and the multi-repeat. */
    expect(writes.length).toBeGreaterThanOrEqual(13);
  });

  it("never names one check twice", () => {
    expect(new Set(ALL_CHECK_KEYS).size).toBe(ALL_CHECK_KEYS.length);
  });

  it("asks a person only what a machine cannot answer", () => {
    expect(ALL_QUESTIONS.length).toBeGreaterThanOrEqual(3);
    for (const question of ALL_QUESTIONS) {
      expect(question.options.length, question.id).toBe(3);
      expect(question.prompt.endsWith("?"), question.id).toBe(true);
    }
  });

  /* Not attempted is its own answer, and is not a failure. */
  it("calls an untouched step pending, not failed", () => {
    const checks = emptyChecks();
    for (const step of EDITOR_STEPS) {
      expect(stepVerdict(step, checks), step.id).toBe("pending");
    }
  });

  it("calls a step with one false failure, however much else passed", () => {
    const step = EDITOR_STEPS[0]!;
    const checks = { ...allTrue(), [step.phases[0]!.id]: false };
    expect(stepVerdict(step, checks)).toBe("fail");
  });
});

describe("the automated verdict", () => {
  it("is PASS only when everything measured passed and every question answered", () => {
    expect(automatedVerdict(observations(), allAnswered())).toBe("PASS");
  });

  it("is PARTIAL when the measurements are clean but a question is open", () => {
    expect(automatedVerdict(observations(), {})).toBe("PARTIAL");
  });

  it("is PARTIAL when a step was never reached", () => {
    expect(
      automatedVerdict(observations({ checks: emptyChecks() }), allAnswered()),
    ).toBe("PARTIAL");
  });

  it("is FAIL on any measured break", () => {
    const checks = { ...allTrue(), undoByteEqual: false };
    expect(automatedVerdict(observations({ checks }), allAnswered())).toBe("FAIL");
  });

  /* The route's whole promise: it does not touch the reader's own music. */
  it("is FAIL when the device's own store moved at all", () => {
    expect(
      automatedVerdict(
        observations({ userStorageAfter: "different" }),
        allAnswered(),
      ),
    ).toBe("FAIL");
  });

  it("is FAIL when the page threw", () => {
    expect(
      automatedVerdict(observations({ consoleErrors: ["boom"] }), allAnswered()),
    ).toBe("FAIL");
  });
});

describe("the block that gets copied out", () => {
  const block = () =>
    formatEditorResult({
      gate: versionGate("5d2bb18", "5d2bb182eb1f10eda38462cfe89ef3ba67df700d"),
      device,
      observations: observations(),
      answers: allAnswered(),
      notes: "  ",
    });

  it("names the build and says the version was verified", () => {
    expect(block()).toContain("Build SHA: 5d2bb18 (beklenen sürüm doğrulandı)");
  });

  it("says plainly when no version was pinned", () => {
    const text = formatEditorResult({
      gate: versionGate(null, "abcdef1234567"),
      device,
      observations: observations(),
      answers: allAnswered(),
      notes: "",
    });
    expect(text).toContain("beklenen sürüm verilmedi");
  });

  it("carries every row the handoff asks for", () => {
    const text = block();
    for (const label of [
      "Devam:",
      "Kopyala/yapıştır:",
      "Undo/redo:",
      "Zamanda taşı:",
      "Perde taşı:",
      "Telde taşı:",
      "Nota/ölçü ayrımı:",
      "Ölçü işlemleri:",
      "Çoklu ölçü:",
      "UI Contract:",
      "User storage unchanged:",
      "Console errors:",
    ]) {
      expect(text, label).toContain(label);
    }
  });

  /*
   * The rows are the report; a check that no row names is a check nobody
   * reads. This is what stops a standing check being quietly orphaned.
   */
  it("gives every check a row that names it", () => {
    const text = formatEditorResult({
      gate: versionGate(null),
      device,
      observations: observations({
        checks: Object.fromEntries(ALL_CHECK_KEYS.map((key) => [key, false])),
      }),
      answers: allAnswered(),
      notes: "",
    });
    const reported = new Set(
      [...text.matchAll(/FAIL \(([^)]+)\)/g)].flatMap((match) =>
        match[1]!.split(", "),
      ),
    );
    const missing = ALL_CHECK_KEYS.filter(
      (key) =>
        !reported.has(key) &&
        /* These three are reported on their own lines, not inside a row. */
        !["noConsoleError", "userStorageUnchanged", "fixtureHasTwoTracks"].includes(key),
    );
    expect(missing).toEqual([]);
  });

  it("names the checks that failed, rather than only saying FAIL", () => {
    const text = formatEditorResult({
      gate: versionGate(null),
      device,
      observations: observations({ checks: { ...allTrue(), undoByteEqual: false } }),
      answers: allAnswered(),
      notes: "",
    });
    expect(text).toContain("Undo/redo: FAIL (undoByteEqual)");
  });

  it("turns an empty note into a dash rather than blank space", () => {
    expect(block()).toContain("Notlar: —");
  });

  /*
   * The rule the handoff repeats three times, and the one a future edit is
   * most likely to break by being helpful.
   */
  it("never writes a founder pass, however clean the automation is", () => {
    const text = block();
    expect(text).toContain("Automated verdict: PASS");
    expect(text).toContain("Founder verdict: Haktan doldurmadı");
    expect(text).not.toMatch(/Founder verdict:\s*(PASS|GEÇTİ|OK)/i);
  });
});

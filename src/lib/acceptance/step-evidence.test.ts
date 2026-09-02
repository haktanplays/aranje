/**
 * The step-10 dead end, and the screen that ends it (2V-B.2 §3).
 */
import { describe, expect, it } from "vitest";

import {
  missingEvidence,
  nextEvidenceHint,
  stepEvidence,
} from "@/lib/acceptance/step-evidence";
import { BATCH_STEPS, type BatchTrace } from "@/lib/acceptance/batch-steps";

const DELETE = { kind: "redo_returns", action: "delete" } as const;

const trace = (states: string[], actions: string[] = []): BatchTrace =>
  ({
    states,
    revisions: states.map((_, index) => index + 1),
    history: states.map(() => 1),
    writes: states.map(() => 1),
    events: actions.map((action) => ({ action, mutating: true })),
  }) as BatchTrace;

describe("what step 10 is waiting for", () => {
  it("says all three pieces are missing before anything is pressed", () => {
    const items = stepEvidence(DELETE, trace(["a"]));
    expect(items.map((item) => item.id)).toEqual(["edit", "undo", "redo"]);
    expect(items.every((item) => !item.present)).toBe(true);
  });

  it("marks the delete once it has really happened", () => {
    const items = stepEvidence(DELETE, trace(["a", "b"], ["delete"]));
    expect(items[0]?.present).toBe(true);
    expect(items[1]?.present).toBe(false);
  });

  it("marks the undo when the bytes come back", () => {
    const items = stepEvidence(DELETE, trace(["a", "b", "a"], ["delete"]));
    expect(items[1]?.present).toBe(true);
    expect(items[2]?.present).toBe(false);
  });

  it("marks the redo only when the written bytes return", () => {
    const done = stepEvidence(DELETE, trace(["a", "b", "a", "b"], ["delete"]));
    expect(done.every((item) => item.present)).toBe(true);
  });

  it("does not accept a redo that landed on different bytes", () => {
    const items = stepEvidence(DELETE, trace(["a", "b", "a", "c"], ["delete"]));
    expect(items[2]?.present).toBe(false);
  });

  it("does not mark the edit when the event was a different action", () => {
    const items = stepEvidence(DELETE, trace(["a", "b"], ["duplicate"]));
    expect(items[0]?.present).toBe(false);
  });

  it("names the press the founder could not find", () => {
    /*
     * The measured dead end: delete and undo were done exactly as the
     * instruction asked, and the gate silently wanted a third press whose
     * name appeared nowhere on the screen.
     */
    const hint = nextEvidenceHint(DELETE, trace(["a", "b", "a"], ["delete"]));
    expect(hint).toContain("İleri al");
  });

  it("says nothing once the step is satisfied", () => {
    expect(nextEvidenceHint(DELETE, trace(["a", "b", "a", "b"], ["delete"]))).toBeNull();
  });

  it("asks for one thing at a time", () => {
    const hint = nextEvidenceHint(DELETE, trace(["a"]));
    expect(hint).toContain("Sil");
    expect(hint).not.toContain("İleri al");
  });
});

describe("reading steps", () => {
  const READ = { kind: "no_write" } as const;

  it("are satisfied by nothing having been written", () => {
    expect(stepEvidence(READ, trace(["a"]))[0]?.present).toBe(true);
  });

  it("say so when something was written after all", () => {
    expect(stepEvidence(READ, trace(["a", "b"]))[0]?.present).toBe(false);
    expect(nextEvidenceHint(READ, trace(["a", "b"]))).toContain("dinleme");
  });
});

describe("every step in the round can describe itself", () => {
  it("produces at least one evidence line, and Turkish labels throughout", () => {
    for (const step of BATCH_STEPS) {
      const items = stepEvidence(step.expect, trace(["a"]));
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.label.length).toBeGreaterThan(0);
        /* No internal action names leak to the reader (§16). */
        expect(item.label).not.toMatch(/\b(paste|duplicate|delete|repeat|move)\b/);
      }
    }
  });

  it("reports nothing missing once a step's evidence is complete", () => {
    expect(missingEvidence(DELETE, trace(["a", "b", "a", "b"], ["delete"]))).toEqual([]);
  });
});

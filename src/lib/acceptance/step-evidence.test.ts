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
import {
  witnessFrom,
  type ProductionSample,
} from "@/lib/acceptance/production-witness";

const idle = (
  editorSelection: ProductionSample["editorSelection"],
): ProductionSample => ({
  status: "stopped",
  ticks: 0,
  loop: null,
  selection: null,
  editorSelection,
});

const held = (startTicks: number, endTicks: number) =>
  idle({
    sectionId: "s1",
    startTicks,
    endTicks,
    trackIds: ["gtr"],
    listenVerbs: 2,
  });

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
  const READ = { kind: "selection_extended" } as const;

  it("are not satisfied by nothing having been written", () => {
    /*
     * The exact wrong-green Codex measured on `b039d9c`: this step used to
     * be expressed as "nothing was written", which is true of a step nobody
     * has touched, so it reported its evidence as complete on arrival.
     */
    const items = stepEvidence(READ, trace(["a"]));
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((item) => !item.present)).toBe(true);
  });

  it("name the reading gesture that is still missing", () => {
    expect(nextEvidenceHint(READ, trace(["a"]))).toContain("seçim");
  });

  it("are satisfied only once the editor was seen doing it", () => {
    const facts = witnessFrom([held(0, 192), held(0, 384)]);
    expect(stepEvidence(READ, trace(["a"]), facts).every((item) => item.present)).toBe(
      true,
    );
    expect(nextEvidenceHint(READ, trace(["a"]), facts)).toBeNull();
  });
});

describe("every step in the round can describe itself", () => {
  it("produces at least one evidence line, and Turkish labels throughout", () => {
    for (const step of BATCH_STEPS) {
      const items = stepEvidence(step.expect, trace(["a"]));
      /*
       * Every acting step describes what it is waiting for. The closing step
       * is the single declared exception: it is `survey_only`, it asks a
       * question and requires no gesture, and it says that in its own kind
       * rather than by having an empty list nobody named.
       */
      if (step.expect.kind === "survey_only") {
        expect(items).toEqual([]);
        continue;
      }
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

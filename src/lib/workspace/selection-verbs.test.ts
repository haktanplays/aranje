/**
 * What a covered run offers while the reader is writing (K-59 §3).
 */
import { describe, expect, it, vi } from "vitest";

import { coveredRun } from "@/lib/workspace/selection-verbs";
import type { SelectionSession } from "@/lib/workspace/use-selection-session";

type Time = SelectionSession["time"];

/** A time-selection handle that records what was asked of it. */
function fakeTime(selection: unknown) {
  const calls: string[] = [];
  const time = {
    handle: {
      selection,
      summary: selection ? { text: "5 nota · 1 ölçü" } : null,
      notice: null,
      error: null,
      copy: () => calls.push("copy"),
      apply: (command: { kind: string }) => calls.push(`apply:${command.kind}`),
    },
    openSheet: (kind: string) => calls.push(`sheet:${kind}`),
    clear: () => calls.push("clear"),
  } as unknown as Time;
  return { time, calls };
}

const composer = () => ({ pick: vi.fn() });

describe("the selection row is offered only when there is one", () => {
  it("offers nothing while the reader is not writing", () => {
    const { time } = fakeTime({ sectionId: "s1" });
    expect(coveredRun({ editing: false, time, composer: composer() })).toBeNull();
  });

  it("offers nothing while nothing is covered", () => {
    const { time } = fakeTime(null);
    expect(coveredRun({ editing: true, time, composer: composer() })).toBeNull();
  });

  it("says the run in the header and gives it a way out", () => {
    const { time, calls } = fakeTime({ sectionId: "s1" });
    const run = coveredRun({ editing: true, time, composer: composer() });
    expect(run?.header.summary).toBe("5 nota · 1 ölçü");
    run?.header.onCancel();
    expect(calls).toEqual(["clear"]);
  });
});

describe("every verb is a handle that already existed", () => {
  it("calls the same command the tall reading bar called", () => {
    const { time, calls } = fakeTime({ sectionId: "s1" });
    const run = coveredRun({ editing: true, time, composer: composer() });
    run?.verbs.onCopy();
    run?.verbs.onCut();
    run?.verbs.onDuplicate();
    run?.verbs.onDelete();
    run?.verbs.onMove();
    run?.verbs.onRepeat();
    expect(calls).toEqual([
      "copy",
      "apply:cut_selection",
      "apply:duplicate_selection",
      "apply:delete_selection",
      "sheet:move",
      "sheet:repeat",
    ]);
  });

  it("picks the pattern tool up rather than inventing a command", () => {
    const { time, calls } = fakeTime({ sectionId: "s1" });
    const pen = composer();
    const run = coveredRun({ editing: true, time, composer: pen });
    run?.verbs.onContinue();
    expect(pen.pick).toHaveBeenCalledWith({
      kind: "continue_pattern",
      mode: "repeat",
    });
    // Continuing a pattern is not an edit of the selection itself.
    expect(calls).toEqual([]);
  });

  it("carries the selection's own notice and refusal, unchanged", () => {
    const { time } = fakeTime({ sectionId: "s1" });
    const handle = (time as unknown as { handle: Record<string, unknown> }).handle;
    handle.notice = "Bağlantı korundu.";
    handle.error = "Bu seçim taşınamıyor.";
    const run = coveredRun({ editing: true, time, composer: composer() });
    expect(run?.verbs.notice).toBe("Bağlantı korundu.");
    expect(run?.verbs.error).toBe("Bu seçim taşınamıyor.");
  });
});

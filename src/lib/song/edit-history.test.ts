import { describe, expect, it } from "vitest";

import {
  canUndo,
  createHistory,
  record,
  reset,
  undo,
} from "@/lib/song/edit-history";

describe("edit history", () => {
  it("starts with nothing to undo", () => {
    const history = createHistory("a");
    expect(canUndo(history)).toBe(false);
    expect(undo(history)).toEqual(history);
  });

  it("steps back one state at a time", () => {
    let history = createHistory("a");
    history = record(history, "b");
    history = record(history, "c");

    expect(history.present).toBe("c");
    history = undo(history);
    expect(history.present).toBe("b");
    history = undo(history);
    expect(history.present).toBe("a");
    expect(canUndo(history)).toBe(false);
  });

  it("ignores a state that did not change", () => {
    const history = record(createHistory("a"), "a");
    expect(canUndo(history)).toBe(false);
  });

  it("keeps the stack bounded", () => {
    let history = createHistory(0);
    for (let step = 1; step <= 30; step += 1) history = record(history, step, 5);
    expect(history.past).toHaveLength(5);
    expect(history.present).toBe(30);
    expect(history.past[0]).toBe(25);
  });

  it("forgets everything when the state is replaced wholesale", () => {
    const history = record(createHistory("a"), "b");
    expect(canUndo(reset(history.present))).toBe(false);
  });

  it("does not mutate the history it is given", () => {
    const history = createHistory("a");
    record(history, "b");
    expect(history).toEqual({ past: [], present: "a" });
  });
});

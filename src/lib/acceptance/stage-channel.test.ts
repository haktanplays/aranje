import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearStage,
  getStage,
  serverStage,
  setStage,
  subscribeStage,
} from "@/lib/acceptance/stage-channel";

afterEach(() => clearStage());

describe("the stage channel", () => {
  it("is empty until something enters a step, so the app is untouched", () => {
    expect(getStage()).toBeNull();
    expect(serverStage()).toBeNull();
  });

  it("names the step and counts the entry", () => {
    setStage("read");
    expect(getStage()).toEqual({ name: "read", entry: 1 });
    setStage("select");
    expect(getStage()).toEqual({ name: "select", entry: 2 });
  });

  /*
   * Stepping back and forward has to re-apply, not be remembered as done: a
   * step's contract is that the state holds when the reader is looking at it.
   */
  it("counts a repeat of the same step as a new entry", () => {
    setStage("ghost");
    const first = getStage();
    setStage("ghost");
    expect(getStage()).not.toEqual(first);
    expect(getStage()?.entry).toBe(2);
  });

  it("tells its listeners, and stops when they leave", () => {
    const listener = vi.fn();
    const stop = subscribeStage(listener);
    setStage("play");
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    setStage("read");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("can be emptied, so a second run starts from nothing", () => {
    setStage("play");
    clearStage();
    expect(getStage()).toBeNull();
  });
});

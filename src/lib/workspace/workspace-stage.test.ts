import { describe, expect, it } from "vitest";

import { stagePlan, type StageName } from "@/lib/workspace/workspace-stage";

const ALL: readonly StageName[] = ["read", "select", "ghost", "play"];

describe("stagePlan", () => {
  /*
   * The live run's first failure: the reader was asked to inspect the tab
   * while the arrangement was on screen. "The user can switch manually" is
   * not an answer — a guided step that depends on the reader having noticed
   * something the script never mentioned is not guided.
   */
  it("puts every step on the tab", () => {
    for (const name of ALL) expect(stagePlan(name).showTab).toBe(true);
  });

  it("opens the viewing step read-only", () => {
    const plan = stagePlan("read");
    expect(plan.editing).toBe(false);
    expect(plan.pen).toBeNull();
  });

  it("opens the selection step in edit mode with nothing selected", () => {
    const plan = stagePlan("select");
    expect(plan.editing).toBe(true);
    expect(plan.pen).toBeNull();
    expect(plan.clearSelection).toBe(true);
  });

  it("hands the ghost step the pen it is about to ask for", () => {
    const plan = stagePlan("ghost");
    expect(plan.editing).toBe(true);
    expect(plan.pen).toBe("power_chord_3");
  });

  /*
   * The state step 5 inherited on the live run: an empty selection and edit
   * mode still open, carried over from the Power Chord step.
   */
  it("starts the listening step from a clean transport and no edit mode", () => {
    const plan = stagePlan("play");
    expect(plan.editing).toBe(false);
    expect(plan.pen).toBeNull();
    expect(plan.resetTransport).toBe(true);
  });

  it("clears the selection and the sheets on every single entry", () => {
    for (const name of ALL) {
      expect(stagePlan(name).clearSelection).toBe(true);
      expect(stagePlan(name).closeSheets).toBe(true);
    }
  });

  it("only rewinds where a rewind is part of the step", () => {
    expect(ALL.filter((name) => stagePlan(name).resetTransport)).toEqual(["play"]);
  });
});

/**
 * Turning readings of the product into the facts a step may rely on (§4).
 */
import { describe, expect, it } from "vitest";

import {
  EMPTY_WITNESS,
  heardWithTracks,
  witnessFrom,
  type ProductionSample,
} from "@/lib/acceptance/production-witness";

const idle: ProductionSample = {
  status: "idle",
  ticks: 0,
  loop: null,
  selection: null,
  editorSelection: null,
};

const held = (
  startTicks: number,
  endTicks: number,
  listenVerbs = 0,
): ProductionSample => ({
  ...idle,
  editorSelection: { sectionId: "s1", startTicks, endTicks, trackIds: ["gtr"], listenVerbs },
});

const sounding = (
  trackIds: readonly string[],
  mode: string,
  ticks = 0,
  loop: ProductionSample["loop"] = null,
): ProductionSample => ({
  ...idle,
  status: "playing",
  ticks,
  loop,
  selection: { startTicks: 0, endTicks: 240, trackIds, mode, onsetCount: 3 },
});

describe("nothing is a fact until it is seen", () => {
  it("reports every fact false for an empty run", () => {
    expect(witnessFrom([])).toEqual(EMPTY_WITNESS);
  });

  it("reports every fact false for a run where nothing happened", () => {
    expect(witnessFrom([idle, idle, idle])).toEqual(EMPTY_WITNESS);
  });
});

describe("the selection", () => {
  it("is held once one appears", () => {
    expect(witnessFrom([idle, held(0, 192)]).selectionHeld).toBe(true);
  });

  it("is extended when the end moves forward from the same start", () => {
    const facts = witnessFrom([held(0, 192), held(0, 384)]);
    expect(facts.selectionExtended).toBe(true);
  });

  it("is not extended by drawing a different selection", () => {
    /* A new selection somewhere else is a new selection, not a reach — this
       is what stops "draw anything twice" from satisfying step 1. */
    expect(witnessFrom([held(0, 192), held(384, 576)]).selectionExtended).toBe(false);
  });

  it("is not extended by shrinking", () => {
    expect(witnessFrom([held(0, 384), held(0, 192)]).selectionExtended).toBe(false);
  });

  it("counts the listening verbs only on a real range", () => {
    expect(witnessFrom([held(0, 192, 2)]).listenOffered).toBe(true);
    expect(witnessFrom([held(192, 192, 2)]).listenOffered).toBe(false);
    expect(witnessFrom([held(0, 192, 1)]).listenOffered).toBe(false);
  });
});

describe("the audition", () => {
  it("starts and ends", () => {
    const facts = witnessFrom([idle, sounding(["gtr"], "once"), idle]);
    expect(facts.auditionStarted).toBe(true);
    expect(facts.auditionEnded).toBe(true);
  });

  it("is not ended while it is still sounding", () => {
    const facts = witnessFrom([idle, sounding(["gtr"], "once")]);
    expect(facts.auditionStarted).toBe(true);
    expect(facts.auditionEnded).toBe(false);
  });

  it("remembers which instruments each run asked for", () => {
    const facts = witnessFrom([
      idle,
      sounding(["gtr"], "once"),
      idle,
      sounding(["gtr", "bass"], "once"),
      idle,
    ]);
    expect(facts.listenFilters).toEqual([["gtr"], ["gtr", "bass"]]);
    expect(heardWithTracks(facts, ["gtr"])).toBe(true);
    expect(heardWithTracks(facts, ["bass", "gtr"])).toBe(true);
    expect(heardWithTracks(facts, ["bass"])).toBe(false);
  });
});

describe("the loop", () => {
  const bounds = { on: true, startTicks: 192, endTicks: 240 };

  it("starts, comes round, and stops", () => {
    const facts = witnessFrom([
      idle,
      sounding(["gtr"], "loop", 200, bounds),
      sounding(["gtr"], "loop", 235, bounds),
      sounding(["gtr"], "loop", 195, bounds),
      idle,
    ]);
    expect(facts.loopStarted).toBe(true);
    expect(facts.loopTraversed).toBe(true);
    expect(facts.loopStopped).toBe(true);
  });

  it("does not call a forward run a traversal", () => {
    const facts = witnessFrom([
      sounding(["gtr"], "loop", 200, bounds),
      sounding(["gtr"], "loop", 220, bounds),
    ]);
    expect(facts.loopTraversed).toBe(false);
  });

  it("does not count a jump outside the loop as coming round", () => {
    /* A seek to the top of the song goes backwards too, and is not a lap. */
    const facts = witnessFrom([
      sounding(["gtr"], "loop", 220, bounds),
      sounding(["gtr"], "loop", 5, bounds),
    ]);
    expect(facts.loopTraversed).toBe(false);
  });

  it("does not treat a one-shot ending as a loop being closed", () => {
    const facts = witnessFrom([sounding(["gtr"], "once"), idle]);
    expect(facts.loopStopped).toBe(false);
    expect(facts.auditionEnded).toBe(true);
  });
});

describe("pause and resume", () => {
  const at = (status: string, ticks: number): ProductionSample => ({
    ...idle,
    status,
    ticks,
  });

  it("sees a real pause, a still tick and a forward resume", () => {
    const facts = witnessFrom([
      at("playing", 700),
      at("paused", 798),
      at("paused", 798),
      at("playing", 1053),
    ]);
    expect(facts.played).toBe(true);
    expect(facts.paused).toBe(true);
    expect(facts.tickHeldWhilePaused).toBe(true);
    expect(facts.resumedForward).toBe(true);
  });

  it("does not call a pause that was never preceded by playing a pause", () => {
    /* Opening the page paused is not the reader pausing anything. */
    expect(witnessFrom([at("paused", 0), at("paused", 0)]).paused).toBe(false);
  });

  it("refuses a tick that drifted while paused", () => {
    const facts = witnessFrom([at("playing", 700), at("paused", 798), at("paused", 812)]);
    expect(facts.tickHeldWhilePaused).toBe(false);
  });

  it("refuses a resume that went backwards", () => {
    const facts = witnessFrom([
      at("playing", 700),
      at("paused", 798),
      at("paused", 798),
      at("playing", 100),
    ]);
    expect(facts.resumedForward).toBe(false);
  });
});

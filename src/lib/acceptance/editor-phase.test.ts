/**
 * Whether one gesture did what it said it would (2U-A handoff §5).
 *
 * The strict cases are the point. "One write" is not "the song changed" — a
 * gesture that wrote twice also changed the song, and so did one that changed
 * it without recording a step, which is worse than either.
 */
import { describe, expect, it } from "vitest";

import { judgePhase, type PhaseDiff } from "@/lib/acceptance/editor-steps";

const diff = (over: Partial<PhaseDiff> = {}): PhaseDiff => ({
  songBefore: "A",
  songAfter: "A",
  revisionBefore: 3,
  revisionAfter: 3,
  bandBefore: null,
  bandAfter: null,
  marks: {},
  ...over,
});

describe("a phase that must write nothing", () => {
  const expect_ = { kind: "no_write" } as const;

  it("passes when neither the song nor the revision moved", () => {
    expect(judgePhase(expect_, diff())).toBe(true);
  });

  it("fails when the song changed", () => {
    expect(judgePhase(expect_, diff({ songAfter: "B", revisionAfter: 4 }))).toBe(false);
  });

  /* A revision that moved with the song unchanged is still a write. */
  it("fails when only the revision moved", () => {
    expect(judgePhase(expect_, diff({ revisionAfter: 4 }))).toBe(false);
  });
});

describe("a phase that must write exactly once", () => {
  const expect_ = { kind: "one_write" } as const;

  it("passes on one changed song and one revision", () => {
    expect(judgePhase(expect_, diff({ songAfter: "B", revisionAfter: 4 }))).toBe(true);
  });

  it("fails when nothing happened", () => {
    expect(judgePhase(expect_, diff())).toBe(false);
  });

  it("fails when one gesture wrote twice", () => {
    expect(judgePhase(expect_, diff({ songAfter: "B", revisionAfter: 5 }))).toBe(false);
  });

  /*
   * The atomicity fault: the music moved and nothing recorded that it had.
   * Undo would not bring it back, and the report has to be able to say so.
   */
  it("fails when the song changed without a step being recorded", () => {
    expect(judgePhase(expect_, diff({ songAfter: "B" }))).toBe(false);
  });
});

describe("a phase that only moves a selection", () => {
  it("wants a band and no write", () => {
    const any = { kind: "selection_only", band: "any" } as const;
    expect(judgePhase(any, diff({ bandAfter: 100 }))).toBe(true);
    expect(judgePhase(any, diff())).toBe(false);
    expect(
      judgePhase(any, diff({ bandAfter: 100, songAfter: "B", revisionAfter: 4 })),
    ).toBe(false);
  });

  it("knows wider from narrower", () => {
    const wider = { kind: "selection_only", band: "wider" } as const;
    const narrower = { kind: "selection_only", band: "narrower" } as const;
    expect(judgePhase(wider, diff({ bandBefore: 34, bandAfter: 170 }))).toBe(true);
    expect(judgePhase(wider, diff({ bandBefore: 170, bandAfter: 34 }))).toBe(false);
    expect(judgePhase(narrower, diff({ bandBefore: 170, bandAfter: 34 }))).toBe(true);
    expect(judgePhase(narrower, diff({ bandBefore: 34, bandAfter: 170 }))).toBe(false);
  });

  /* A band that vanished is not a narrower band; it is no selection. */
  it("fails when the selection went away entirely", () => {
    const narrower = { kind: "selection_only", band: "narrower" } as const;
    expect(judgePhase(narrower, diff({ bandBefore: 170, bandAfter: null }))).toBe(false);
  });
});

describe("undo and redo", () => {
  it("passes only when the bytes are the remembered ones", () => {
    const back = { kind: "returns_to", mark: "before" } as const;
    expect(
      judgePhase(back, diff({ songAfter: "A", marks: { before: "A" } })),
    ).toBe(true);
    expect(
      judgePhase(back, diff({ songAfter: "B", marks: { before: "A" } })),
    ).toBe(false);
  });

  /* Nothing was remembered, so nothing can be claimed about coming back. */
  it("fails when the mark was never taken", () => {
    expect(judgePhase({ kind: "returns_to", mark: "before" }, diff())).toBe(false);
  });

  it("takes a mark without allowing a write alongside it", () => {
    const mark = { kind: "mark", mark: "here" } as const;
    expect(judgePhase(mark, diff())).toBe(true);
    expect(judgePhase(mark, diff({ songAfter: "B", revisionAfter: 4 }))).toBe(false);
  });
});

describe("a phase that asserts nothing", () => {
  it("passes whatever happened, because looking is not an edit", () => {
    expect(judgePhase({ kind: "free" }, diff({ songAfter: "B" }))).toBe(true);
  });
});

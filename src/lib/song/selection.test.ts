/**
 * What a selection is, and what changes it (spec 13.1, phase 2E).
 */
import { describe, expect, it } from "vitest";

import { chooseOnset, isChosen, selectionCount, type Selection } from "@/lib/song/selection";

const at = (barIndex: number, slotIndex: number) => ({ barIndex, slotIndex });

describe("starting a selection", () => {
  it("picks up one chord from nothing", () => {
    const next = chooseOnset(null, "s1", at(0, 2), "replace");
    expect(next).toEqual({ sectionId: "s1", refs: [at(0, 2)] });
    expect(selectionCount(next)).toBe(1);
  });

  it("starts again when the long press lands in another section", () => {
    const current: Selection = { sectionId: "s1", refs: [at(0, 0), at(0, 2)] };
    expect(chooseOnset(current, "s2", at(1, 1), "toggle")).toEqual({
      sectionId: "s2",
      refs: [at(1, 1)],
    });
  });
});

describe("adding and removing", () => {
  it("adds a chord with a tap", () => {
    const current: Selection = { sectionId: "s1", refs: [at(0, 0)] };
    expect(chooseOnset(current, "s1", at(0, 4), "toggle")?.refs).toEqual([
      at(0, 0),
      at(0, 4),
    ]);
  });

  it("takes the same chord out again with another tap", () => {
    const current: Selection = { sectionId: "s1", refs: [at(0, 0), at(0, 4)] };
    expect(chooseOnset(current, "s1", at(0, 4), "toggle")?.refs).toEqual([at(0, 0)]);
  });

  it("leaves no selection at all when the last chord is taken out", () => {
    const current: Selection = { sectionId: "s1", refs: [at(0, 4)] };
    expect(chooseOnset(current, "s1", at(0, 4), "toggle")).toBeNull();
  });

  it("keeps the chords in playing order however they were added", () => {
    let current = chooseOnset(null, "s1", at(1, 3), "replace");
    current = chooseOnset(current, "s1", at(0, 6), "toggle");
    current = chooseOnset(current, "s1", at(0, 1), "toggle");

    expect(current?.refs).toEqual([at(0, 1), at(0, 6), at(1, 3)]);
  });

  it("does not add the same chord twice", () => {
    let current = chooseOnset(null, "s1", at(0, 1), "replace");
    current = chooseOnset(current, "s1", at(0, 1), "toggle");
    expect(current).toBeNull();
  });
});

describe("reading a selection back", () => {
  const current: Selection = { sectionId: "s1", refs: [at(0, 0), at(1, 2)] };

  it("knows its own chords", () => {
    expect(isChosen(current, "s1", at(1, 2))).toBe(true);
    expect(isChosen(current, "s1", at(1, 3))).toBe(false);
  });

  it("claims nothing in another section", () => {
    expect(isChosen(current, "s2", at(0, 0))).toBe(false);
  });

  it("counts nothing when there is no selection", () => {
    expect(selectionCount(null)).toBe(0);
    expect(isChosen(null, "s1", at(0, 0))).toBe(false);
  });
});

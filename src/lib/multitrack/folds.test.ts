import { describe, expect, it } from "vitest";

import {
  NO_FOLDS,
  othersFolded,
  settleFolds,
  toggledFolds,
  type Folds,
} from "@/lib/multitrack/folds";

const folds = (projectId: string | null, ...ids: string[]): Folds => ({
  projectId,
  ids: new Set(ids),
});

describe("settleFolds", () => {
  it("starts with nothing folded", () => {
    expect([...settleFolds(NO_FOLDS, null, ["gtr", "bass"])]).toEqual([]);
  });

  it("keeps a fold made in the project that is open", () => {
    const settled = settleFolds(folds("p1", "bass"), "p1", ["gtr", "bass"]);
    expect([...settled]).toEqual(["bass"]);
  });

  it("does not carry folds into another project", () => {
    // The reader folded the bass in one song; opening another song is not a
    // statement about that song's bass.
    const settled = settleFolds(folds("p1", "bass"), "p2", ["gtr", "bass"]);
    expect([...settled]).toEqual([]);
  });

  it("treats the unsaved project as its own project", () => {
    expect([...settleFolds(folds(null, "bass"), null, ["bass"])]).toEqual(["bass"]);
    expect([...settleFolds(folds(null, "bass"), "p1", ["bass"])]).toEqual([]);
  });

  it("drops a fold whose track has been deleted", () => {
    const settled = settleFolds(folds("p1", "bass", "keys"), "p1", ["gtr", "bass"]);
    expect([...settled]).toEqual(["bass"]);
  });

  it("leaves a new track open", () => {
    const settled = settleFolds(folds("p1", "gtr", "bass"), "p1", [
      "gtr",
      "bass",
      "drums",
    ]);
    expect(settled.has("drums")).toBe(false);
  });

  it("does not resurrect a fold when a deleted id is reused", () => {
    // Settling is not filtering a stored set down; it is answering from the
    // song that is open. A track created with a dead track's id is new.
    const stored = folds("p1", "bass");
    const gone = settleFolds(stored, "p1", ["gtr"]);
    expect([...gone]).toEqual([]);
    const reused = settleFolds({ projectId: "p1", ids: gone }, "p1", ["gtr", "bass"]);
    expect([...reused]).toEqual([]);
  });

  it("answers without mutating what it was given", () => {
    const stored = folds("p1", "bass", "keys");
    settleFolds(stored, "p1", ["bass"]);
    expect([...stored.ids]).toEqual(["bass", "keys"]);
  });
});

describe("toggledFolds", () => {
  it("folds an open lane and remembers the project", () => {
    const next = toggledFolds(new Set(), "p1", "bass");
    expect([...next.ids]).toEqual(["bass"]);
    expect(next.projectId).toBe("p1");
  });

  it("opens a folded lane", () => {
    const next = toggledFolds(new Set(["bass", "gtr"]), "p1", "bass");
    expect([...next.ids]).toEqual(["gtr"]);
  });

  it("leaves the other lanes alone", () => {
    const next = toggledFolds(new Set(["gtr"]), "p1", "bass");
    expect([...next.ids].sort()).toEqual(["bass", "gtr"]);
  });
});

describe("othersFolded", () => {
  it("folds everything but the lane being edited", () => {
    const next = othersFolded(["gtr", "bass", "drums"], "p1", "bass");
    expect([...next.ids].sort()).toEqual(["drums", "gtr"]);
  });

  it("keeps the named lane open even when it is not in the song", () => {
    const next = othersFolded(["gtr", "bass"], "p1", "keys");
    expect([...next.ids].sort()).toEqual(["bass", "gtr"]);
  });

  it("is a no-op on a single-track song", () => {
    expect([...othersFolded(["gtr"], "p1", "gtr").ids]).toEqual([]);
  });
});

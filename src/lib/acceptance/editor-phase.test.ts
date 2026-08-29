/**
 * Whether one gesture did what it said it would (2U-A handoff §5).
 *
 * The strict cases are the point. "One write" is not "the song changed" — a
 * gesture that wrote twice also changed the song, and so did one that changed
 * it without recording a step, which is worse than either.
 */
import { describe, expect, it } from "vitest";

import {
  ALL_CHECK_KEYS,
  EDITOR_STEPS,
  judgePhase,
  phaseBlockedBy,
  type Phase,
  type PhaseDiff,
} from "@/lib/acceptance/editor-steps";

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

/**
 * The false positive the live run produced, and the rules that end it
 * (2U-B §4, §11).
 *
 * `Undo/redo: PASS` was reported for a paste that never happened. Nothing was
 * lying on purpose: with no write, the bytes marked before the paste and the
 * bytes marked after it were the same song, so "the song came back to the
 * before-mark" was satisfied by pressing an inert button — or by pressing
 * nothing at all.
 */
describe("a phase cannot pass on a neighbour's clean state", () => {
  const SONG_A = '{"a":1}';
  const SONG_B = '{"b":2}';

  const diff = (
    after: string,
    marks: Record<string, string>,
  ): PhaseDiff => ({
    songBefore: after,
    songAfter: after,
    revisionBefore: 3,
    revisionAfter: 3,
    bandBefore: null,
    bandAfter: null,
    marks,
  });

  it("refuses an undo whose two marks are the same song", () => {
    /* Exactly the live failure: pasteApplied was false, so both marks held
       the untouched fixture and undo had nothing to undo. */
    expect(
      judgePhase(
        { kind: "returns_to", mark: "beforePaste", distinctFrom: "pasted" },
        diff(SONG_A, { beforePaste: SONG_A, pasted: SONG_A }),
      ),
    ).toBe(false);
  });

  it("accepts it once the two marks are different music", () => {
    expect(
      judgePhase(
        { kind: "returns_to", mark: "beforePaste", distinctFrom: "pasted" },
        diff(SONG_A, { beforePaste: SONG_A, pasted: SONG_B }),
      ),
    ).toBe(true);
  });

  it("still refuses when the song did not come back", () => {
    expect(
      judgePhase(
        { kind: "returns_to", mark: "beforePaste", distinctFrom: "pasted" },
        diff(SONG_B, { beforePaste: SONG_A, pasted: SONG_B }),
      ),
    ).toBe(false);
  });

  it("blocks a phase whose dependency failed", () => {
    const phase: Phase = {
      id: "undoByteEqual",
      text: "",
      expect: { kind: "returns_to", mark: "beforePaste" },
      requires: ["pasteApplied"],
    };
    expect(phaseBlockedBy(phase, { pasteApplied: false })).toEqual([
      "pasteApplied",
    ]);
  });

  it("blocks it just as firmly when the dependency was never attempted", () => {
    const phase: Phase = {
      id: "undoByteEqual",
      text: "",
      expect: { kind: "returns_to", mark: "beforePaste" },
      requires: ["pasteApplied"],
    };
    /* "We did not check" is not evidence that it worked. */
    expect(phaseBlockedBy(phase, { pasteApplied: null })).toEqual([
      "pasteApplied",
    ]);
  });

  it("lets it through when the dependency really passed", () => {
    const phase: Phase = {
      id: "undoByteEqual",
      text: "",
      expect: { kind: "returns_to", mark: "beforePaste" },
      requires: ["pasteApplied"],
    };
    expect(phaseBlockedBy(phase, { pasteApplied: true })).toEqual([]);
  });

  it("names every dependency a real phase declares", () => {
    /*
     * A `requires` pointing at a key no phase or standing check produces
     * would block that phase for ever, silently.
     */
    const known = new Set(ALL_CHECK_KEYS);
    for (const step of EDITOR_STEPS) {
      for (const phase of step.phases) {
        for (const key of phase.requires ?? []) {
          expect(known.has(key), `${phase.id} requires ${key}`).toBe(true);
        }
      }
    }
  });

  it("ties the undo and redo of the paste to the paste itself", () => {
    /* The specific binding §4 asks for, asserted on the real step list. */
    const history = EDITOR_STEPS.find((step) => step.id === "history");
    const undo = history?.phases.find((phase) => phase.id === "undoByteEqual");
    const redo = history?.phases.find((phase) => phase.id === "redoByteEqual");
    expect(undo?.requires).toContain("pasteApplied");
    expect(redo?.requires).toContain("pasteApplied");
    expect(undo?.expect).toMatchObject({ distinctFrom: "pasted" });
  });

  it("ties the multi-measure work to a run of two bars really being held", () => {
    const measures = EDITOR_STEPS.find((step) => step.id === "measures");
    const repeat = measures?.phases.find(
      (phase) => phase.id === "multiRepeatOneHistory",
    );
    expect(repeat?.requires).toContain("multiSelectedByDrag");
    expect(measures?.standingChecks).toContain("twoBarsHeld");
  });
});
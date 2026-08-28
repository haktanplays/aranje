/**
 * What a selection offers, and what it deliberately does not (2U-A §2, §3).
 *
 * The rule this file exists to hold: a verb is either offered and works, or
 * disabled with a sentence, or absent. What must never happen is the fourth
 * thing — a verb that is drawn, pressed, and then refuses.
 */
import { describe, expect, it } from "vitest";

import {
  ALL_VERBS,
  canRun,
  offeredVerbs,
  refusalFor,
  selectionCapabilities,
  type CapabilityContext,
  type SelectionVerb,
} from "@/lib/song/selection-capability";
import type { SelectionDescriptor } from "@/lib/song/selection-descriptor";

const BAR = 768;

const base: SelectionDescriptor = {
  scope: "range",
  sectionId: "s1",
  startTicks: 0,
  endTicks: 192,
  trackIds: ["gtr"],
  stringIndexes: [3],
  eventIds: ["s1:0:0:gtr:3", "s1:0:4:gtr:3"],
  wholeBars: false,
  barRange: { startBarIndex: 0, endBarIndex: 0 },
  barScope: null,
  onsetCount: 2,
};

const note: SelectionDescriptor = {
  ...base,
  scope: "note",
  eventIds: ["s1:0:0:gtr:3"],
  onsetCount: 1,
};

const chord: SelectionDescriptor = {
  ...base,
  scope: "chord",
  stringIndexes: [0, 1, 2],
  eventIds: ["s1:0:0:gtr:0", "s1:0:0:gtr:1", "s1:0:0:gtr:2"],
  onsetCount: 1,
};

const measures = (start: number, end: number): SelectionDescriptor => ({
  ...base,
  scope: "measures",
  startTicks: start * BAR,
  endTicks: (end + 1) * BAR,
  wholeBars: true,
  barRange: { startBarIndex: start, endBarIndex: end },
  barScope: "full",
});

const context = (over: Partial<CapabilityContext> = {}): CapabilityContext => ({
  hasClipboard: false,
  clipboardScope: null,
  sectionBarCount: 4,
  ...over,
});

const stateOf = (
  descriptor: SelectionDescriptor,
  verb: SelectionVerb,
  over: Partial<CapabilityContext> = {},
) =>
  selectionCapabilities(descriptor, context(over)).find(
    (offer) => offer.verb === verb,
  )?.state;

describe("every verb gets an answer", () => {
  it("answers for all of them, and never twice for one", () => {
    const offers = selectionCapabilities(base, context());
    expect(offers).toHaveLength(ALL_VERBS.length);
    expect(new Set(offers.map((offer) => offer.verb)).size).toBe(ALL_VERBS.length);
  });

  it("gives every answer one of exactly three shapes", () => {
    for (const offer of selectionCapabilities(base, context())) {
      expect(["available", "disabled", "hidden"]).toContain(offer.state.kind);
      if (offer.state.kind === "disabled") {
        expect(offer.state.reason.length).toBeGreaterThan(4);
      }
    }
  });

  /* A reason a reader cannot act on is not a reason. */
  it("never explains a refusal with the model's own words", () => {
    const scopes = [note, chord, base, measures(0, 0), measures(3, 3)];
    for (const descriptor of scopes) {
      for (const offer of selectionCapabilities(descriptor, context())) {
        if (offer.state.kind !== "disabled") continue;
        expect(offer.state.reason).not.toMatch(
          /tick|slot|index|scope|descriptor|null|undefined/i,
        );
      }
    }
  });
});

describe("what a run of notes offers", () => {
  it("offers the clipboard and the movements", () => {
    for (const verb of [
      "copy",
      "cut",
      "duplicate",
      "repeat",
      "delete",
      "move_time",
      "transpose",
      "restring",
    ] as const) {
      expect(canRun(selectionCapabilities(base, context()), verb), verb).toBe(true);
    }
  });

  it("hides every measure verb, because a run of notes is not a bar", () => {
    for (const verb of [
      "insert_bar_before",
      "insert_bar_after",
      "duplicate_bar",
      "delete_bar",
      "move_bar_left",
      "move_bar_right",
      "timing",
    ] as const) {
      expect(stateOf(base, verb)?.kind, verb).toBe("hidden");
    }
  });

  it("hides the chord verbs on a range that is not one chord", () => {
    for (const verb of ["to_arpeggio", "to_chord", "strum", "retune"] as const) {
      expect(stateOf(base, verb)?.kind, verb).toBe("hidden");
    }
  });

  it("disables paste with a reason when nothing has been copied", () => {
    expect(stateOf(base, "paste")).toEqual({
      kind: "disabled",
      reason: "Panoda bir şey yok.",
    });
  });

  it("offers paste once something of the right kind is on the clipboard", () => {
    expect(
      stateOf(base, "paste", { hasClipboard: true, clipboardScope: "range" }),
    ).toEqual({ kind: "available" });
  });

  /* The two clipboards are never silently converted (`bar-selection.ts`). */
  it("refuses to paste copied bars into a run of notes, and says so", () => {
    const state = stateOf(base, "paste", {
      hasClipboard: true,
      clipboardScope: "measures",
    });
    expect(state?.kind).toBe("disabled");
    expect(refusalFor(
      selectionCapabilities(base, context({ hasClipboard: true, clipboardScope: "measures" })),
      "paste",
    )).toContain("ölçüler");
  });

  it("needs two notes before it offers to join them", () => {
    expect(canRun(selectionCapabilities(base, context()), "connect")).toBe(true);
    expect(stateOf(note, "connect")?.kind).toBe("disabled");
  });

  it("offers to extend whatever is held, even an empty span", () => {
    const empty = { ...base, eventIds: [], onsetCount: 0 };
    expect(canRun(selectionCapabilities(empty, context()), "extend")).toBe(true);
  });

  it("disables the verbs that need notes when the span holds none", () => {
    const empty = { ...base, eventIds: [], onsetCount: 0 };
    for (const verb of ["copy", "cut", "delete", "transpose"] as const) {
      expect(stateOf(empty, verb)?.kind, verb).toBe("disabled");
    }
  });
});

describe("what one chord offers", () => {
  it("offers the four things that only mean something on a chord", () => {
    for (const verb of ["to_arpeggio", "to_chord", "strum", "retune"] as const) {
      expect(canRun(selectionCapabilities(chord, context()), verb), verb).toBe(true);
    }
  });

  it("still offers everything a run of notes offers", () => {
    for (const verb of ["copy", "cut", "duplicate", "transpose"] as const) {
      expect(canRun(selectionCapabilities(chord, context()), verb), verb).toBe(true);
    }
  });
});

describe("what a run of bars offers", () => {
  it("offers the measure verbs and hides the note ones", () => {
    const offers = selectionCapabilities(measures(1, 1), context());
    for (const verb of [
      "insert_bar_before",
      "insert_bar_after",
      "duplicate_bar",
      "timing",
    ] as const) {
      expect(canRun(offers, verb), verb).toBe(true);
    }
    for (const verb of ["copy", "cut", "paste", "transpose", "restring"] as const) {
      expect(stateOf(measures(1, 1), verb)?.kind, verb).toBe("hidden");
    }
  });

  it("will not move the first bar further left, and says which bar it is", () => {
    expect(stateOf(measures(0, 0), "move_bar_left")).toEqual({
      kind: "disabled",
      reason: "Bu ilk ölçü.",
    });
    expect(canRun(selectionCapabilities(measures(0, 0), context()), "move_bar_right")).toBe(
      true,
    );
  });

  it("will not move the last bar further right", () => {
    expect(stateOf(measures(3, 3), "move_bar_right")).toEqual({
      kind: "disabled",
      reason: "Bu son ölçü.",
    });
  });

  /*
   * §10: a song is at least one bar long. The refusal is where the reader can
   * see it, not after they have pressed it.
   */
  it("will not delete the only bar there is", () => {
    expect(
      stateOf(measures(0, 0), "delete_bar", { sectionBarCount: 1 }),
    ).toEqual({ kind: "disabled", reason: "Şarkıda en az bir ölçü kalmalı." });
  });

  it("will delete one bar of four", () => {
    expect(canRun(selectionCapabilities(measures(0, 0), context()), "delete_bar")).toBe(
      true,
    );
  });

  it("will not delete every bar of the section at once either", () => {
    expect(
      stateOf(measures(0, 3), "delete_bar", { sectionBarCount: 4 })?.kind,
    ).toBe("disabled");
  });
});

describe("what a surface draws", () => {
  it("is only the verbs that are not hidden", () => {
    const offers = selectionCapabilities(measures(1, 1), context());
    const drawn = offeredVerbs(offers);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.every((offer) => offer.state.kind !== "hidden")).toBe(true);
    expect(drawn.length).toBeLessThan(ALL_VERBS.length);
  });

  it("gives a run of notes and a run of bars different sets", () => {
    const notes = offeredVerbs(selectionCapabilities(base, context())).map(
      (offer) => offer.verb,
    );
    const bars = offeredVerbs(selectionCapabilities(measures(1, 1), context())).map(
      (offer) => offer.verb,
    );
    expect(notes).not.toEqual(bars);
    expect(notes.some((verb) => bars.includes(verb))).toBe(false);
  });
});

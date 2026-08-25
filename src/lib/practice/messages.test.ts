/**
 * What the practice loop says, checked as language (2R-A §X, §12).
 *
 * Three things are being defended:
 *
 *   1. Every sentence is Turkish and about music. This codebase's words for
 *      its own bookkeeping — tick, range, preflight, chain, loop bounds —
 *      never reach a screen.
 *   2. Nothing claims anything about how the reader played. "Tur" is a pass
 *      of the loop, and the app has no way to know more than that.
 *   3. The transport's one line is a fact, not a summary of a fact: the bars,
 *      the speed, where the speed is going and whether anything is counted in.
 */
import { describe, expect, it } from "vitest";

import {
  DRAFT_FIELD_LABELS,
  draftFieldValue,
  edgeMessage,
  planRefusalMessage,
  practiceBanner,
  PROGRESSIVE_EXPLAINER,
  refusalMessage,
  rangeSummary,
  sourceLabel,
  SPEED_MODE_LABELS,
} from "@/lib/practice/messages";
import { startProgressive, afterLoop, afterManualChange } from "@/lib/practice/progressive-rate";
import type { PlanRefusal } from "@/lib/practice/progressive-rate";
import type { EntryRefusal } from "@/lib/practice/range-entry";
import type { RangeEdgeKind } from "@/lib/practice/range-preflight";

const REFUSALS: readonly EntryRefusal[] = [
  "different_sections",
  "too_many_bars",
  "unknown_bar",
  "chain_crosses_section",
  "requires_full_bars",
];
const EDGES: readonly RangeEdgeKind[] = [
  "safe",
  "start_continues_tie",
  "end_cuts_sustain",
  "legato_boundary",
  "crosses_section",
];
const PLAN_REFUSALS: readonly PlanRefusal[] = [
  "target_not_above_start",
  "increment_out_of_range",
  "repeats_out_of_range",
];

/** The words the reader must never be shown, whatever the state (§14). */
const JARGON = [
  "range",
  "preflight",
  "tick",
  "chain",
  "hammer_on",
  "pull_off",
  "loop bounds",
  "sectionId",
  "barKey",
];

/**
 * The three ways a missing value leaks into a sentence.
 *
 * Checked as whole words rather than as substrings, which is not pedantry:
 * "hızlanır" contains "nan", and a substring rule would have forced the
 * explainer to be reworded to satisfy a test rather than a reader.
 */
const LEAKS = /\b(undefined|null|NaN)\b/;

const everySentence = (): string[] => {
  const sentences: string[] = [
    rangeSummary(1, 1, "Nakarat"),
    rangeSummary(3, 8, "Giriş"),
    PROGRESSIVE_EXPLAINER,
    ...Object.values(SPEED_MODE_LABELS),
    ...Object.values(DRAFT_FIELD_LABELS),
    ...REFUSALS.map(refusalMessage),
    ...PLAN_REFUSALS.map(planRefusalMessage),
    ...["single_bar", "bar_pair", "time_selection"].map((source) =>
      sourceLabel(source as Parameters<typeof sourceLabel>[0]),
    ),
  ];
  for (const kind of EDGES) {
    const said = edgeMessage(kind);
    if (said !== null) sentences.push(said);
  }
  return sentences;
};

describe("288. the practice loop speaks about music, in Turkish", () => {
  it("shows no identifier, no error code and no internal word", () => {
    for (const sentence of everySentence()) {
      for (const word of JARGON) {
        expect(sentence.toLowerCase(), sentence).not.toContain(word.toLowerCase());
      }
      expect(LEAKS.test(sentence), sentence).toBe(false);
    }
  });

  it("says something for every refusal it can produce", () => {
    for (const reason of REFUSALS) {
      expect(refusalMessage(reason).length, reason).toBeGreaterThan(10);
    }
    for (const reason of PLAN_REFUSALS) {
      expect(planRefusalMessage(reason).length, reason).toBeGreaterThan(10);
    }
  });

  it("keeps the three plan refusals distinct rather than one apology", () => {
    expect(new Set(PLAN_REFUSALS.map(planRefusalMessage)).size).toBe(3);
  });

  it("says nothing about a safe edge, rather than saying nothing is wrong", () => {
    expect(edgeMessage("safe")).toBeNull();
  });

  it("never claims the reader played anything", () => {
    for (const sentence of everySentence()) {
      for (const claim of ["doğru", "temiz", "hatasız", "başarı", "puan", "dinl"]) {
        // The one deliberate exception: the explainer says the app does *not*
        // listen, which is the opposite claim and the reason it exists.
        if (sentence === PROGRESSIVE_EXPLAINER && claim === "dinl") continue;
        expect(sentence.toLowerCase(), sentence).not.toContain(claim);
      }
    }
  });

  it("says a field's value in its own unit: a speed or a count of passes", () => {
    expect(draftFieldValue("fromPercent", 80)).toBe("%80");
    expect(draftFieldValue("toPercent", 100)).toBe("%100");
    expect(draftFieldValue("incrementPercent", 5)).toBe("%5");
    expect(draftFieldValue("repeatsPerStep", 2)).toBe("2 tur");
  });
});

describe("289. the transport's line is the drill, not a summary of it", () => {
  const banner = (over: Partial<Parameters<typeof practiceBanner>[0]> = {}) =>
    practiceBanner({
      barCount: 2,
      percent: 70,
      progressive: null,
      countInBars: 0,
      ...over,
    });

  it("says nothing when nothing is looping", () => {
    expect(banner({ barCount: 0 })).toBeNull();
  });

  it("says the bars and the speed at a fixed speed", () => {
    expect(banner()).toBe("Pratik · 2 ölçü · %70");
  });

  it("adds the count-in only when there is one", () => {
    expect(banner({ countInBars: 1 })).toBe("Pratik · 2 ölçü · %70 · 1 ölçü sayım");
    expect(banner({ countInBars: 0 })).not.toContain("sayım");
  });

  it("says where the speed is going while it is climbing", () => {
    const progressive = startProgressive({
      fromPercent: 70,
      toPercent: 100,
      stepPercent: 5,
      repeatsPerStep: 2,
    });
    expect(banner({ barCount: 4, progressive })).toBe(
      "Pratik · 4 ölçü · %70→%100 · 2 turda bir +%5",
    );
  });

  it("follows the climb rather than repeating where it started", () => {
    let progressive = startProgressive({
      fromPercent: 70,
      toPercent: 100,
      stepPercent: 5,
      repeatsPerStep: 1,
    });
    progressive = afterLoop(progressive);
    expect(banner({ progressive })).toContain("%75→%100");
  });

  it("falls back to the plain speed once the climb has stopped", () => {
    const stopped = afterManualChange(
      startProgressive({
        fromPercent: 70,
        toPercent: 100,
        stepPercent: 5,
        repeatsPerStep: 2,
      }),
      90,
    );
    /*
     * The banner must not keep advertising a climb that ended. It reports
     * the transport's own speed, which is where the reader's hand left it.
     */
    expect(banner({ percent: 90, progressive: stopped })).toBe(
      "Pratik · 2 ölçü · %90",
    );
  });

  it("stays a single short sentence in every combination", () => {
    for (const bars of [1, 4, 8]) {
      for (const countIn of [0, 1, 2]) {
        const said = banner({ barCount: bars, countInBars: countIn });
        expect(said, `${bars}/${countIn}`).not.toBeNull();
        expect(said!.length, said!).toBeLessThan(60);
        expect(said!.includes("\n")).toBe(false);
      }
    }
  });
});

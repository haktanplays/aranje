/**
 * Saying one thing once (2W §14).
 */
import { describe, expect, it } from "vitest";

import {
  summarizeWarnings,
  warningLineText,
} from "@/lib/validators/warning-summary";
import type { ValidationIssue } from "@/lib/validators/types";

const issue = (over: Partial<ValidationIssue> = {}): ValidationIssue => ({
  code: "fret_jump",
  severity: "warning",
  message: "Bu geçiş için el çok uzağa gidiyor.",
  ...over,
});

describe("nine copies become one line", () => {
  it("collapses identical sentences and counts them", () => {
    const summary = summarizeWarnings(Array.from({ length: 9 }, () => issue()));
    expect(summary.lines.length).toBe(1);
    expect(summary.lines[0]!.count).toBe(9);
    expect(summary.total).toBe(9);
    expect(summary.collapsed).toBe(true);
  });

  it("keeps different sentences apart", () => {
    const summary = summarizeWarnings([
      issue(),
      issue({ message: "Bu akor bu perdede çalınamıyor.", code: "unplaceable" }),
      issue(),
    ]);
    expect(summary.lines.map((line) => line.count)).toEqual([2, 1]);
    expect(summary.total).toBe(3);
  });

  it("groups by the sentence rather than by the code", () => {
    /* Two codes that say the same thing read as one repetition to a person,
       and a person is who the summary is for. */
    const summary = summarizeWarnings([
      issue({ code: "a" }),
      issue({ code: "b" }),
    ]);
    expect(summary.lines.length).toBe(1);
    expect(summary.lines[0]!.count).toBe(2);
  });

  it("says nothing was collapsed when nothing was", () => {
    const summary = summarizeWarnings([issue()]);
    expect(summary.collapsed).toBe(false);
    expect(summary.lines[0]!.count).toBe(1);
  });

  it("has no lines and no total for no warnings", () => {
    const summary = summarizeWarnings([]);
    expect(summary.lines).toEqual([]);
    expect(summary.total).toBe(0);
    expect(summary.collapsed).toBe(false);
  });

  it("keeps the order the reader first met them in", () => {
    const summary = summarizeWarnings([
      issue({ message: "birinci" }),
      issue({ message: "ikinci" }),
      issue({ message: "birinci" }),
    ]);
    expect(summary.lines.map((line) => line.message)).toEqual(["birinci", "ikinci"]);
  });
});

describe("where it applies", () => {
  it("collects the bars, ascending and without repeats", () => {
    const summary = summarizeWarnings([
      issue({ barIndex: 3 }),
      issue({ barIndex: 0 }),
      issue({ barIndex: 3 }),
    ]);
    expect(summary.lines[0]!.bars).toEqual([1, 4]);
  });

  it("counts bars from one, the way a musician does", () => {
    const summary = summarizeWarnings([issue({ barIndex: 0 }), issue({ barIndex: 0 })]);
    expect(warningLineText(summary.lines[0]!)).toContain("1. ölçü");
    expect(warningLineText(summary.lines[0]!)).not.toContain("0.");
  });
});

describe("the line the reader reads", () => {
  it("says a single warning plainly, with no count", () => {
    const summary = summarizeWarnings([issue()]);
    expect(warningLineText(summary.lines[0]!)).toBe(issue().message);
    expect(warningLineText(summary.lines[0]!)).not.toContain("yerde");
  });

  it("names a few bars rather than counting them", () => {
    const summary = summarizeWarnings([issue({ barIndex: 0 }), issue({ barIndex: 1 })]);
    expect(warningLineText(summary.lines[0]!)).toBe(
      `${issue().message} (1. ölçü, 2. ölçü)`,
    );
  });

  it("counts instead of listing when there are many", () => {
    const summary = summarizeWarnings(
      Array.from({ length: 6 }, (_, index) => issue({ barIndex: index })),
    );
    expect(warningLineText(summary.lines[0]!)).toBe(`${issue().message} · 6 yerde`);
  });

  it("counts when the places are not known", () => {
    const summary = summarizeWarnings([issue(), issue(), issue()]);
    expect(warningLineText(summary.lines[0]!)).toBe(`${issue().message} · 3 yerde`);
  });

  it("never says slot or tick", () => {
    const summary = summarizeWarnings([issue({ barIndex: 2, slotIndex: 5 })]);
    const text = warningLineText(summary.lines[0]!);
    expect(text.toLowerCase()).not.toContain("slot");
    expect(text.toLowerCase()).not.toContain("tick");
  });
});

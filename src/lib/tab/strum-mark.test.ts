import { describe, expect, it } from "vitest";

import { strumMarks } from "@/lib/tab/strum-mark";
import type { TabSpan } from "@/lib/tab/timeline";

const span = (
  stringIndex: number,
  startSlot: number,
  strum?: "down" | "up",
  extra: Partial<TabSpan> = {},
): TabSpan => ({
  stringIndex,
  noteIndex: 0,
  fret: 0,
  pitch: "E2",
  writtenTicks: 192,
  startSlot,
  endSlot: startSlot,
  openStart: false,
  openEnd: false,
  ...(strum === undefined ? {} : { strum }),
  ...extra,
});

describe("strumMarks", () => {
  it("draws one arrow for a chord, not one per note", () => {
    const marks = strumMarks([
      span(0, 0, "down"),
      span(1, 0, "down"),
      span(2, 0, "down"),
    ]);
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatchObject({
      slotIndex: 0,
      direction: "down",
      fromString: 0,
      toString: 2,
      voices: 3,
    });
  });

  it("reaches only the strings the chord uses", () => {
    const marks = strumMarks([span(2, 4, "up"), span(3, 4, "up")]);
    expect(marks[0]).toMatchObject({ fromString: 2, toString: 3, direction: "up" });
  });

  it("says which way the hand went, in Turkish", () => {
    expect(strumMarks([span(0, 0, "down"), span(1, 0, "down")])[0]!.label).toBe(
      "2 telde aşağı vuruş",
    );
    expect(strumMarks([span(0, 0, "up"), span(1, 0, "up")])[0]!.label).toBe(
      "2 telde yukarı vuruş",
    );
  });

  it("draws nothing for a single note, because one string is not a crossing", () => {
    expect(strumMarks([span(0, 0, "down")])).toEqual([]);
  });

  it("draws nothing for a chord nobody marked", () => {
    expect(strumMarks([span(0, 0), span(1, 0)])).toEqual([]);
  });

  it("ignores a note that was already ringing when the bar began", () => {
    expect(
      strumMarks([
        span(0, 0, "down", { openStart: true }),
        span(1, 0, "down", { openStart: true }),
      ]),
    ).toEqual([]);
  });

  it("keeps several strums of one bar in playing order", () => {
    const marks = strumMarks([
      span(0, 8, "up"),
      span(1, 8, "up"),
      span(0, 0, "down"),
      span(1, 0, "down"),
    ]);
    expect(marks.map((mark) => mark.slotIndex)).toEqual([0, 8]);
    expect(marks.map((mark) => mark.direction)).toEqual(["down", "up"]);
  });
});

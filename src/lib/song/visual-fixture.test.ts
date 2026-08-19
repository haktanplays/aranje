import { describe, expect, it } from "vitest";

import { songSchema } from "@/lib/song/schema";
import { hasErrors, runValidators } from "@/lib/validators";
import { buildTrackTimeline, frettedRhythm } from "@/lib/tab/timeline";
import fixture from "@/lib/song/visual-fixture.json";

/**
 * The fixture that drives the visual check. It is a plain song, so it goes
 * through the Song Contract exactly like anything the user or the model
 * writes; nothing here is decorative markup.
 */
const parsed = songSchema.safeParse(fixture);
if (!parsed.success) throw new Error("visual fixture does not parse");
const SONG = parsed.data;

function timeline() {
  const built = buildTrackTimeline(SONG, "gtr");
  if (built.kind !== "fretted") throw new Error("expected a fretted track");
  return built;
}

describe("visual fixture", () => {
  it("passes the schema", () => {
    expect(songSchema.safeParse(fixture).success).toBe(true);
  });

  it("passes every validator", () => {
    const issues = runValidators(SONG);
    expect(issues).toEqual([]);
    expect(hasErrors(issues)).toBe(false);
  });

  it("covers the single and double digit frets", () => {
    const frets = timeline()
      .bars[0]?.spans.map((span) => span.fret)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(frets).toEqual([0, 3, 10, 12]);
  });

  it("has a chord of at least three notes in one slot", () => {
    const chord = timeline().bars[1]?.spans.filter(
      (span) => span.startSlot === 0,
    );
    expect(chord?.length).toBeGreaterThanOrEqual(3);
    expect(chord?.map((span) => span.pitch).sort()).toEqual([
      "B2",
      "E2",
      "G3",
    ]);
    // A chord shares one slot, so every note aligns on the same column.
    expect(new Set(chord?.map((span) => span.startSlot)).size).toBe(1);
  });

  it("has an onset, a sustain and a rest in the same bar", () => {
    const bar = timeline().bars[1];
    const states = bar ? frettedRhythm(bar) : [];
    expect(states[0]).toBe("onset");
    expect(states[1]).toBe("sustain");
    expect(states[4]).toBe("rest");
    expect(states[5]).toBe("onset");
  });

  it("ties across a bar line", () => {
    const bars = timeline().bars;
    expect(bars[1]?.spans.some((span) => span.openEnd)).toBe(true);
    const carried = bars[2]?.spans.find((span) => span.openStart);
    expect(carried?.pitch).toBe("E3");
    expect(carried?.startSlot).toBe(0);
    expect(carried?.endSlot).toBe(1);
  });

  it("has a section where the track is completely silent", () => {
    const silent = timeline().bars.filter(
      (bar) => bar.sectionId === "silent",
    );
    expect(silent).toHaveLength(2);
    expect(silent.every((bar) => bar.silent)).toBe(true);
    expect(silent.every((bar) => bar.spans.length === 0)).toBe(true);
  });

  it("stays inside the core limits", () => {
    const bars = SONG.sections.reduce(
      (total, section) => total + section.bars.length,
      0,
    );
    expect(bars).toBe(5);
    expect(SONG.tracks).toHaveLength(1);
  });
});

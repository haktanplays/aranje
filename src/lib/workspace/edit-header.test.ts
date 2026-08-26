/**
 * The one line the focused edit layout puts above the staff (2S-A §18).
 *
 * The layout itself is a fact about the screen, but *what it says* is a fact
 * about the song, so it is decided here and tested here.
 */
import { describe, expect, it } from "vitest";

import { barNumberOf, editHeaderModel } from "@/lib/workspace/edit-header";
import type { SectionRun } from "@/lib/tab/timeline";

const RUNS: readonly SectionRun[] = [
  { sectionId: "intro", name: "Giriş", status: "fixed", firstBar: 1, barCount: 4 },
  { sectionId: "riff", name: "Ana Riff", status: "fixed", firstBar: 5, barCount: 8 },
  { sectionId: "outro", name: "Çıkış", status: "pending", firstBar: 13, barCount: 2 },
];

describe("42. the edit header says where the reader is", () => {
  it("counts the bar the way a musician counts it, across the whole song", () => {
    // The third bar of the second section is the seventh bar of the song.
    expect(barNumberOf(RUNS, "riff:2")).toBe(7);
    expect(barNumberOf(RUNS, "intro:0")).toBe(1);
    expect(barNumberOf(RUNS, "outro:1")).toBe(14);
  });

  it("gives no number rather than a wrong one", () => {
    expect(barNumberOf(RUNS, null)).toBeNull();
    expect(barNumberOf(RUNS, "riff:8")).toBeNull(); // past the section's end
    expect(barNumberOf(RUNS, "nowhere:0")).toBeNull();
    expect(barNumberOf(RUNS, "riff")).toBeNull();
    expect(barNumberOf(RUNS, "riff:-1")).toBeNull();
  });

  it("names the section and the bar the way the reader would say them", () => {
    const model = editHeaderModel(RUNS, "riff", "riff:7");
    expect(model.section).toBe("Ana Riff");
    expect(model.bar).toBe("12. ölçü");
  });

  it("drops the bar when the focused one is in another section", () => {
    /*
     * A true number about the wrong music is worse than no number: the reader
     * is looking at "Ana Riff" and the focus is still on the intro.
     */
    const model = editHeaderModel(RUNS, "riff", "intro:1");
    expect(model.section).toBe("Ana Riff");
    expect(model.bar).toBeNull();
    expect(model.label).toBe("Düzenleniyor: Ana Riff");
  });

  it("carries the whole line for a screen reader, never a truncated one", () => {
    const long = [
      { ...RUNS[0]!, sectionId: "riff", name: "Ana Riff — ikinci yarı, çift gitar" },
    ];
    const model = editHeaderModel(long, "riff", "riff:2");
    expect(model.label).toContain("Ana Riff — ikinci yarı, çift gitar");
    expect(model.label).toContain("3. ölçü");
    // Nothing from the machine reaches it.
    expect(model.label).not.toMatch(/tick|slot|sectionId|:\d/);
  });

  it("still says something when the song has no run for the section", () => {
    const model = editHeaderModel([], "riff", "riff:0");
    expect(model.section).toBe("Bölüm");
    expect(model.bar).toBeNull();
  });
});

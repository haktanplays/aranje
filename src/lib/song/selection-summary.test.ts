/**
 * A selection described in words a player uses (spec 13.1).
 *
 * The rule being pinned is that no technical value reaches the reader: not a
 * tick, not a slot index, not an error code.
 */
import { describe, expect, it } from "vitest";

import { looksLikePowerChord, summariseSelection } from "@/lib/song/selection-summary";
import { transformMessage } from "@/lib/song/transform-messages";
import type { TransformErrorCode } from "@/lib/song/transform";
import { ticksPerSlot } from "@/lib/music/timing";
import type { MelodicSlot } from "@/lib/song/schema";
import { bar, note, slots, song, TRACK_ID, REST } from "@/test/move-fixtures";

const STEP = ticksPerSlot(8);
const sel = (startTicks: number, endTicks: number) => ({
  sectionId: "s1",
  trackId: TRACK_ID,
  startTicks,
  endTicks,
});

const POWER: MelodicSlot = {
  notes: [
    { pitch: "E2", position: { string: 0, fret: 0 } },
    { pitch: "B2", position: { string: 1, fret: 2 } },
    { pitch: "E3", position: { string: 2, fret: 2 } },
  ],
};

describe("power chord is a label, not a type", () => {
  it("recognises root, fifth and octave", () => {
    expect(looksLikePowerChord([40, 47, 52])).toBe(true);
    expect(looksLikePowerChord([40, 47])).toBe(true);
  });

  it("does not call a major triad a power chord", () => {
    expect(looksLikePowerChord([40, 44, 47])).toBe(false);
  });
});

describe("summaries", () => {
  it("counts a chord as one chord", () => {
    const target = song([bar(slots([POWER, REST]))]);
    const summary = summariseSelection(target, sel(0, STEP));
    expect(summary.onsetCount).toBe(1);
    expect(summary.noteCount).toBe(3);
    expect(summary.text).toContain("power chord");
  });

  it("counts single notes as notes and says how many bars", () => {
    const target = song([
      bar(slots([note("A3", 1, 12), REST, note("C4", 1, 15), REST])),
      bar(slots([note("E4", 2, 14), REST])),
    ]);
    const summary = summariseSelection(target, sel(0, STEP * 9));
    expect(summary.onsetCount).toBe(3);
    expect(summary.barCount).toBe(2);
    expect(summary.text).toBe("3 nota · 2 ölçü");
  });

  it("says when the core widened the range", () => {
    const target = song([bar(slots([note("A3", 1, 12), REST]))]);
    const summary = summariseSelection(target, sel(0, STEP), { expanded: true });
    expect(summary.text).toContain("zincir tamamlandı");
  });

  it("never puts a tick or a slot index in the text", () => {
    const target = song([bar(slots([POWER, REST]))]);
    const summary = summariseSelection(target, sel(0, STEP * 2));
    expect(summary.text).not.toMatch(/\d{3,}/);
    expect(summary.text).not.toContain("tick");
    expect(summary.text).not.toContain("slot");
  });
});

describe("refusal messages", () => {
  const codes: TransformErrorCode[] = [
    "selection_empty",
    "selection_out_of_bounds",
    "section_not_found",
    "track_not_found",
    "track_not_editable",
    "track_silent_here",
    "clipboard_empty",
    "target_grid_incompatible",
    "target_occupied",
    "out_of_range",
    "string_collision",
    "position_not_derivable",
    "section_overflow",
    "validation_failed",
  ];

  it("has a sentence for every code", () => {
    for (const code of codes) {
      expect(transformMessage(code).length).toBeGreaterThan(10);
    }
  });

  it("never leaks the code, a diagnostic or a stack into the sentence", () => {
    for (const code of codes) {
      const message = transformMessage(code);
      expect(message).not.toContain(code);
      expect(message).not.toContain("_");
      expect(message).not.toMatch(/Zod|Error:|at .*\.ts/);
    }
  });

  it("says the two specific things the brief asked for", () => {
    expect(transformMessage("target_occupied")).toBe(
      "Hedefte zaten nota veya uzayan bir ses var.",
    );
    expect(transformMessage("target_grid_incompatible")).toBe(
      "Seçim hedef ölçünün ritim aralığına tam oturmuyor.",
    );
  });
});

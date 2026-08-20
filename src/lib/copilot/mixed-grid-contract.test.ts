/**
 * What a turn is told about the grid, and what it may do about it
 * (spec 5.5, 11.1, 11.5, K-34).
 *
 * A bar's grid belongs to the piece, not to the answer. The model is shown
 * it, has to match it slot for slot, and has nowhere to write a different
 * one — the schema has no resolution field at all, so the only way a wrong
 * grid can show up is as a wrong slot count, which is what these tests are
 * mostly about.
 */
import { describe, expect, it } from "vitest";

import { MODEL_PATCH_JSON_SCHEMA } from "@/lib/copilot/output-schema";
import { modelPatchSchema } from "@/lib/copilot/contract";
import { parseArrangePatch, validateArrangeOutput } from "@/lib/copilot/arrange";
import { barShapeLines } from "@/lib/copilot/compact";
import { buildPrompt, SYSTEM_PROMPT } from "@/lib/copilot/prompt";
import { surfaceDigest, checkLockedSurface } from "@/lib/copilot/scope";
import { applyPatch } from "@/lib/copilot/apply";
import { MAX_SLOTS_PER_BAR, slotCount, type Resolution } from "@/lib/music/timing";
import { songSchema, type Song } from "@/lib/song/schema";
import { arrangeRequest, TEST_SONG } from "@/test/copilot-fixtures";

/** The demo song with the target section re-gridded bar by bar. */
function regridded(grids: readonly Resolution[], sectionIndex = 0): Song {
  const raw = {
    ...TEST_SONG,
    sections: TEST_SONG.sections.map((section, index) => {
      if (index !== sectionIndex) return section;
      return {
        ...section,
        bars: section.bars.map((bar, barIndex) => {
          const resolution = grids[barIndex] ?? bar.resolution;
          const count = slotCount(bar.timeSignature, resolution);
          const slots: Record<string, unknown> = {};
          for (const [trackId, written] of Object.entries(bar.slots)) {
            slots[trackId] = Array.isArray(written) && Array.isArray(written[0])
              ? Array.from({ length: count }, () => [])
              : Array.from({ length: count }, () => null);
          }
          return { ...bar, resolution, slots };
        }),
      };
    }),
  };
  const parsed = songSchema.safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

const drumBar = (barIndex: number, slots: number) => ({
  barIndex,
  slots: Array.from({ length: slots }, () => [{ piece: "kick" as const }]),
});

describe("the answer schema shows the grids that exist", () => {
  it("bounds a bar by the widest one the contract allows", () => {
    expect(MAX_SLOTS_PER_BAR).toBe(32);
    const text = JSON.stringify(MODEL_PATCH_JSON_SCHEMA);
    expect(text).toContain('"maxItems":32');
  });

  it("refuses a bar wider than any bar can be", () => {
    const tooWide = {
      operation: "arrange_track",
      sectionId: "s",
      targetTrackId: "drums",
      bars: [drumBar(0, MAX_SLOTS_PER_BAR + 1)],
      explanation: "x",
    };
    expect(modelPatchSchema.safeParse(tooWide).success).toBe(false);
    expect(
      modelPatchSchema.safeParse({
        ...tooWide,
        bars: [drumBar(0, MAX_SLOTS_PER_BAR)],
      }).success,
    ).toBe(true);
  });

  it("has no field a resolution could be written into", () => {
    const text = JSON.stringify(MODEL_PATCH_JSON_SCHEMA);
    expect(text).not.toContain("resolution");
    expect(
      modelPatchSchema.safeParse({
        operation: "arrange_track",
        sectionId: "s",
        targetTrackId: "drums",
        bars: [drumBar(0, 8)],
        explanation: "x",
        resolution: 32,
      }).success,
    ).toBe(false);
  });
});

describe("what the prompt says about the grid", () => {
  it("states every bar's own grid, not the section's", () => {
    const song = regridded([16, 24, 32, 12]);
    const section = song.sections[0];
    if (!section) throw new Error("no section");
    const lines = barShapeLines(section);
    expect(lines[0]).toContain("1/16 16 slot");
    expect(lines[1]).toContain("1/16 ucleme 24 slot");
    expect(lines[2]).toContain("1/32 32 slot");
    expect(lines[3]).toContain("1/8 ucleme 12 slot");
  });

  it("never shows a triplet grid as a bare fraction", () => {
    const song = regridded([12, 24, 16, 16]);
    const section = song.sections[0];
    if (!section) throw new Error("no section");
    for (const line of barShapeLines(section)) {
      expect(line).not.toContain("1/12");
      expect(line).not.toContain("1/24");
    }
  });

  it("says how many slots make a beat on a triplet bar", () => {
    const song = regridded([24, 16, 16, 16]);
    const section = song.sections[0];
    if (!section) throw new Error("no section");
    expect(barShapeLines(section)[0]).toContain("6 slot = 1 vurus");
  });

  it("tells the model the grid is not its to change", () => {
    const rules = SYSTEM_PROMPT;
    expect(rules).toContain("Barin grid'ini degistiremezsin.");
    expect(rules).toContain("1/8 ucleme");
    expect(rules).toContain("1/16 ucleme");
    // And that a triplet beat is three slots, which is the thing a model gets
    // wrong when it reads 12 as "a bit denser than 8".
    expect(rules).toContain("bir vurus 3 slottur");
  });

  it("carries the bar shapes into the message a provider receives", () => {
    const song = regridded([16, 24, 16, 16]);
    const section = song.sections[0];
    if (!section) throw new Error("no section");
    const built = buildPrompt({
      request: arrangeRequest("drums", { song, sectionId: section.id }),
    });
    expect(built.userMessage).toContain("1/16 ucleme 24 slot");
  });
});

describe("a wrong slot count is corrected with everything needed to fix it", () => {
  const song = regridded([16, 24, 32, 16]);
  const section = song.sections[0];
  if (!section) throw new Error("no section");
  const request = arrangeRequest("drums", { song, sectionId: section.id });

  const answer = (slots: number[]) => ({
    operation: "arrange_track" as const,
    sectionId: section.id,
    targetTrackId: "drums",
    bars: slots.map((count, index) => drumBar(index, count)),
    explanation: "Deterministik davul.",
  });

  const shapeIssues = (slots: number[]) =>
    validateArrangeOutput(request, { ...answer(slots), id: "p1" }).map(
      (issue) => issue.message,
    );

  it("accepts bars written on each bar's own grid", () => {
    expect(shapeIssues([16, 24, 32, 16])).toEqual([]);
  });

  it("refuses a bar written on the section's first grid instead of its own", () => {
    // The classic mistake: 16 slots everywhere because bar 1 had 16.
    expect(shapeIssues([16, 16, 16, 16])).toHaveLength(2);
  });

  it("names the meter, the grid and the slot count", () => {
    const issues = shapeIssues([16, 16, 32, 16]);
    expect(issues).toHaveLength(1);
    const message = issues[0] ?? "";
    expect(message).toContain("4/4");
    expect(message).toContain("1/16 ucleme");
    expect(message).toContain("24 slot gerekiyor");
    expect(message).toContain("16 geldi");
    expect(message).toContain("grid'i değiştirilemez");
  });

  it("parses as valid JSON and fails on the shape, not on the parse", () => {
    /*
     * The grid is a *shape* question, not a schema one: a bar of sixteen
     * slots is a perfectly legal patch until it is measured against the bar it
     * is aimed at. So the answer gets through `parseArrangePatch` and is
     * refused by `validateArrangeOutput`, which is what the pipeline turns
     * into the correction it sends back (pipeline.ts, round 2).
     */
    const parsed = parseArrangePatch(
      JSON.stringify(answer([16, 16, 16, 16])),
      request,
      () => "p1",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const corrections = validateArrangeOutput(request, parsed.patch).map(
      (issue) => issue.message,
    );
    expect(corrections.join(" ")).toContain("1/16 ucleme");
    expect(corrections.join(" ")).toContain("1/32");
  });
});

describe("applying a patch leaves the grid where it was", () => {
  it("does not move a single bar's resolution", () => {
    const song = regridded([16, 24, 32, 12]);
    const section = song.sections[0];
    if (!section) throw new Error("no section");
    const before = section.bars.map((bar) => bar.resolution);

    const applied = applyPatch(song, {
      id: "p1",
      operation: "arrange_track",
      sectionId: section.id,
      targetTrackId: "drums",
      bars: before.map((resolution, index) =>
        drumBar(index, slotCount(section.bars[index]?.timeSignature ?? [4, 4], resolution)),
      ),
      explanation: "x",
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const after = applied.song.sections[0]?.bars.map((bar) => bar.resolution);
    expect(after).toEqual(before);
  });

  it("counts a moved resolution as a locked-surface violation", () => {
    // Nothing can produce this through the contract; the guard is the second
    // lock, and it has to hold even if our own code were the one to slip.
    const before = surfaceDigest(regridded([16, 16, 16, 16]));
    const after = surfaceDigest(regridded([16, 32, 16, 16]));
    const violations = checkLockedSurface(before, after, {
      sectionId: TEST_SONG.sections[0]?.id ?? "",
      targetTrackId: "drums",
    });
    expect(violations).not.toEqual([]);
  });
});

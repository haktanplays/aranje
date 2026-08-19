import { describe, expect, it } from "vitest";

import { songLimits } from "@/lib/limits";
import { copilotPatchSchema, type CopilotPatch } from "@/lib/copilot/contract";
import { guitarTrack, melodicBar, restSlots, section, song } from "@/lib/song/fixtures";
import type { Bar } from "@/lib/song/schema";
import { changedBarCount, validatePatchSize } from "@/lib/validators/patchSize";

function bars(count: number): Bar[] {
  return Array.from({ length: count }, () => melodicBar("gtr", restSlots(8)));
}

function patchOf(count: number, action: CopilotPatch["action"]): CopilotPatch {
  const base = {
    id: "patch-1",
    section: {
      id: "new",
      name: "Yeni",
      status: "pending" as const,
      bars: bars(count),
    },
    explanation: "Test",
  };
  return action === "insert_section"
    ? { ...base, action, afterSectionId: "s1" }
    : { ...base, action, targetSectionId: "s1" };
}

const SUBJECT = song(
  [guitarTrack()],
  [section(bars(8), { id: "s1", name: "Ana" })],
);

describe("patchSize validator (spec 10.1)", () => {
  it("accepts a patch at the limit", () => {
    const patch = patchOf(songLimits.barsPerPatch, "insert_section");
    expect(changedBarCount(SUBJECT, patch)).toBe(songLimits.barsPerPatch);
    expect(validatePatchSize(SUBJECT, patch)).toEqual([]);
  });

  it("blocks a patch one bar over the limit", () => {
    const patch = patchOf(songLimits.barsPerPatch + 1, "insert_section");
    const issues = validatePatchSize(SUBJECT, patch);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "patchSize",
      severity: "error",
      sectionId: "new",
    });
    expect(issues[0]?.message).toContain(String(songLimits.barsPerPatch));
  });

  it("counts the bars a replacement displaces, not only the ones it writes", () => {
    // One new bar in place of eight is eight bars of change.
    const patch = patchOf(1, "replace_section");
    expect(changedBarCount(SUBJECT, patch)).toBe(8);
  });

  it("counts every bar as new when the patch inserts", () => {
    expect(changedBarCount(SUBJECT, patchOf(3, "insert_section"))).toBe(3);
  });

  it("treats a replacement of an unknown section as writing only its own bars", () => {
    const patch: CopilotPatch = {
      ...patchOf(2, "replace_section"),
      action: "replace_section",
      targetSectionId: "missing",
    };
    expect(changedBarCount(SUBJECT, patch)).toBe(2);
  });

  it("is a second line of defence, not the only one", () => {
    // The section schema already caps a section at barsPerSection, which is
    // the same number as barsPerPatch, so an over-long patch cannot get past
    // the parser in the first place. patchSize still runs, because a patch
    // object may be assembled by something other than the parser and because
    // spec 10.1 asks for the check by name.
    const overLong = patchOf(songLimits.barsPerPatch + 1, "insert_section");
    expect(copilotPatchSchema.safeParse(overLong).success).toBe(false);
    expect(validatePatchSize(SUBJECT, overLong)).toHaveLength(1);
  });

  it("repeats itself exactly", () => {
    const patch = patchOf(songLimits.barsPerPatch + 2, "insert_section");
    expect(validatePatchSize(SUBJECT, patch)).toEqual(
      validatePatchSize(SUBJECT, patch),
    );
  });
});

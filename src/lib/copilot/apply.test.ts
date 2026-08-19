import { describe, expect, it } from "vitest";

import { applyPatch, replacedSection } from "@/lib/copilot/apply";
import type { CopilotPatch } from "@/lib/copilot/contract";
import { TEST_SONG, pendingSection } from "@/test/copilot-fixtures";

const anchor = TEST_SONG.sections[0]?.id ?? "intro";

describe("applying a patch in memory (spec 11.4/7)", () => {
  it("inserts directly after the anchor", () => {
    const patch: CopilotPatch = {
      id: "p1",
      action: "insert_section",
      afterSectionId: anchor,
      section: pendingSection(),
      explanation: "x",
    };
    const result = applyPatch(TEST_SONG, patch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song.sections[1]?.id).toBe("ai-1");
    expect(result.song.sections).toHaveLength(TEST_SONG.sections.length + 1);
  });

  it("replaces in place, keeping the order", () => {
    const patch: CopilotPatch = {
      id: "p1",
      action: "replace_section",
      targetSectionId: anchor,
      section: pendingSection(2, "ai-2"),
      explanation: "x",
    };
    const result = applyPatch(TEST_SONG, patch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song.sections[0]?.id).toBe("ai-2");
    expect(result.song.sections).toHaveLength(TEST_SONG.sections.length);
  });

  it("does not touch the song it was given", () => {
    const before = JSON.stringify(TEST_SONG);
    applyPatch(TEST_SONG, {
      id: "p1",
      action: "insert_section",
      afterSectionId: anchor,
      section: pendingSection(),
      explanation: "x",
    });
    expect(JSON.stringify(TEST_SONG)).toBe(before);
  });

  it("refuses an anchor the song does not have", () => {
    const result = applyPatch(TEST_SONG, {
      id: "p1",
      action: "insert_section",
      afterSectionId: "nowhere",
      section: pendingSection(),
      explanation: "x",
    });
    expect(result).toEqual({ ok: false, reason: "anchor_not_found" });
  });

  it("finds the section a replacement displaces", () => {
    const patch: CopilotPatch = {
      id: "p1",
      action: "replace_section",
      targetSectionId: anchor,
      section: pendingSection(),
      explanation: "x",
    };
    expect(replacedSection(TEST_SONG, patch)?.id).toBe(anchor);
  });
});

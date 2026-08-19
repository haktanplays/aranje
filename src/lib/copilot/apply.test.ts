import { describe, expect, it } from "vitest";

import { applyPatch } from "@/lib/copilot/apply";
import type { CopilotPatch } from "@/lib/copilot/contract";
import { checkLockedSurface, contentKey, surfaceDigest } from "@/lib/copilot/scope";
import { HARMONY_SONG, TEST_SONG, mainSection } from "@/test/copilot-fixtures";

const SECTION = mainSection();

function drumPatch(overrides: Partial<CopilotPatch> = {}): CopilotPatch {
  return {
    id: "p1",
    operation: "arrange_track",
    sectionId: SECTION.id,
    targetTrackId: "drums",
    bars: SECTION.bars.map((_, barIndex) => ({
      barIndex,
      slots: Array.from({ length: 8 }, () => [{ piece: "kick" as const }]),
    })),
    explanation: "x",
    ...overrides,
  };
}

describe("applying a track-scoped patch (spec 11.4/7, K-18)", () => {
  it("writes into the target track and nowhere else", () => {
    const result = applyPatch(TEST_SONG, drumPatch());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const before = surfaceDigest(TEST_SONG);
    const after = surfaceDigest(result.song);
    expect(
      checkLockedSurface(before, after, {
        sectionId: SECTION.id,
        targetTrackId: "drums",
      }),
    ).toEqual([]);

    // And the target really did change.
    expect(after.trackContent[contentKey(SECTION.id, "drums")]).not.toBe(
      before.trackContent[contentKey(SECTION.id, "drums")],
    );
  });

  it("does not touch the song it was given", () => {
    const before = JSON.stringify(TEST_SONG);
    applyPatch(TEST_SONG, drumPatch());
    expect(JSON.stringify(TEST_SONG)).toBe(before);
  });

  it("leaves the other tracks of the same bar exactly as they were", () => {
    const result = applyPatch(TEST_SONG, drumPatch());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const original = TEST_SONG.sections.find((s) => s.id === SECTION.id);
    const patched = result.song.sections.find((s) => s.id === SECTION.id);
    original?.bars.forEach((bar, index) => {
      for (const trackId of Object.keys(bar.slots)) {
        if (trackId === "drums") continue;
        expect(patched?.bars[index]?.slots[trackId]).toEqual(bar.slots[trackId]);
      }
    });
  });

  it("writes only the bars it was given, leaving the rest alone", () => {
    const partial = drumPatch({
      bars: [
        {
          barIndex: 1,
          slots: Array.from({ length: 8 }, () => [{ piece: "snare" as const }]),
        },
      ],
    });
    const result = applyPatch(TEST_SONG, partial);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const original = TEST_SONG.sections.find((s) => s.id === SECTION.id);
    const patched = result.song.sections.find((s) => s.id === SECTION.id);
    expect(patched?.bars[0]?.slots.drums).toEqual(original?.bars[0]?.slots.drums);
    expect(patched?.bars[1]?.slots.drums).not.toEqual(
      original?.bars[1]?.slots.drums,
    );
  });

  it("adds the target track to a bar it was silent in", () => {
    // The harmony guitar is written nowhere yet (spec 5.5 silence).
    const patch = drumPatch({
      targetTrackId: "gtr2",
      bars: SECTION.bars.map((_, barIndex) => ({
        barIndex,
        slots: Array.from({ length: 8 }, () => null),
      })),
    });
    const result = applyPatch(HARMONY_SONG, patch);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const patched = result.song.sections.find((s) => s.id === SECTION.id);
    expect(patched?.bars[0]?.slots.gtr2).toBeDefined();
  });

  it("refuses a section, a track or a bar the song does not have", () => {
    expect(applyPatch(TEST_SONG, drumPatch({ sectionId: "nowhere" }))).toEqual({
      ok: false,
      reason: "section_not_found",
    });
    expect(
      applyPatch(TEST_SONG, drumPatch({ targetTrackId: "ghost" })),
    ).toEqual({ ok: false, reason: "track_not_in_song" });
    expect(
      applyPatch(
        TEST_SONG,
        drumPatch({ bars: [{ barIndex: 7, slots: [] }] }),
      ),
    ).toEqual({ ok: false, reason: "bar_out_of_range" });
  });
});

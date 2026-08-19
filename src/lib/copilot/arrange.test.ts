import { describe, expect, it } from "vitest";

import {
  lockedTrackIdsFor,
  resolveTarget,
  skillAccepts,
  validateArrangeOutput,
} from "@/lib/copilot/arrange";
import type { CopilotPatch } from "@/lib/copilot/contract";
import {
  HARMONY_SONG,
  TEST_SONG,
  arrangeRequest,
  mainSection,
} from "@/test/copilot-fixtures";

const SECTION = mainSection();

function patchFor(
  targetTrackId: string,
  bars: CopilotPatch["bars"],
  overrides: Partial<CopilotPatch> = {},
): CopilotPatch {
  return {
    id: "p1",
    operation: "arrange_track",
    sectionId: SECTION.id,
    targetTrackId,
    bars,
    explanation: "x",
    ...overrides,
  };
}

const drumBars: CopilotPatch["bars"] = SECTION.bars.map((_, barIndex) => ({
  barIndex,
  slots: Array.from({ length: 8 }, () => [{ piece: "kick" as const }]),
}));

const melodicBars: CopilotPatch["bars"] = SECTION.bars.map((_, barIndex) => ({
  barIndex,
  slots: Array.from({ length: 8 }, () => null),
}));

describe("skill and target must fit (spec 11.1, K-18)", () => {
  it("matches each skill to its instrument family", () => {
    const track = (id: string, song = HARMONY_SONG) => {
      const found = song.tracks.find((entry) => entry.id === id);
      if (!found) throw new Error(`fixture has no track ${id}`);
      return found;
    };

    expect(skillAccepts("drums", track("drums"))).toBe(true);
    expect(skillAccepts("bass", track("bass"))).toBe(true);
    expect(skillAccepts("harmony", track("gtr2"))).toBe(true);

    expect(skillAccepts("drums", track("gtr"))).toBe(false);
    expect(skillAccepts("bass", track("gtr"))).toBe(false);
    expect(skillAccepts("harmony", track("bass"))).toBe(false);
    expect(skillAccepts("harmony", track("drums"))).toBe(false);
  });

  it("resolves a well-aimed request", () => {
    const resolved = resolveTarget(arrangeRequest("drums"));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.section.id).toBe(SECTION.id);
    expect(resolved.track.id).toBe("drums");
  });

  it("refuses a skill aimed at the wrong kind of track", () => {
    const resolved = resolveTarget(
      arrangeRequest("drums", { targetTrackId: "gtr" }),
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.reason).toContain("needs a drums track");
  });

  it("refuses a section or a track the song does not have", () => {
    expect(resolveTarget(arrangeRequest("drums", { sectionId: "nowhere" })).ok).toBe(
      false,
    );
    expect(
      resolveTarget(arrangeRequest("drums", { targetTrackId: "ghost" })).ok,
    ).toBe(false);
  });

  it("refuses a target the caller itself declared locked", () => {
    const resolved = resolveTarget(
      arrangeRequest("drums", { lockedTrackIds: ["drums", "gtr"] }),
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.reason).toContain("lockedTrackIds");
  });

  it("locks every non-target track, whatever the caller sent", () => {
    // A caller who sends an empty list changes nothing: the server's list is
    // the boundary and it is derived, not accepted.
    expect(lockedTrackIdsFor(TEST_SONG, "drums")).toEqual([
      "acc",
      "bass",
      "gtr",
    ]);
    expect(lockedTrackIdsFor(HARMONY_SONG, "gtr2")).toEqual([
      "acc",
      "bass",
      "drums",
      "gtr",
    ]);
  });
});

describe("the answer must describe the surface it was asked about", () => {
  const request = arrangeRequest("drums");

  it("accepts an answer of the right shape", () => {
    expect(validateArrangeOutput(request, patchFor("drums", drumBars))).toEqual([]);
  });

  it("refuses an answer aimed at another section or another track", () => {
    expect(
      validateArrangeOutput(
        request,
        patchFor("drums", drumBars, { sectionId: "main-riff" }),
      ),
    ).toHaveLength(1);
    expect(
      validateArrangeOutput(request, patchFor("gtr", drumBars)),
    ).toHaveLength(1);
  });

  it("refuses too few or too many bars", () => {
    expect(
      validateArrangeOutput(request, patchFor("drums", drumBars.slice(0, 2))),
    ).toHaveLength(1);
    expect(
      validateArrangeOutput(request, patchFor("drums", [...drumBars, drumBars[0]!])),
    ).toHaveLength(1);
  });

  it("refuses bars that are out of order or repeated", () => {
    const shuffled = [drumBars[1]!, drumBars[0]!, drumBars[2]!, drumBars[3]!];
    expect(validateArrangeOutput(request, patchFor("drums", shuffled)).length).toBeGreaterThan(0);

    const repeated = [drumBars[0]!, drumBars[0]!, drumBars[2]!, drumBars[3]!];
    expect(validateArrangeOutput(request, patchFor("drums", repeated)).length).toBeGreaterThan(0);
  });

  it("refuses a wrong slot count for the bar's own time signature", () => {
    const short = drumBars.map((bar, index) =>
      index === 0 ? { ...bar, slots: bar.slots.slice(0, 7) } : bar,
    );
    const issues = validateArrangeOutput(request, patchFor("drums", short));
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain("8 slot gerekiyor, 7 geldi");
  });

  it("refuses melodic slots on a drum track and drum slots on a melodic one", () => {
    expect(
      validateArrangeOutput(request, patchFor("drums", melodicBars)).length,
    ).toBeGreaterThan(0);

    const harmonyRequest = arrangeRequest("harmony");
    expect(
      validateArrangeOutput(
        harmonyRequest,
        patchFor("gtr2", drumBars, { sectionId: harmonyRequest.sectionId }),
      ).length,
    ).toBeGreaterThan(0);
  });

  it("says the same thing every time it is asked", () => {
    const patch = patchFor("drums", drumBars.slice(0, 2));
    expect(validateArrangeOutput(request, patch)).toEqual(
      validateArrangeOutput(request, patch),
    );
  });
});

import { describe, expect, it } from "vitest";

import { copilotRequestSchema } from "@/lib/copilot/contract";
import { resolveTarget } from "@/lib/copilot/arrange";
import {
  availableSkills,
  lockedFor,
  targetsFor,
} from "@/lib/copilot/ui-options";
import { HARMONY_SONG, TEST_SONG, mainSection } from "@/test/copilot-fixtures";

describe("what the arrange sheet may offer", () => {
  it("offers each skill only the tracks it can be pointed at", () => {
    expect(targetsFor(HARMONY_SONG, "drums").map((t) => t.id)).toEqual(["drums"]);
    expect(targetsFor(HARMONY_SONG, "bass").map((t) => t.id)).toEqual(["bass"]);
    expect(targetsFor(HARMONY_SONG, "harmony").map((t) => t.id)).toEqual([
      "gtr",
      "acc",
      "gtr2",
    ]);
  });

  it("never offers an incompatible track", () => {
    for (const skill of ["drums", "bass", "harmony"] as const) {
      for (const option of targetsFor(HARMONY_SONG, skill)) {
        const request = {
          operation: "arrange_track" as const,
          skill,
          sectionId: mainSection().id,
          targetTrackId: option.id,
          lockedTrackIds: lockedFor(HARMONY_SONG, option.id),
          subjectId: "device",
          idempotencyKey: "idem-key-0001",
          song: HARMONY_SONG,
        };
        // Every offered option is one the server would accept.
        expect(resolveTarget(request).ok).toBe(true);
      }
    }
  });

  it("hides a skill that has nowhere to go", () => {
    const noDrums = {
      ...TEST_SONG,
      tracks: TEST_SONG.tracks.filter((track) => track.id !== "drums"),
      sections: TEST_SONG.sections.map((section) => ({
        ...section,
        bars: section.bars.map((bar) => ({
          ...bar,
          slots: Object.fromEntries(
            Object.entries(bar.slots).filter(([id]) => id !== "drums"),
          ),
        })),
      })),
    };
    expect(availableSkills(noDrums)).not.toContain("drums");
    expect(availableSkills(TEST_SONG)).toContain("drums");
  });
});

describe("the locked list is derived, never typed", () => {
  it("is every track except the target", () => {
    expect(lockedFor(TEST_SONG, "drums")).toEqual(["acc", "bass", "gtr"]);
    expect(lockedFor(HARMONY_SONG, "gtr2")).toEqual([
      "acc",
      "bass",
      "drums",
      "gtr",
    ]);
  });

  it("never contains the target", () => {
    for (const track of HARMONY_SONG.tracks) {
      expect(lockedFor(HARMONY_SONG, track.id)).not.toContain(track.id);
    }
  });

  it("is the same list every time, in the same order", () => {
    expect(lockedFor(HARMONY_SONG, "drums")).toEqual(
      lockedFor(HARMONY_SONG, "drums"),
    );
  });

  it("builds a request the contract accepts, with no legacy fields", () => {
    const request = {
      operation: "arrange_track" as const,
      skill: "harmony" as const,
      sectionId: mainSection().id,
      targetTrackId: "gtr2",
      lockedTrackIds: lockedFor(HARMONY_SONG, "gtr2"),
      subjectId: "device",
      idempotencyKey: "idem-key-0001",
      song: HARMONY_SONG,
    };
    expect(copilotRequestSchema.safeParse(request).success).toBe(true);

    for (const legacy of ["kind", "afterSectionId", "targetSectionId", "prompt"]) {
      expect(request).not.toHaveProperty(legacy);
    }
  });
});

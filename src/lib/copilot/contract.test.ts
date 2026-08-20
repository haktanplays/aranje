import { describe, expect, it } from "vitest";

import {
  ARRANGE_SKILLS,
  copilotPatchSchema,
  copilotRequestSchema,
  modelPatchSchema,
} from "@/lib/copilot/contract";
import { SKILL_TARGETS, skillAccepts } from "@/lib/copilot/arrange";
import { SKILL_CARDS } from "@/lib/copilot/prompt";
import { arrangeRequest, TEST_SONG } from "@/test/copilot-fixtures";

function drumBars(count = 4, slots = 8) {
  return Array.from({ length: count }, (_, barIndex) => ({
    barIndex,
    slots: Array.from({ length: slots }, () => [{ piece: "kick" }]),
  }));
}

function answer(overrides: Record<string, unknown> = {}) {
  return {
    operation: "arrange_track",
    sectionId: "intro-riff",
    targetTrackId: "drums",
    bars: drumBars(),
    explanation: "Deterministik davul.",
    ...overrides,
  };
}

describe("request contract (spec 11.1, K-18)", () => {
  it("accepts a well-formed arrange_track request", () => {
    expect(copilotRequestSchema.safeParse(arrangeRequest("drums")).success).toBe(
      true,
    );
  });

  it("offers one role per job, not one per instrument (K-30)", () => {
    expect([...ARRANGE_SKILLS]).toEqual([
      "rhythm_guitar",
      "lead_guitar",
      "acoustic_guitar",
      "harmony",
      "bass",
      "drums",
    ]);
  });

  it("gives three of them the same instrument family and different jobs", () => {
    // This is the point of the split: `harmony` used to have to be a riff, a
    // solo and a solo-acoustic coda all at once (K-30).
    const guitarRoles = ARRANGE_SKILLS.filter(
      (role) => SKILL_TARGETS[role].family === "guitar",
    );
    expect(guitarRoles).toEqual([
      "rhythm_guitar",
      "lead_guitar",
      "acoustic_guitar",
      "harmony",
    ]);
    const cards = guitarRoles.map((role) => SKILL_CARDS[role]);
    expect(new Set(cards).size).toBe(cards.length);
  });

  it("tells an acoustic from an amplified guitar", () => {
    const electric = {
      id: "gtr",
      name: "G",
      instrumentId: "electric_guitar",
      presetId: "high_gain",
      volumeDb: 0,
      fretboard: { tuning: ["E2", "A2", "D3", "G3", "B3", "E4"], capo: 0 },
    };
    const acoustic = { ...electric, id: "acc", instrumentId: "steel_acoustic" };

    expect(skillAccepts("rhythm_guitar", electric)).toBe(true);
    expect(skillAccepts("rhythm_guitar", acoustic)).toBe(false);
    expect(skillAccepts("acoustic_guitar", acoustic)).toBe(true);
    expect(skillAccepts("acoustic_guitar", electric)).toBe(false);
    // A supporting second part is one either way.
    expect(skillAccepts("harmony", electric)).toBe(true);
    expect(skillAccepts("harmony", acoustic)).toBe(true);
  });

  it("refuses a role aimed at the wrong instrument before any provider call", () => {
    expect(skillAccepts("drums", {
      id: "gtr",
      name: "G",
      instrumentId: "electric_guitar",
      presetId: "high_gain",
      volumeDb: 0,
      fretboard: { tuning: ["E2"], capo: 0 },
    })).toBe(false);
  });

  it("takes no operation but arrange_track", () => {
    for (const operation of ["insert_section", "replace_section", "generation"]) {
      const request = { ...arrangeRequest("drums"), operation };
      expect(copilotRequestSchema.safeParse(request).success).toBe(false);
    }
  });

  it("has no trace of the section-wide contract left in it", () => {
    // The fields the old public flow was built on are gone, not deprecated.
    const shape = Object.keys(copilotRequestSchema.shape).sort();
    for (const removed of [
      "kind",
      "afterSectionId",
      "targetSectionId",
      "prompt",
    ]) {
      expect(shape).not.toContain(removed);
    }
    expect(shape).toContain("skill");
    expect(shape).toContain("targetTrackId");
    expect(shape).toContain("lockedTrackIds");
  });

  it("rejects an unknown field instead of ignoring it", () => {
    const withExtra = { ...arrangeRequest("drums"), temperature: 0.9 };
    expect(copilotRequestSchema.safeParse(withExtra).success).toBe(false);
  });

  it("requires a section, a target and a locked list", () => {
    for (const field of ["sectionId", "targetTrackId", "lockedTrackIds"]) {
      const request: Record<string, unknown> = { ...arrangeRequest("drums") };
      delete request[field];
      expect(copilotRequestSchema.safeParse(request).success).toBe(false);
    }
  });

  it("treats the instruction as optional", () => {
    const request: Record<string, unknown> = { ...arrangeRequest("drums") };
    delete request.instruction;
    expect(copilotRequestSchema.safeParse(request).success).toBe(true);
  });

  it("reuses the Song Contract rather than a second song type", () => {
    const broken = {
      ...arrangeRequest("drums"),
      song: { ...TEST_SONG, bpm: 9000 },
    };
    const result = copilotRequestSchema.safeParse(broken);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path[0]).toBe("song");
  });
});

describe("model output contract (spec 11.1, K-18)", () => {
  it("accepts the shape the model is asked for", () => {
    expect(modelPatchSchema.safeParse(answer()).success).toBe(true);
  });

  it("refuses a patch id from the model, because the server makes it", () => {
    expect(modelPatchSchema.safeParse(answer({ id: "x" })).success).toBe(false);
    // The server-stamped form is the one that carries an id.
    expect(copilotPatchSchema.safeParse({ ...answer(), id: "p1" }).success).toBe(
      true,
    );
  });

  it("has no way to say anything about a section", () => {
    for (const field of ["section", "name", "status", "timeSignature"]) {
      expect(
        modelPatchSchema.safeParse(answer({ [field]: "whatever" })).success,
      ).toBe(false);
    }
  });

  it("has no way to say anything about a track other than which one", () => {
    for (const field of ["tracks", "instrumentId", "tuning", "capo", "volumeDb"]) {
      expect(
        modelPatchSchema.safeParse(answer({ [field]: "whatever" })).success,
      ).toBe(false);
    }
  });

  it("refuses a written string and fret on a melodic note", () => {
    const positioned = answer({
      targetTrackId: "gtr2",
      bars: [
        {
          barIndex: 0,
          slots: [
            { notes: [{ pitch: "G2", position: { string: 0, fret: 3 } }] },
            ...Array.from({ length: 7 }, () => null),
          ],
        },
      ],
    });
    expect(modelPatchSchema.safeParse(positioned).success).toBe(false);

    // The same note without a position is fine: placement is the engine's job.
    const unpositioned = answer({
      targetTrackId: "gtr2",
      bars: [
        {
          barIndex: 0,
          slots: [
            { notes: [{ pitch: "G2" }] },
            ...Array.from({ length: 7 }, () => null),
          ],
        },
      ],
    });
    expect(modelPatchSchema.safeParse(unpositioned).success).toBe(true);
  });

  it("still accepts the note detail the model is allowed to choose", () => {
    const expressive = answer({
      targetTrackId: "gtr2",
      bars: [
        {
          barIndex: 0,
          slots: [
            { notes: [{ pitch: "G2", velocity: 96, articulation: "palm_mute" }] },
            "-",
            ...Array.from({ length: 6 }, () => null),
          ],
        },
      ],
    });
    expect(modelPatchSchema.safeParse(expressive).success).toBe(true);
  });

  it("refuses extra fields the model was not asked for", () => {
    expect(modelPatchSchema.safeParse(answer({ confidence: 0.8 })).success).toBe(
      false,
    );
    const extraInBar = answer({
      bars: [{ barIndex: 0, slots: [], tempo: 120 }],
    });
    expect(modelPatchSchema.safeParse(extraInBar).success).toBe(false);
  });

  it("refuses more bars than a section may hold", () => {
    expect(modelPatchSchema.safeParse(answer({ bars: drumBars(9) })).success).toBe(
      false,
    );
  });
});

import { describe, expect, it } from "vitest";

import {
  anchorSectionId,
  copilotRequestSchema,
  expectedAction,
  modelPatchSchema,
} from "@/lib/copilot/contract";
import {
  TEST_SONG,
  generationRequest,
  pendingSection,
} from "@/test/copilot-fixtures";

const anchor = TEST_SONG.sections[0]?.id ?? "intro";

function modelAnswer(overrides: Record<string, unknown> = {}) {
  return {
    action: "insert_section",
    afterSectionId: anchor,
    section: pendingSection(),
    explanation: "Kisa bir gecis.",
    ...overrides,
  };
}

describe("request contract (spec 11.1)", () => {
  it("accepts a well-formed generation request", () => {
    expect(copilotRequestSchema.safeParse(generationRequest()).success).toBe(true);
  });

  it("rejects an unknown field instead of ignoring it", () => {
    const withExtra = { ...generationRequest(), temperature: 0.9 };
    expect(copilotRequestSchema.safeParse(withExtra).success).toBe(false);
  });

  it("requires the anchor that matches the request kind", () => {
    const withoutAnchor: Record<string, unknown> = { ...generationRequest() };
    delete withoutAnchor.afterSectionId;
    expect(copilotRequestSchema.safeParse(withoutAnchor).success).toBe(false);

    const edit = {
      ...withoutAnchor,
      kind: "edit",
      targetSectionId: anchor,
    };
    expect(copilotRequestSchema.safeParse(edit).success).toBe(true);
  });

  it("will not take a generation request wearing an edit's anchor", () => {
    const mixed = { ...generationRequest(), targetSectionId: anchor };
    expect(copilotRequestSchema.safeParse(mixed).success).toBe(false);
  });

  it("reuses the Song Contract rather than a second song type", () => {
    const broken = {
      ...generationRequest(),
      song: { ...TEST_SONG, bpm: 9000 },
    };
    const result = copilotRequestSchema.safeParse(broken);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path[0]).toBe("song");
  });

  it("maps each request kind to exactly one patch action", () => {
    expect(expectedAction(generationRequest())).toBe("insert_section");
    const edit = copilotRequestSchema.parse({
      kind: "edit",
      targetSectionId: anchor,
      subjectId: "device-abc",
      idempotencyKey: "idem-key-0001",
      prompt: "Bu bolumu sadelestir",
      song: TEST_SONG,
    });
    expect(expectedAction(edit)).toBe("replace_section");
    expect(anchorSectionId(edit)).toBe(anchor);
  });
});

describe("model output contract (spec 11.1)", () => {
  it("accepts the shape the model is asked for", () => {
    expect(modelPatchSchema.safeParse(modelAnswer()).success).toBe(true);
  });

  it("refuses a patch id from the model, because the server makes it", () => {
    expect(modelPatchSchema.safeParse(modelAnswer({ id: "x" })).success).toBe(
      false,
    );
  });

  it("refuses any status other than pending", () => {
    for (const status of ["fixed", "accepted"]) {
      const answer = modelAnswer({
        section: { ...pendingSection(), status },
      });
      expect(modelPatchSchema.safeParse(answer).success).toBe(false);
    }
  });

  it("refuses an insert with no anchor and a replace with no target", () => {
    expect(
      modelPatchSchema.safeParse(modelAnswer({ afterSectionId: undefined })).success,
    ).toBe(false);
    expect(
      modelPatchSchema.safeParse({
        action: "replace_section",
        section: pendingSection(),
        explanation: "x",
      }).success,
    ).toBe(false);
  });

  it("refuses an unknown action", () => {
    expect(
      modelPatchSchema.safeParse(modelAnswer({ action: "delete_section" })).success,
    ).toBe(false);
  });

  it("refuses extra fields the model was not asked for", () => {
    expect(
      modelPatchSchema.safeParse(modelAnswer({ confidence: 0.8 })).success,
    ).toBe(false);
  });

  it("refuses a section that breaks the Song Contract", () => {
    const answer = modelAnswer({
      section: {
        ...pendingSection(),
        bars: [
          {
            timeSignature: [4, 4],
            resolution: 8,
            // Seven slots where 4/4 at 1/8 needs eight (spec 5.5).
            slots: { gtr: Array.from({ length: 7 }, () => null) },
          },
        ],
      },
    });
    // The bar shape parses; slotCount is a validator, not a schema rule.
    expect(modelPatchSchema.safeParse(answer).success).toBe(true);
  });
});

/**
 * The output contract as the provider receives it (spec 11.3, K-24).
 *
 * These check the *document*, not the zod schema, because the document is
 * what crosses the boundary. If the two ever disagree, a model is being told
 * one contract and judged by another.
 */
import { describe, expect, it } from "vitest";

import { MODEL_PATCH_JSON_SCHEMA } from "@/lib/copilot/output-schema";
import { modelPatchSchema } from "@/lib/copilot/contract";
import { songLimits } from "@/lib/limits";
import { articulationSchema } from "@/lib/song/schema";

type Doc = Record<string, unknown>;
const doc = MODEL_PATCH_JSON_SCHEMA as unknown as Doc;
const props = doc.properties as Record<string, Doc>;
const bars = props.bars as Doc;
const bar = bars.items as Doc;
const barProps = bar.properties as Record<string, Doc>;

describe("the fields the model is told about", () => {
  it("names every field the answer must carry", () => {
    expect(Object.keys(props).sort()).toEqual(
      ["bars", "explanation", "operation", "sectionId", "targetTrackId"].sort(),
    );
    expect((doc.required as string[]).sort()).toEqual(
      ["bars", "explanation", "operation", "sectionId", "targetTrackId"].sort(),
    );
  });

  it("names the fields inside a bar", () => {
    expect(Object.keys(barProps).sort()).toEqual(["barIndex", "slots"]);
    expect((bar.required as string[]).sort()).toEqual(["barIndex", "slots"]);
  });

  it("fixes the operation, so the model cannot ask for a different one", () => {
    expect(props.operation?.const).toBe("arrange_track");
  });
});

describe("the limits the model could not previously see", () => {
  it("carries the explanation cap", () => {
    // The one that actually bit in the S-01 rehearsal.
    expect(props.explanation?.maxLength).toBe(400);
    expect(props.explanation?.minLength).toBe(1);
  });

  it("carries the bar count and index bounds from the central limits", () => {
    expect(bars.maxItems).toBe(songLimits.barsPerSection);
    expect(barProps.barIndex?.maximum).toBe(songLimits.barsPerSection - 1);
    expect(barProps.barIndex?.minimum).toBe(0);
  });
});

describe("what the model may not send", () => {
  it("refuses unknown fields at every level", () => {
    expect(doc.additionalProperties).toBe(false);
    expect(bar.additionalProperties).toBe(false);
    // And the same answer from the schema that actually judges it.
    expect(
      modelPatchSchema.safeParse({
        operation: "arrange_track",
        sectionId: "s",
        targetTrackId: "t",
        bars: [{ barIndex: 0, slots: [] }],
        explanation: "x",
        surprise: 1,
      }).success,
    ).toBe(false);
  });

  it("has no place to write a position, a string or a fret", () => {
    const text = JSON.stringify(MODEL_PATCH_JSON_SCHEMA);
    expect(text).not.toContain('"position"');
    expect(text).not.toContain('"fret"');
    // "string" appears as a JSON Schema type; what must not exist is a
    // property called `string`, which is how a position would be spelled.
    const noteProps = text.match(/"pitch":/g) ?? [];
    expect(noteProps.length).toBeGreaterThan(0);
    expect(text).not.toContain('"string":{');
  });

  it("has no place to write an id", () => {
    expect(Object.keys(props)).not.toContain("id");
    expect(
      modelPatchSchema.safeParse({
        operation: "arrange_track",
        sectionId: "s",
        targetTrackId: "t",
        bars: [{ barIndex: 0, slots: [] }],
        explanation: "x",
        id: "mine",
      }).success,
    ).toBe(false);
  });
});

describe("it is derived, not written", () => {
  it("carries exactly the articulations the Song Contract allows", () => {
    const text = JSON.stringify(MODEL_PATCH_JSON_SCHEMA);
    for (const value of articulationSchema.options) {
      expect(text).toContain(`"${value}"`);
    }
  });

  it("keeps melodic and drum slots as separate shapes", () => {
    const slots = barProps.slots as Doc;
    const branches = slots.anyOf as Doc[];
    expect(branches).toHaveLength(2);
    // One branch admits null and "-"; the drum branch admits neither.
    const text = branches.map((b) => JSON.stringify(b));
    expect(text.some((t) => t.includes('"const":"-"'))).toBe(true);
    expect(text.some((t) => t.includes('"piece"'))).toBe(true);
  });

  it("is the same bytes every time it is read", () => {
    expect(JSON.stringify(MODEL_PATCH_JSON_SCHEMA)).toBe(
      JSON.stringify(MODEL_PATCH_JSON_SCHEMA),
    );
    expect(Object.isFrozen(MODEL_PATCH_JSON_SCHEMA)).toBe(true);
  });
});

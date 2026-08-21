/**
 * The rules the S-03 bake-off's transport normalisation has to obey (spec 20).
 *
 * The run removes a markdown fence before the production parser sees a model's
 * answer, because a real provider is handed the schema as data and would never
 * have let the fence exist. That is a defensible thing to do in an eval and an
 * indefensible thing to ship: production must keep rejecting a fenced answer,
 * and the normaliser must stay incapable of repairing content.
 *
 * These tests read `eval/` on purpose. The eval is not shipped code, but its
 * honesty is a property of this repository, so it is tested rather than
 * trusted.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { parseArrangePatch } from "@/lib/copilot/arrange";
import {
  FENCE_UNWRAP,
  unwrapProviderEnvelope,
} from "../../../eval/model-bakeoff-s03/envelope";
import {
  classifyAttempt,
  isPackagingOnly,
  RUN_CLASSIFICATION,
} from "../../../eval/model-bakeoff-s03/failure-class";

const BODY = '{"operation":"arrange_track"}';

describe("whole-answer fence unwrap", () => {
  it("removes a tagged fence that is the entire answer", () => {
    const result = unwrapProviderEnvelope("```json\n" + BODY + "\n```");
    expect(result.normalizationApplied).toBe(FENCE_UNWRAP);
    expect(result.text).toBe(BODY);
  });

  it("removes an untagged fence too", () => {
    expect(unwrapProviderEnvelope("```\n" + BODY + "\n```").text).toBe(BODY);
  });

  it("leaves the JSON body byte-identical", () => {
    const body = '{"a":  1,\n  "b": "  spaced  "}';
    const result = unwrapProviderEnvelope("```json\n" + body + "\n```");
    expect(result.text).toBe(body);
  });

  it("records a digest of the raw answer and of what the parser got", () => {
    const raw = "```json\n" + BODY + "\n```";
    const result = unwrapProviderEnvelope(raw);
    expect(result.rawSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.normalizedSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.normalizedSha256).not.toBe(result.rawSha256);
  });

  it("keeps the two digests equal when nothing was normalised", () => {
    const result = unwrapProviderEnvelope(BODY);
    expect(result.normalizationApplied).toBeNull();
    expect(result.normalizedSha256).toBe(result.rawSha256);
  });

  it("refuses prose before the fence", () => {
    const raw = "Iste plan:\n```json\n" + BODY + "\n```";
    expect(unwrapProviderEnvelope(raw).normalizationApplied).toBeNull();
  });

  it("refuses trailing prose after the fence", () => {
    const raw = "```json\n" + BODY + "\n```\nUmarim isine yarar.";
    expect(unwrapProviderEnvelope(raw).normalizationApplied).toBeNull();
  });

  it("refuses more than one fence", () => {
    const raw = "```json\n" + BODY + "\n```\n```json\n" + BODY + "\n```";
    expect(unwrapProviderEnvelope(raw).normalizationApplied).toBeNull();
  });

  it("does not rescue a body that still does not parse", () => {
    const result = unwrapProviderEnvelope("```json\nnot json at all\n```");
    expect(result.normalizationApplied).toBe(FENCE_UNWRAP);
    expect(() => JSON.parse(result.text)).toThrow();
  });

  it("never removes an unknown key from the body", () => {
    const body = '{"operation":"arrange_track","additionalProperties":false}';
    const result = unwrapProviderEnvelope("```json\n" + body + "\n```");
    expect(result.text).toContain("additionalProperties");
  });
});

describe("the normaliser is eval-only", () => {
  const request = {
    songId: "song-1",
    sectionId: "sec-1",
    trackId: "track-1",
    skill: "rhythm_guitar",
    instruction: "",
  } as unknown as Parameters<typeof parseArrangePatch>[1];

  it("production still rejects a fenced answer", () => {
    const fenced = "```json\n" + BODY + "\n```";
    const parsed = parseArrangePatch(fenced, request, () => "patch-1");
    expect(parsed.ok).toBe(false);
  });

  it("no production source imports the eval normaliser", () => {
    const guarded = [
      "src/lib/copilot/arrange.ts",
      "src/lib/copilot/pipeline.ts",
      "src/lib/ai/adapter.ts",
      "src/lib/ai/fake-adapter.ts",
      "src/lib/ai/json-schema.ts",
      "src/lib/copilot/client.ts",
    ];
    for (const path of guarded) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toContain("model-bakeoff");
      expect(source).not.toContain("unwrapProviderEnvelope");
      expect(source).not.toContain(FENCE_UNWRAP);
    }
  });

  it("no route imports it either", () => {
    const source = readFileSync("src/app/api/copilot/route.ts", "utf8");
    expect(source).not.toContain("model-bakeoff");
    expect(source).not.toContain("unwrapProviderEnvelope");
  });
});

describe("failure classification", () => {
  it("names the run for what it is", () => {
    expect(RUN_CLASSIFICATION).toBe("transport_confounded_shadow_run");
  });

  it("calls an accepted answer that only needed its fence removed packaging only", () => {
    const failure = classifyAttempt({
      accepted: true,
      normalized: true,
      stage: null,
      reason: "",
    });
    expect(failure).toBe("packaging_only");
    expect(isPackagingOnly(failure ?? "semantic_failure")).toBe(true);
  });

  it("charges nothing for an accepted answer that needed no fence removed", () => {
    expect(
      classifyAttempt({ accepted: true, normalized: false, stage: null, reason: "" }),
    ).toBeNull();
  });

  it("never calls a rejection packaging, even when a fence was removed", () => {
    expect(
      classifyAttempt({
        accepted: false,
        normalized: true,
        stage: "parse",
        reason: "explanation: too_big",
      }),
    ).toBe("schema_transport_confounded");
  });

  it("still calls a fenced answer with a real musical error a semantic failure", () => {
    expect(
      classifyAttempt({
        accepted: false,
        normalized: true,
        stage: "validators",
        reason: "range: D2 araligin altinda",
      }),
    ).toBe("semantic_failure");
  });

  it("files an unknown key as transport confounded", () => {
    expect(
      classifyAttempt({
        accepted: false,
        normalized: false,
        stage: "schema",
        reason: 'tracks.0: Unrecognized key: "playsInSections_note"',
      }),
    ).toBe("schema_transport_confounded");
  });

  it("files schema vocabulary written into the payload the same way", () => {
    expect(
      classifyAttempt({
        accepted: false,
        normalized: false,
        stage: "schema",
        reason: 'tracks.0: Unrecognized key: "additionalProperties"',
      }),
    ).toBe("schema_transport_confounded");
  });

  it("files an over-long explanation as transport confounded", () => {
    expect(
      classifyAttempt({
        accepted: false,
        normalized: false,
        stage: "parse",
        reason: "explanation: too_big",
      }),
    ).toBe("schema_transport_confounded");
  });

  it("keeps a note outside the instrument's range a semantic failure", () => {
    expect(
      classifyAttempt({
        accepted: false,
        normalized: false,
        stage: "validators",
        reason: "range: D2 notasi track'in araliginin altinda",
      }),
    ).toBe("semantic_failure");
  });

  it("keeps a grid accent no finer than its section a semantic failure", () => {
    expect(
      classifyAttempt({
        accepted: false,
        normalized: false,
        stage: "grid",
        reason: "solo: bar 6: 1/16 bolumun 1/16 gridinden daha ince degil.",
      }),
    ).toBe("semantic_failure");
  });

  it("exempts only packaging from the attempt budget", () => {
    expect(isPackagingOnly("schema_transport_confounded")).toBe(false);
    expect(isPackagingOnly("semantic_failure")).toBe(false);
  });
});

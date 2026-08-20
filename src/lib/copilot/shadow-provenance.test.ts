/**
 * The rules the S-02 rehearsal is allowed to be written up under (spec 20).
 *
 * S-01's delivery report said a provider model had produced its answers. No
 * provider was called. The claim was possible because nothing in the run
 * recorded who wrote anything, and nothing in the test suite objected. These
 * tests are the objection: the artifacts on disk have to say how they were
 * made, the record has to match what actually happened, and the two places a
 * rehearsal could quietly cheat — a hand-supplied blueprint, a motif smuggled
 * into the instruction — have to leave a mark.
 *
 * They read `eval/` from disk on purpose. The eval is not shipped code, but
 * its honesty is a property of this repository, so it is tested here rather
 * than trusted.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { compositionBlueprintSchema } from "@/lib/copilot/blueprint";
import {
  assertHonestProvenance,
  hashOf,
  labelFor,
  S02_ORIGIN,
  type ShadowProvenance,
} from "../../../eval/shadow-s02/provenance";
import { RAW_REQUEST, TURNS } from "../../../eval/shadow-s02/turns";

const ARTIFACTS = "eval/shadow-s02/artifacts";
const read = (name: string) => readFileSync(`${ARTIFACTS}/${name}`, "utf8");
const json = (name: string) => JSON.parse(read(name)) as unknown;

const PROVENANCE = json("provenance.json") as ShadowProvenance[];
const BLUEPRINT_TEXT = read("blueprint.json");

/** Names the musician used. They belong in the request, nowhere else. */
const ARTISTS = ["Pantera", "Opeth"];

describe("what S-02 is, on the record", () => {
  it("records an origin for every answer, the blueprint included", () => {
    expect(PROVENANCE).toHaveLength(TURNS.length + 1);
    expect(
      PROVENANCE.filter((entry) => entry.operation === "composition_blueprint"),
    ).toHaveLength(1);
  });

  it("says coding agent simulation and nothing grander", () => {
    for (const entry of PROVENANCE) {
      expect(entry.generationMode).toBe("coding_agent_simulation");
      expect(entry.providerInvocation).toBe(false);
      expect(entry.providerName).toBeUndefined();
    }
    expect(S02_ORIGIN.providerInvocation).toBe(false);
    expect(labelFor(PROVENANCE[0] as ShadowProvenance)).toContain(
      "no provider call",
    );
  });

  it("carries no latency or cost, because there was nothing to measure", () => {
    for (const entry of PROVENANCE) {
      const keys = Object.keys(entry);
      expect(keys).not.toContain("latencyMs");
      expect(keys).not.toContain("costUsd");
      expect(keys).not.toContain("usage");
    }
  });

  it("refuses to be relabelled as a provider eval", () => {
    const asProvider = {
      ...(PROVENANCE[0] as ShadowProvenance),
      generationMode: "provider" as const,
    };
    expect(() => assertHonestProvenance(asProvider)).toThrow();
    expect(() => labelFor(asProvider)).toThrow();

    // The other direction is just as wrong: a real call with nothing named.
    expect(() =>
      assertHonestProvenance({
        ...(PROVENANCE[0] as ShadowProvenance),
        generationMode: "provider",
        providerInvocation: true,
      }),
    ).toThrow();

    // And an exact id may only ever come from runtime metadata.
    expect(() =>
      assertHonestProvenance({
        ...(PROVENANCE[0] as ShadowProvenance),
        exactModelId: "some-model",
        modelIdVerified: false,
      }),
    ).toThrow();
  });

  it("holds every recorded entry to that rule, not just the first", () => {
    for (const entry of PROVENANCE) {
      expect(() => assertHonestProvenance(entry)).not.toThrow();
    }
  });
});

describe("the blueprint on disk is the blueprint that was used", () => {
  it("hashes to what the run recorded", () => {
    const parsed = compositionBlueprintSchema.parse(JSON.parse(BLUEPRINT_TEXT));
    const record = PROVENANCE.find(
      (entry) => entry.operation === "composition_blueprint",
    );
    expect(record?.responseHash).toBe(hashOf(JSON.stringify(parsed)));
  });

  it("passes the same strict schema the production path would use", () => {
    expect(() =>
      compositionBlueprintSchema.parse(JSON.parse(BLUEPRINT_TEXT)),
    ).not.toThrow();
  });

  it("turned the artist names into features, and left the names in the request", () => {
    for (const artist of ARTISTS) {
      expect(RAW_REQUEST).toContain(artist);
      expect(read("raw-request.json")).toContain(artist);
      expect(BLUEPRINT_TEXT).not.toContain(artist);
      expect(read("skeleton.json")).not.toContain(artist);
      expect(read("final-song.json")).not.toContain(artist);
    }
  });
});

describe("a turn is not told what it is supposed to discover", () => {
  const blueprint = compositionBlueprintSchema.parse(JSON.parse(BLUEPRINT_TEXT));

  /** The per-turn part of the instruction: everything after the raw request. */
  const localOf = (instruction: string) =>
    instruction.slice(instruction.indexOf(RAW_REQUEST) + RAW_REQUEST.length);

  it("never writes a pitch into the instruction", () => {
    // A motif handed over as note names is the S-01 workaround. The context
    // block is where a turn is shown what came before it now.
    for (const turn of TURNS) {
      expect(localOf(turn.instruction)).not.toMatch(/\b[A-G](#|b)?[0-9]\b/);
    }
  });

  it("never restates the blueprint's motif in words either", () => {
    const motifText = blueprint.motifs.flatMap((motif) => [
      motif.rhythmSignature,
      motif.accentStructure,
      motif.pitchContour,
      motif.spaceCharacter,
    ]);
    for (const turn of TURNS) {
      const local = localOf(turn.instruction);
      for (const phrase of motifText) {
        expect(local).not.toContain(phrase);
      }
    }
  });

  it("keeps the musician's own words verbatim in every turn", () => {
    for (const turn of TURNS) {
      expect(turn.instruction.startsWith(RAW_REQUEST)).toBe(true);
    }
  });
});

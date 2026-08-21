/**
 * The Blueprint Intent Preservation Gate (spec 5.2, K-35).
 *
 * S-03 asked for a close with no electric guitar, the plan said so, and the
 * rendered piece had one in it anyway. These tests exist so that cannot happen
 * quietly again: the intent has to reach the Song, an unavailable intent has to
 * fail loudly rather than fall back, and a section planned as acoustic has to
 * be acoustic in the Song itself.
 */
import { describe, expect, it } from "vitest";

import {
  allowedInstrumentsFor,
  resolveInstrumentIntent,
} from "@/lib/copilot/instrument-intent";
import {
  acousticOnlySectionKeys,
  checkSectionIsolation,
  materializeSongSkeleton,
} from "@/lib/copilot/materialize";
import { compositionBlueprintSchema } from "@/lib/copilot/blueprint";
import { isAcousticInstrument } from "@/lib/instruments/registry";
import type { ArrangeSkill } from "@/lib/copilot/contract";

const resolve = (
  role: ArrangeSkill,
  presetIntent: string,
  family = "guitar",
  tuningIntent = "standard tuning",
) => resolveInstrumentIntent({ role, family, presetIntent, tuningIntent });

describe("instrument intent resolves against the registry", () => {
  it("turns a clean acoustic intent into a real acoustic instrument", () => {
    const result = resolve("harmony", "Second clean acoustic voice, soft attack, upper register");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isAcousticInstrument(result.instrumentId)).toBe(true);
    expect(result.source).toBe("blueprint_intent");
  });

  it("keeps an electric rhythm intent electric", () => {
    const result = resolve("rhythm_guitar", "High-gain, tight low end with present midrange");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.instrumentId).toBe("electric_guitar");
    expect(result.presetId).toBe("high_gain");
  });

  it("keeps a lead intent electric", () => {
    const result = resolve("lead_guitar", "High-gain lead voice with long sustain and bite");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.instrumentId).toBe("electric_guitar");
  });

  it("reads a nylon intent as the nylon guitar, not the steel string", () => {
    const result = resolve("acoustic_guitar", "Warm nylon classical guitar");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.instrumentId).toBe("nylon_guitar");
    expect(result.presetId).toBe("warm");
  });

  it("applies the role default when the plan names no instrument", () => {
    const result = resolve("harmony", "A second voice at the interval above");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe("role_default");
    expect(result.instrumentId).toBe("electric_guitar");
  });

  it("fails closed when a role is asked for an instrument it cannot be", () => {
    const result = resolve("rhythm_guitar", "Natural steel-string acoustic, no drive");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("steel_acoustic");
    expect(result.reason).toContain("rhythm_guitar");
  });

  it("never silently substitutes an electric guitar for a refused intent", () => {
    const result = resolve("lead_guitar", "Nylon-string classical tone");
    expect(result.ok).toBe(false);
  });

  it("fails closed when the declared family contradicts the named instrument", () => {
    const result = resolveInstrumentIntent({
      role: "drums",
      family: "guitar",
      presetIntent: "Dry punchy kit",
      tuningIntent: "tight",
    });
    expect(result.ok).toBe(false);
  });

  it("only ever returns presets the registry actually has", () => {
    for (const role of ["rhythm_guitar", "lead_guitar", "harmony", "acoustic_guitar", "bass", "drums"] as const) {
      for (const intent of ["clean acoustic", "high gain heavy", "warm nylon", "driven pick", "", "electronic"]) {
        const result = resolve(role, intent, role === "drums" ? "drums" : role === "bass" ? "bass" : "guitar");
        if (!result.ok) continue;
        expect(allowedInstrumentsFor(role)).toContain(result.instrumentId);
      }
    }
  });
});

/** A minimal blueprint with one acoustic-only closing section. */
function blueprintWith(harmonyPresetIntent: string) {
  return compositionBlueprintSchema.parse({
    version: 1,
    targetDurationSeconds: 30,
    durationToleranceSeconds: 5,
    tonalCenter: "E minor",
    tuningIntent: "standard",
    resolution: 16,
    referenceTraits: ["dark"],
    tracks: [
      {
        role: "rhythm_guitar",
        instrumentFamily: "guitar",
        presetIntent: "High-gain tight rhythm tone",
        tuningIntent: "standard",
        playsInSections: ["riff"],
        energyJob: "carries the riff",
        required: true,
        rationale: "the spine",
      },
      {
        role: "acoustic_guitar",
        instrumentFamily: "guitar",
        presetIntent: "Natural steel-string acoustic, no drive",
        tuningIntent: "standard, open strings ringing",
        playsInSections: ["coda"],
        energyJob: "carries the close",
        required: true,
        rationale: "the close",
      },
      {
        role: "harmony",
        instrumentFamily: "guitar",
        presetIntent: harmonyPresetIntent,
        tuningIntent: "standard",
        playsInSections: ["coda"],
        energyJob: "second voice",
        required: false,
        rationale: "interval colour",
      },
    ],
    motifs: [
      {
        key: "cell",
        rhythmSignature: "two bar cell",
        accentStructure: "beat one",
        pitchContour: "root anchored",
        spaceCharacter: "rests carry",
        rationale: "the hook",
      },
    ],
    sections: [
      {
        key: "riff",
        displayName: "Riff",
        formRole: "break",
        bars: 2,
        timeSignature: [4, 4],
        bpm: 120,
        energy: "high",
        density: "high",
        tonalJob: "tonic pedal",
        motifKey: "cell",
        motifTransformation: "stated",
        entryIntent: "cold",
        exitIntent: "open",
        linkToPrevious: "",
        linkToNext: "into the coda",
        activeRoles: ["rhythm_guitar"],
        silentRoles: [],
      },
      {
        key: "coda",
        displayName: "Coda",
        formRole: "outro",
        bars: 2,
        timeSignature: [4, 4],
        bpm: 100,
        energy: "low",
        density: "low",
        tonalJob: "resolves",
        motifKey: "cell",
        motifTransformation: "inverted",
        entryIntent: "under the decay",
        exitIntent: "rings out",
        linkToPrevious: "continues",
        linkToNext: "",
        activeRoles: ["acoustic_guitar", "harmony"],
        silentRoles: ["rhythm_guitar"],
      },
    ],
    requestedTechniques: [],
    omittedRequests: [],
  });
}

describe("a section planned as acoustic is acoustic in the Song", () => {
  it("materialises an acoustic-intent harmony onto an acoustic instrument", () => {
    const built = materializeSongSkeleton(blueprintWith("Second clean acoustic voice, soft attack"));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const harmony = built.song.tracks.find((track) => track.id === "harmony");
    expect(harmony && isAcousticInstrument(harmony.instrumentId)).toBe(true);
  });

  it("leaves no electric, bass or drum track key in the acoustic section", () => {
    const built = materializeSongSkeleton(blueprintWith("Second clean acoustic voice, soft attack"));
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const coda = built.song.sections.find((section) => section.name === "Coda");
    const keys = new Set(coda?.bars.flatMap((bar) => Object.keys(bar.slots)) ?? []);
    expect(keys).toEqual(new Set(["acoustic_guitar", "harmony"]));
    expect(keys.has("rhythm_guitar")).toBe(false);
  });

  it("does not fake silence with an empty slot array", () => {
    const built = materializeSongSkeleton(blueprintWith("Second clean acoustic voice, soft attack"));
    if (!built.ok) return;
    const coda = built.song.sections.find((section) => section.name === "Coda");
    for (const bar of coda?.bars ?? []) {
      expect(Object.keys(bar.slots)).not.toContain("rhythm_guitar");
    }
  });

  it("names the acoustic-only sections from the plan", () => {
    const keys = acousticOnlySectionKeys(blueprintWith("clean acoustic"));
    expect([...keys]).toEqual(["coda"]);
  });

  it("catches an electric guitar that reached an acoustic section", () => {
    const built = materializeSongSkeleton(blueprintWith("Second clean acoustic voice, soft attack"));
    if (!built.ok) return;
    const coda = built.song.sections.find((section) => section.name === "Coda");
    expect(coda).toBeDefined();
    if (!coda) return;

    /* Put an electric track key into the acoustic section and confirm the
     * invariant objects. This is the S-03 bug, reconstructed. */
    const contaminated = {
      ...built.song,
      sections: built.song.sections.map((section) =>
        section.id !== coda.id
          ? section
          : {
              ...section,
              bars: section.bars.map((bar) => ({
                ...bar,
                slots: { ...bar.slots, rhythm_guitar: bar.slots.acoustic_guitar ?? [] },
              })),
            },
      ),
    };
    const problems = checkSectionIsolation(contaminated, new Set([coda.id]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("electric_guitar");
  });
});

describe("materialization is deterministic", () => {
  it("gives byte-identical output for the same blueprint five times over", () => {
    const blueprint = blueprintWith("Second clean acoustic voice, soft attack");
    const runs = Array.from({ length: 5 }, () => {
      const built = materializeSongSkeleton(blueprint, { title: "fixed" });
      return built.ok ? JSON.stringify(built.song) : "failed";
    });
    expect(new Set(runs).size).toBe(1);
    expect(runs[0]).not.toBe("failed");
  });
});

/**
 * The plan, and the empty song it becomes (spec 11.8, K-31).
 */
import { describe, expect, it } from "vitest";

import {
  compositionBlueprintSchema,
  type CompositionBlueprint,
} from "@/lib/copilot/blueprint";
import {
  baseBpm,
  blueprintDurationSeconds,
  checkBlueprintDuration,
  materializeSongSkeleton,
  sectionIdFor,
  trackIdFor,
} from "@/lib/copilot/materialize";
import { runValidators } from "@/lib/validators";
import { buildTempoMap } from "@/lib/audio/tempo";
import { songLimits } from "@/lib/limits";

function blueprint(overrides: Partial<CompositionBlueprint> = {}): CompositionBlueprint {
  const raw = {
    version: 1,
    targetDurationSeconds: 60,
    durationToleranceSeconds: 5,
    tonalCenter: "D minor",
    tuningIntent: "drop D",
    resolution: 16,
    referenceTraits: ["syncopated stop-start groove", "half-time drum backbone"],
    tracks: [
      {
        role: "rhythm_guitar",
        instrumentFamily: "guitar",
        presetIntent: "amplified, high gain",
        tuningIntent: "drop D",
        playsInSections: ["a", "b"],
        energyJob: "Ritim gitar",
        required: true,
        rationale: "Ana riff bu track'te.",
      },
      {
        role: "drums",
        instrumentFamily: "drums",
        presetIntent: "rock kit",
        tuningIntent: "n/a",
        playsInSections: ["a"],
        energyJob: "Davul",
        required: true,
        rationale: "Groove'un omurgasi.",
      },
    ],
    motifs: [
      {
        key: "cell",
        rhythmSignature: "0 3 6 10 12 on a sixteenth grid",
        accentStructure: "accents on 0, 6 and 12; the rest choked",
        pitchContour: "1, with b3-2-1 as the answer",
        spaceCharacter: "more than half the bar is silence",
        rationale: "Duraklarla kesilen bir hucre.",
      },
    ],
    sections: [
      {
        key: "a",
        displayName: "Break",
        formRole: "break",
        bars: 4,
        timeSignature: [4, 4],
        bpm: 100,
        energy: "high",
        density: "medium",
        tonalJob: "tonic pedal",
        motifKey: "cell",
        motifTransformation: "stated plainly",
        entryIntent: "straight in",
        exitIntent: "hand over on a held tonic",
        linkToPrevious: "",
        linkToNext: "same rhythmic cell",
        activeRoles: ["rhythm_guitar", "drums"],
        silentRoles: [],
      },
      {
        key: "b",
        displayName: "Outro",
        formRole: "outro",
        bars: 4,
        timeSignature: [4, 4],
        bpm: 80,
        energy: "low",
        density: "low",
        tonalJob: "resolves to the tonic",
        motifKey: "cell",
        motifTransformation: "a quiet shadow of it",
        entryIntent: "takes over the held tonic",
        exitIntent: "left ringing",
        linkToPrevious: "common tone",
        linkToNext: "",
        activeRoles: ["rhythm_guitar"],
        silentRoles: ["drums"],
      },
    ],
    requestedTechniques: [
      { technique: "palm_mute", sectionKey: "a", purpose: "Pedal notayi boguyor." },
    ],
    omittedRequests: [
      { request: "bass", reason: "Dusuk tel yuku ritim gitarda; bas gerekmedi." },
    ],
    ...overrides,
  };
  const parsed = compositionBlueprintSchema.safeParse(raw);
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

describe("the blueprint refuses what it must", () => {
  it("takes a well-formed plan", () => {
    expect(compositionBlueprintSchema.safeParse(blueprint()).success).toBe(true);
  });

  it("rejects an unknown field instead of ignoring it", () => {
    const extra = { ...blueprint(), styleOf: "someone" };
    expect(compositionBlueprintSchema.safeParse(extra).success).toBe(false);
  });

  it("has nowhere to write a persistent id", () => {
    const shape = Object.keys(compositionBlueprintSchema.shape);
    expect(shape).not.toContain("id");
    expect(shape).not.toContain("songId");
    // A section carries an internal key, and it may not look like a Song key.
    const withColon = blueprint();
    const smuggled = {
      ...withColon,
      sections: withColon.sections.map((s) => ({ ...s, key: "sec:0" })),
    };
    expect(compositionBlueprintSchema.safeParse(smuggled).success).toBe(false);
  });

  it("rejects a section id shaped like something the Song would keep", () => {
    for (const key of ["Sec1", "sec 1", "1a", ""]) {
      const bad = blueprint();
      const smuggled = {
        ...bad,
        sections: bad.sections.map((s, i) => (i === 0 ? { ...s, key } : s)),
      };
      expect(compositionBlueprintSchema.safeParse(smuggled).success).toBe(false);
    }
  });
});

describe("how long the plan will last", () => {
  it("is computed from each section's own tempo", () => {
    // 4 bars of 4/4 at 100 = 9.6s; 4 at 80 = 12s.
    expect(blueprintDurationSeconds(blueprint())).toBeCloseTo(9.6 + 12, 6);
  });

  it("says when the plan misses what it asked for", () => {
    const verdict = checkBlueprintDuration(blueprint());
    expect(verdict.target).toBe(60);
    expect(verdict.withinTolerance).toBe(false);
    expect(verdict.driftSeconds).toBeLessThan(0); // it runs short
  });

  it("accepts a plan that hits its target", () => {
    const onTarget = blueprint({ targetDurationSeconds: 21.6, durationToleranceSeconds: 1 });
    expect(checkBlueprintDuration(onTarget).withinTolerance).toBe(true);
  });
});

describe("materialising the skeleton", () => {
  it("derives ids from position and role, never from the model", () => {
    const result = materializeSongSkeleton(blueprint(), { title: "T" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.song.sections.map((s) => s.id)).toEqual(["sec-1", "sec-2"]);
    expect(result.song.tracks.map((t) => t.id)).toEqual(["rhythm_guitar", "drums"]);
    expect(sectionIdFor(0)).toBe("sec-1");
    expect(trackIdFor("rhythm_guitar", 0)).toBe("rhythm_guitar");
    expect(trackIdFor("rhythm_guitar", 1)).toBe("rhythm_guitar-2");
  });

  it("produces a song the Song Contract accepts, with no notes in it", () => {
    const result = materializeSongSkeleton(blueprint(), { title: "T" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(runValidators(result.song).filter((i) => i.severity === "error")).toEqual([]);
    const written = result.song.sections.flatMap((s) =>
      s.bars.flatMap((b) => Object.values(b.slots).flat()),
    );
    expect(written.every((slot) => slot === null || (Array.isArray(slot) && slot.length === 0))).toBe(true);
  });

  it("spells a silent track as absence, not as an array of nulls", () => {
    const result = materializeSongSkeleton(blueprint(), { title: "T" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const outro = result.song.sections[1];
    const keys = new Set(outro?.bars.flatMap((b) => Object.keys(b.slots)) ?? []);
    expect([...keys]).toEqual(["rhythm_guitar"]);
    expect(keys.has("drums")).toBe(false);
  });

  it("writes a tempo only where it differs from the piece's own", () => {
    const result = materializeSongSkeleton(blueprint(), { title: "T" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Both sections are 4 bars, so the tie goes to the earlier one: 100.
    expect(baseBpm(blueprint())).toBe(100);
    expect(result.song.bpm).toBe(100);
    expect(result.song.sections[0]?.bpmOverride).toBeUndefined();
    expect(result.song.sections[1]?.bpmOverride).toBe(80);
  });

  it("carries no override at all when the piece runs at one tempo", () => {
    const flat = blueprint({
      sections: blueprint().sections.map((s) => ({ ...s, bpm: 100 })),
    });
    const result = materializeSongSkeleton(flat, { title: "T" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song.sections.every((s) => s.bpmOverride === undefined)).toBe(true);
  });

  it("materialises to the duration the plan predicted", () => {
    const result = materializeSongSkeleton(blueprint(), { title: "T" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(buildTempoMap(result.song).totalSeconds).toBeCloseTo(
      blueprintDurationSeconds(blueprint()),
      6,
    );
  });

  it("gives the same song every time", () => {
    const a = materializeSongSkeleton(blueprint(), { title: "T" });
    const b = materializeSongSkeleton(blueprint(), { title: "T" });
    expect(a.ok && b.ok && JSON.stringify(a.song) === JSON.stringify(b.song)).toBe(true);
  });

  it("does not touch the blueprint it read", () => {
    const plan = blueprint();
    const before = JSON.stringify(plan);
    materializeSongSkeleton(plan, { title: "T" });
    expect(JSON.stringify(plan)).toBe(before);
  });
});

describe("what the materialiser refuses", () => {
  it("a piece longer than the pilot allows", () => {
    const long = blueprint({
      sections: [
        { ...blueprint().sections[0]!, bars: 8 },
        { ...blueprint().sections[1]!, bars: 8, key: "b" },
        { ...blueprint().sections[0]!, bars: 8, key: "c" },
        { ...blueprint().sections[1]!, bars: 8, key: "d" },
        { ...blueprint().sections[0]!, bars: 8, key: "e" },
      ],
    });
    const result = materializeSongSkeleton(long, { title: "T" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain(String(songLimits.totalBars));
  });

  it("a section that activates a role no track has", () => {
    const orphan = blueprint({
      sections: blueprint().sections.map((s, i) =>
        i === 0 ? { ...s, activeRoles: ["rhythm_guitar", "bass"] as const } : s,
      ),
    });
    const result = materializeSongSkeleton(orphan, { title: "T" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("bass");
  });

  it("two sections sharing an internal key", () => {
    const clash = blueprint({
      sections: blueprint().sections.map((s) => ({ ...s, key: "same" })),
    });
    const result = materializeSongSkeleton(clash, { title: "T" });
    expect(result.ok).toBe(false);
  });
});

describe("artist names do not survive into the plan", () => {
  it("has a field for what a reference meant, and none for what it was called", () => {
    const shape = Object.keys(compositionBlueprintSchema.shape);
    expect(shape).toContain("referenceTraits");
    expect(shape).not.toContain("styleOf");
    expect(shape).not.toContain("artist");
    expect(shape).not.toContain("inTheStyleOf");
  });

  it("keeps the traits as traits", () => {
    const plan = blueprint();
    for (const trait of plan.referenceTraits) {
      expect(trait.length).toBeGreaterThan(0);
    }
    // The whole document, read as text, is the musical description — this is
    // the artifact a reviewer scans, and there is nowhere for a name to hide
    // that the schema would have kept.
    expect(JSON.stringify(plan)).not.toMatch(/in the style of/i);
  });
});

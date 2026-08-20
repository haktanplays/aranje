/**
 * Which grid each bar of a planned piece runs on (spec 5.5, 11.8, K-34).
 */
import { describe, expect, it } from "vitest";

import {
  RHYTHM_GRID_INTENTS,
  compositionBlueprintSchema,
  type CompositionBlueprint,
} from "@/lib/copilot/blueprint";
import {
  barResolution,
  checkGridPlan,
  gridPlan,
  gridUsage,
  sectionResolution,
} from "@/lib/copilot/grid-plan";
import { materializeSongSkeleton } from "@/lib/copilot/materialize";
import { slotCount } from "@/lib/music/timing";
import { PLAN } from "@/test/blueprint-fixture";

const plan = (overrides: Partial<CompositionBlueprint> = {}): CompositionBlueprint =>
  compositionBlueprintSchema.parse({ ...PLAN, ...overrides });

/** The first section, with its bars re-planned. */
function withAccents(
  accents: { barIndex: number; resolution: number; intent?: string }[],
  sectionResolutionValue?: number,
): CompositionBlueprint {
  return plan({
    sections: PLAN.sections.map((section, index) =>
      index === 0
        ? {
            ...section,
            ...(sectionResolutionValue === undefined
              ? {}
              : { resolution: sectionResolutionValue }),
            gridAccents: accents.map((accent) => ({
              barIndex: accent.barIndex,
              resolution: accent.resolution,
              intent: accent.intent ?? "scalar_run",
              purpose: "Hizli bir cumle bu bara sigmiyor.",
            })),
          }
        : section,
    ) as CompositionBlueprint["sections"],
  });
}

describe("the three places a grid can be stated", () => {
  it("falls back to the piece's own grid when nothing else says", () => {
    const blueprint = plan({ resolution: 16 });
    const section = blueprint.sections[0];
    if (!section) throw new Error("fixture has no sections");
    expect(sectionResolution(blueprint, section)).toBe(16);
    expect(barResolution(blueprint, section, 0)).toBe(16);
  });

  it("lets a section run on its own grid without touching the rest", () => {
    const blueprint = plan({
      sections: PLAN.sections.map((section, index) =>
        index === 0 ? { ...section, resolution: 12 } : section,
      ) as CompositionBlueprint["sections"],
    });
    const [first, second] = blueprint.sections;
    if (!first || !second) throw new Error("fixture has too few sections");
    expect(sectionResolution(blueprint, first)).toBe(12);
    expect(sectionResolution(blueprint, second)).toBe(blueprint.resolution);
  });

  it("lets one bar run finer than the section it is in", () => {
    const blueprint = withAccents([{ barIndex: 2, resolution: 32 }]);
    const section = blueprint.sections[0];
    if (!section) throw new Error("fixture has no sections");
    expect(barResolution(blueprint, section, 1)).toBe(16);
    expect(barResolution(blueprint, section, 2)).toBe(32);
    expect(barResolution(blueprint, section, 3)).toBe(16);
  });

  it("does not need a section boundary to change grid (spec 5.5)", () => {
    const blueprint = withAccents([
      { barIndex: 1, resolution: 24, intent: "triplet_groove" },
      { barIndex: 3, resolution: 32, intent: "drum_fill" },
    ]);
    const grids = gridPlan(blueprint)
      .filter((bar) => bar.sectionKey === "a")
      .map((bar) => bar.resolution);
    expect(grids).toEqual([16, 24, 16, 32]);
  });
});

describe("a finer grid has to say what it is for", () => {
  it("offers the vocabulary the contract names", () => {
    expect([...RHYTHM_GRID_INTENTS]).toEqual([
      "scalar_run",
      "legato_burst",
      "arpeggio",
      "triplet_groove",
      "drum_fill",
      "tremolo_burst",
      "ornamented_transition",
    ]);
  });

  it("has nowhere to put a grid change without one", () => {
    const withoutIntent = {
      ...PLAN,
      sections: PLAN.sections.map((section, index) =>
        index === 0
          ? {
              ...section,
              gridAccents: [
                { barIndex: 0, resolution: 32, purpose: "daha hizli" },
              ],
            }
          : section,
      ),
    };
    expect(compositionBlueprintSchema.safeParse(withoutIntent).success).toBe(false);
  });

  it("carries the intent through to the plan", () => {
    const blueprint = withAccents([
      { barIndex: 1, resolution: 24, intent: "legato_burst" },
    ]);
    const bar = gridPlan(blueprint).find(
      (entry) => entry.sectionKey === "a" && entry.barIndex === 1,
    );
    expect(bar?.intent).toBe("legato_burst");
    expect(bar?.purpose).not.toBeNull();
  });

  it("reports no intent for a bar that is simply on the section's grid", () => {
    const blueprint = plan();
    for (const bar of gridPlan(blueprint)) {
      expect(bar.intent).toBeNull();
    }
  });
});

describe("plans that are not plans", () => {
  const problems = (blueprint: CompositionBlueprint) =>
    checkGridPlan(blueprint).map((problem) => problem.message);

  it("accepts the fixture", () => {
    expect(checkGridPlan(plan())).toEqual([]);
  });

  it("refuses an accent that is not finer than its section", () => {
    expect(problems(withAccents([{ barIndex: 0, resolution: 16 }]))).toHaveLength(1);
    expect(problems(withAccents([{ barIndex: 0, resolution: 8 }]))).toHaveLength(1);
    expect(problems(withAccents([{ barIndex: 0, resolution: 24 }]))).toEqual([]);
  });

  it("refuses an accent pointing past the end of its section", () => {
    // The fixture's first section is four bars long.
    expect(problems(withAccents([{ barIndex: 7, resolution: 32 }]))).toHaveLength(1);
  });

  it("refuses two grids for one bar", () => {
    const twice = problems(
      withAccents([
        { barIndex: 1, resolution: 24 },
        { barIndex: 1, resolution: 32 },
      ]),
    );
    expect(twice).toHaveLength(1);
    expect(twice[0]).toContain("iki farklı grid");
  });

  it("refuses a grid the section's meter cannot be written on", () => {
    const compound = plan({
      resolution: 8,
      sections: PLAN.sections.map((section, index) =>
        index === 0
          ? { ...section, timeSignature: [6, 8], resolution: 12 }
          : section,
      ) as CompositionBlueprint["sections"],
    });
    expect(problems(compound)).toHaveLength(1);
  });

  it("stops the materialiser rather than building a broken skeleton", () => {
    const built = materializeSongSkeleton(
      withAccents([{ barIndex: 0, resolution: 8 }]),
      { title: "x" },
    );
    expect(built.ok).toBe(false);
  });
});

describe("the skeleton the plan becomes", () => {
  it("gives every bar the slot count its own grid derives", () => {
    const blueprint = withAccents([
      { barIndex: 1, resolution: 24, intent: "triplet_groove" },
      { barIndex: 2, resolution: 32, intent: "drum_fill" },
    ]);
    const built = materializeSongSkeleton(blueprint, { title: "x" });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const section = built.song.sections[0];
    if (!section) throw new Error("no section");
    expect(section.bars.map((bar) => bar.resolution)).toEqual([16, 24, 32, 16]);
    for (const bar of section.bars) {
      const expected = slotCount(bar.timeSignature, bar.resolution);
      for (const slots of Object.values(bar.slots)) {
        expect(slots).toHaveLength(expected);
      }
    }
  });

  it("keeps a bar the same length in time whatever grid it is on", () => {
    const built = materializeSongSkeleton(
      withAccents([{ barIndex: 1, resolution: 32, intent: "scalar_run" }]),
      { title: "x" },
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const section = built.song.sections[0];
    expect(section?.bars[0]?.slots.rhythm_guitar).toHaveLength(16);
    expect(section?.bars[1]?.slots.rhythm_guitar).toHaveLength(32);
  });
});

describe("what the quality report can see", () => {
  it("counts one grid as one grid", () => {
    const usage = gridUsage(plan());
    expect(usage.singleGrid).toBe(true);
    expect(usage.byResolution).toEqual({ 16: 8 });
    expect(usage.accentedShare).toBe(0);
    expect(usage.highResolutionBars).toBe(0);
  });

  it("counts triplet bars separately from fine straight ones", () => {
    const usage = gridUsage(
      withAccents([
        { barIndex: 0, resolution: 24, intent: "triplet_groove" },
        { barIndex: 1, resolution: 32, intent: "drum_fill" },
      ]),
    );
    expect(usage.tripletBars).toBe(1);
    expect(usage.thirtySecondBars).toBe(1);
    expect(usage.highResolutionBars).toBe(2);
    expect(usage.byIntent.triplet_groove).toBe(1);
    expect(usage.byIntent.drum_fill).toBe(1);
    expect(usage.accentedShare).toBeCloseTo(2 / 8, 6);
  });

  it("makes a piece that is all on 1/32 visible rather than forbidden", () => {
    // Nothing here refuses it. It shows up as eight bars at 32 and no accents
    // at all, which is exactly the shape a reader needs to notice.
    const everything = plan({ resolution: 32 });
    const usage = gridUsage(everything);
    expect(checkGridPlan(everything)).toEqual([]);
    expect(usage.byResolution).toEqual({ 32: 8 });
    expect(usage.thirtySecondBars).toBe(8);
    expect(usage.accentedShare).toBe(0);
    expect(usage.singleGrid).toBe(true);
  });

  it("never scores a finer grid as a better one", () => {
    // There is no field here that could be read as a mark, and the numbers a
    // reader gets are counts and shares.
    const usage = gridUsage(plan({ resolution: 32 }));
    expect(Object.keys(usage).sort()).toEqual([
      "accentedShare",
      "byIntent",
      "byResolution",
      "highResolutionBars",
      "singleGrid",
      "thirtySecondBars",
      "totalBars",
      "tripletBars",
    ]);
  });
});

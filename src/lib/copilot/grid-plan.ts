/**
 * The grid every bar of a planned piece runs on (spec 5.5, 11.8, K-34).
 *
 * A blueprint says three things about rhythm, in widening order of locality:
 * the piece has a default grid, a section may state its own, and a bar inside
 * a section may state a finer one still — but only with a named intent.
 *
 * The order matters more than it looks. "Everything on 1/32 because a solo
 * needs it somewhere" is the failure mode this shape is built to make
 * visible: it is not forbidden, because a musician might really want it, but
 * it cannot happen quietly. Every bar that runs finer than its section says
 * why, and `gridUsage` counts the ones that do.
 *
 * Nothing here decides whether a plan is *good*. A finer grid is not a better
 * one, and no score anywhere in this file or downstream of it may treat a
 * higher number as a higher mark.
 */
import {
  RHYTHM_GRID_INTENTS,
  type CompositionBlueprint,
  type BlueprintSection,
  type RhythmGridIntent,
} from "@/lib/copilot/blueprint";
import { isRepresentableGrid, isTripletGrid, type Resolution } from "@/lib/music/timing";

/** What one bar of the plan will be built as. */
export type PlannedBar = {
  sectionKey: string;
  /** Position inside that section's own bars. */
  barIndex: number;
  resolution: Resolution;
  /** Set only when this bar runs finer than its section's base grid. */
  intent: RhythmGridIntent | null;
  purpose: string | null;
};

/** The grid a section runs on when none of its bars asks for more. */
export function sectionResolution(
  blueprint: CompositionBlueprint,
  section: BlueprintSection,
): Resolution {
  return section.resolution ?? blueprint.resolution;
}

/**
 * The accent on one bar, if there is one.
 *
 * A later duplicate never wins silently: duplicates are refused by
 * `checkGridPlan`, and this reads the first so the two agree.
 */
function accentAt(section: BlueprintSection, barIndex: number) {
  return (section.gridAccents ?? []).find(
    (accent) => accent.barIndex === barIndex,
  );
}

/** The grid one bar runs on, base or accented. */
export function barResolution(
  blueprint: CompositionBlueprint,
  section: BlueprintSection,
  barIndex: number,
): Resolution {
  return accentAt(section, barIndex)?.resolution ?? sectionResolution(blueprint, section);
}

/** Every bar of the piece, in playing order, with the grid it will be built on. */
export function gridPlan(blueprint: CompositionBlueprint): PlannedBar[] {
  const plan: PlannedBar[] = [];
  for (const section of blueprint.sections) {
    const base = sectionResolution(blueprint, section);
    for (let barIndex = 0; barIndex < section.bars; barIndex += 1) {
      const accent = accentAt(section, barIndex);
      plan.push({
        sectionKey: section.key,
        barIndex,
        resolution: accent?.resolution ?? base,
        intent: accent && accent.resolution !== base ? accent.intent : null,
        purpose: accent && accent.resolution !== base ? accent.purpose : null,
      });
    }
  }
  return plan;
}

export type GridPlanProblem = { sectionKey: string; message: string };

/**
 * Everything about a grid plan that is not a plan at all.
 *
 * Kept separate from the schema because these are relationships between
 * fields — an accent that points past the end of its section, or one that is
 * not actually finer than what it is accenting — rather than shapes.
 */
export function checkGridPlan(
  blueprint: CompositionBlueprint,
): GridPlanProblem[] {
  const problems: GridPlanProblem[] = [];

  for (const section of blueprint.sections) {
    const base = sectionResolution(blueprint, section);
    const say = (message: string) =>
      problems.push({ sectionKey: section.key, message });

    if (!isRepresentableGrid(section.timeSignature, base)) {
      say(
        `${section.timeSignature[0]}/${section.timeSignature[1]} ölçüsü ` +
          `1/${base} gridinde yazılamaz.`,
      );
    }

    const seen = new Set<number>();
    for (const accent of section.gridAccents ?? []) {
      if (accent.barIndex >= section.bars) {
        say(
          `bar ${accent.barIndex + 1} için grid verilmiş ama bölüm ` +
            `${section.bars} bar uzunluğunda.`,
        );
        continue;
      }
      if (seen.has(accent.barIndex)) {
        say(`bar ${accent.barIndex + 1} için iki farklı grid verilmiş.`);
        continue;
      }
      seen.add(accent.barIndex);

      if (!isRepresentableGrid(section.timeSignature, accent.resolution)) {
        say(
          `bar ${accent.barIndex + 1}: ${section.timeSignature[0]}/` +
            `${section.timeSignature[1]} ölçüsü 1/${accent.resolution} ` +
            `gridinde yazılamaz.`,
        );
        continue;
      }

      /*
       * An accent that is not finer than the section's own grid is either a
       * mistake or a way to say "this bar is special" without changing
       * anything, and both read as a plan that was not thought through.
       */
      if (accent.resolution <= base) {
        say(
          `bar ${accent.barIndex + 1}: 1/${accent.resolution} bölümün ` +
            `1/${base} gridinden daha ince değil.`,
        );
      }
    }
  }

  return problems;
}

export type GridUsage = {
  totalBars: number;
  /** How many bars sit on each grid, keyed by resolution. */
  byResolution: Record<number, number>;
  tripletBars: number;
  /** Bars finer than 1/16 — the ones a reader should be able to justify. */
  highResolutionBars: number;
  /** Bars on the finest grid there is. */
  thirtySecondBars: number;
  /** Every stated reason, counted. */
  byIntent: Record<RhythmGridIntent, number>;
  /**
   * Share of bars running finer than their section's base grid.
   *
   * "Everything at 1/32" shows up here as 0 — because nothing is an accent
   * when everything is — which is why `byResolution` is reported next to it
   * and never on its own.
   */
  accentedShare: number;
  /** True when the whole piece is on one grid, whatever that grid is. */
  singleGrid: boolean;
};

export function gridUsage(blueprint: CompositionBlueprint): GridUsage {
  const plan = gridPlan(blueprint);
  const byResolution: Record<number, number> = {};
  const byIntent = Object.fromEntries(
    RHYTHM_GRID_INTENTS.map((intent) => [intent, 0]),
  ) as Record<RhythmGridIntent, number>;

  let tripletBars = 0;
  let highResolutionBars = 0;
  let thirtySecondBars = 0;
  let accented = 0;

  for (const bar of plan) {
    byResolution[bar.resolution] = (byResolution[bar.resolution] ?? 0) + 1;
    if (isTripletGrid(bar.resolution)) tripletBars += 1;
    if (bar.resolution > 16) highResolutionBars += 1;
    if (bar.resolution === 32) thirtySecondBars += 1;
    if (bar.intent) {
      accented += 1;
      byIntent[bar.intent] += 1;
    }
  }

  return {
    totalBars: plan.length,
    byResolution,
    tripletBars,
    highResolutionBars,
    thirtySecondBars,
    byIntent,
    accentedShare: plan.length === 0 ? 0 : accented / plan.length,
    singleGrid: Object.keys(byResolution).length <= 1,
  };
}

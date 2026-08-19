/**
 * Patch size (spec 10.1 `patchSize`, surface redefined by decision K-18).
 *
 * No single AI patch may create or change more than
 * `songLimits.barsPerPatch` bars. Since K-18 the change surface is the target
 * track inside one section, so what is measured is the number of bars the
 * patch actually writes into that track — not the size of a section it
 * replaces, because it no longer replaces one.
 *
 * A bar sent twice is one bar of surface and two attempts to write it. Both
 * are wrong: it cannot slip the limit by repetition, and it cannot silently
 * overwrite itself either. The duplicate is refused outright.
 *
 * This does not fit the `Validator` shape, and deliberately so. The others
 * judge a song; this judges a *proposal*, and it has to answer before the
 * proposal is applied to anything.
 */
import { songLimits } from "@/lib/limits";
import type { CopilotPatch } from "@/lib/copilot/contract";
import type { Song } from "@/lib/song/schema";
import type { ValidationIssue } from "@/lib/validators/types";

export const PATCH_SIZE_CODE = "patchSize";

/** Judges a proposal against the song it would be applied to. */
export type PatchValidator = (
  song: Song,
  patch: CopilotPatch,
) => ValidationIssue[];

export type TouchedBars = {
  /** Distinct bars of the target track the patch writes. */
  count: number;
  /** Bar indexes sent more than once, ascending. */
  duplicates: number[];
};

/** Bars this patch touches inside the target track (spec 10.1, K-18). */
export function touchedBars(patch: CopilotPatch): TouchedBars {
  const seen = new Set<number>();
  const duplicates = new Set<number>();
  for (const bar of patch.bars) {
    if (seen.has(bar.barIndex)) duplicates.add(bar.barIndex);
    seen.add(bar.barIndex);
  }
  return {
    count: seen.size,
    duplicates: [...duplicates].sort((a, b) => a - b),
  };
}

export const validatePatchSize: PatchValidator = (_song, patch) => {
  const issues: ValidationIssue[] = [];
  const touched = touchedBars(patch);
  const where = { sectionId: patch.sectionId, trackId: patch.targetTrackId };

  if (touched.duplicates.length > 0) {
    issues.push({
      code: PATCH_SIZE_CODE,
      severity: "error",
      message:
        `Öneri şu barları birden fazla kez gönderiyor: ` +
        `${touched.duplicates.map((index) => index + 1).join(", ")}. ` +
        `Her bar en fazla bir kez yazılabilir.`,
      ...where,
    });
  }

  if (touched.count > songLimits.barsPerPatch) {
    issues.push({
      code: PATCH_SIZE_CODE,
      severity: "error",
      message:
        `Öneri hedef track'te ${touched.count} bar değiştiriyor; tek bir AI ` +
        `patch'i en fazla ${songLimits.barsPerPatch} bar dokunabilir.`,
      ...where,
    });
  }

  return issues;
};

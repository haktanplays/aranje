/**
 * Validator chain (spec 10). Pure functions, independent of the UI, run both on
 * AI patches and on manual edits.
 *
 * Phase 0 implements the schema-level checks. `range`, `stringCollision`,
 * `tonalMajority` and `patchSize` are declared in spec 10.1 and arrive with the
 * phases that need them.
 */
import { validateDrumVocab } from "@/lib/validators/drumVocab";
import { validateFretboardIntegrity } from "@/lib/validators/fretboardIntegrity";
import { validateSlotCount } from "@/lib/validators/slotCount";
import { validateSongLimits } from "@/lib/validators/songLimits";
import { validateTrackReferences } from "@/lib/validators/trackReferences";
import type { Song } from "@/lib/song/schema";
import type { ValidationIssue, Validator } from "@/lib/validators/types";

export const PHASE_0_VALIDATORS: readonly Validator[] = [
  validateTrackReferences,
  validateSlotCount,
  validateDrumVocab,
  validateFretboardIntegrity,
  validateSongLimits,
];

export function runValidators(
  song: Song,
  validators: readonly Validator[] = PHASE_0_VALIDATORS,
): ValidationIssue[] {
  return validators.flatMap((validate) => validate(song));
}

export {
  validateDrumVocab,
  validateFretboardIntegrity,
  validateSlotCount,
  validateSongLimits,
  validateTrackReferences,
};
export { errorsOnly, hasErrors, warningsOnly } from "@/lib/validators/types";
export type { Severity, ValidationIssue, Validator } from "@/lib/validators/types";

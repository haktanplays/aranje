/**
 * Validator chain (spec 10). Pure functions, independent of the UI, run both on
 * AI patches and on manual edits.
 *
 * The order is fixed so the same song always yields the same issue list: the
 * schema-level checks of phase 0 first, then the playability checks added by
 * the phase 2 gate. `tonalMajority` and `patchSize` are declared in spec 10.1
 * and arrive with the copilot flow that needs them.
 */
import { validateDrumVocab } from "@/lib/validators/drumVocab";
import { validateFretboardIntegrity } from "@/lib/validators/fretboardIntegrity";
import { validateRange } from "@/lib/validators/range";
import { validateSlotCount } from "@/lib/validators/slotCount";
import { validateSongLimits } from "@/lib/validators/songLimits";
import { validateStringCollision } from "@/lib/validators/stringCollision";
import { validateTrackReferences } from "@/lib/validators/trackReferences";
import type { Song } from "@/lib/song/schema";
import type { ValidationIssue, Validator } from "@/lib/validators/types";

/** Shape of the song itself: references, slot counts, vocabulary, limits. */
export const PHASE_0_VALIDATORS: readonly Validator[] = [
  validateTrackReferences,
  validateSlotCount,
  validateDrumVocab,
  validateFretboardIntegrity,
  validateSongLimits,
];

/** Can a human actually play what is written (spec 10.1). */
export const PLAYABILITY_VALIDATORS: readonly Validator[] = [
  validateRange,
  validateStringCollision,
];

/** The central chain. Everything that validates a whole song runs this. */
export const SONG_VALIDATORS: readonly Validator[] = [
  ...PHASE_0_VALIDATORS,
  ...PLAYABILITY_VALIDATORS,
];

export function runValidators(
  song: Song,
  validators: readonly Validator[] = SONG_VALIDATORS,
): ValidationIssue[] {
  return validators.flatMap((validate) => validate(song));
}

export {
  validateDrumVocab,
  validateFretboardIntegrity,
  validateRange,
  validateSlotCount,
  validateSongLimits,
  validateStringCollision,
  validateTrackReferences,
};
export { rangeSupportFor } from "@/lib/validators/range";
export type { RangeSupport } from "@/lib/validators/range";
export { errorsOnly, hasErrors, warningsOnly } from "@/lib/validators/types";
export type { Severity, ValidationIssue, Validator } from "@/lib/validators/types";

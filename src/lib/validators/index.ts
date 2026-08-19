/**
 * Validator chain (spec 10). Pure functions, independent of the UI, run both on
 * AI patches and on manual edits.
 *
 * The order is fixed so the same song always yields the same issue list:
 * schema-level checks first (spec 10.1), then playability, then tonality, then
 * the warnings of spec 10.3. `patchSize` is not in this chain: it judges a
 * proposal rather than a song, and it has to answer before the proposal is
 * applied (see `@/lib/validators/patchSize`).
 */
import { validateDrumVocab } from "@/lib/validators/drumVocab";
import { validateFretJump } from "@/lib/validators/fretJump";
import { validateFretboardIntegrity } from "@/lib/validators/fretboardIntegrity";
import { validateRange } from "@/lib/validators/range";
import { validateSlotCount } from "@/lib/validators/slotCount";
import { validateSongLimits } from "@/lib/validators/songLimits";
import { validateStringCollision } from "@/lib/validators/stringCollision";
import { validateTonalMajority } from "@/lib/validators/tonalMajority";
import { validateTrackReferences } from "@/lib/validators/trackReferences";
import { validateUnplaceable } from "@/lib/validators/unplaceable";
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

/** Is it in the key the song says it is in (spec 10.1, set in 10.4). */
export const TONAL_VALIDATORS: readonly Validator[] = [validateTonalMajority];

/** Informative, never blocking (spec 10.3). */
export const WARNING_VALIDATORS: readonly Validator[] = [
  validateUnplaceable,
  validateFretJump,
];

/** The central chain. Everything that validates a whole song runs this. */
export const SONG_VALIDATORS: readonly Validator[] = [
  ...PHASE_0_VALIDATORS,
  ...PLAYABILITY_VALIDATORS,
  ...TONAL_VALIDATORS,
  ...WARNING_VALIDATORS,
];

export function runValidators(
  song: Song,
  validators: readonly Validator[] = SONG_VALIDATORS,
): ValidationIssue[] {
  return validators.flatMap((validate) => validate(song));
}

export {
  validateDrumVocab,
  validateFretJump,
  validateFretboardIntegrity,
  validateRange,
  validateSlotCount,
  validateSongLimits,
  validateStringCollision,
  validateTonalMajority,
  validateTrackReferences,
  validateUnplaceable,
};
export { validatePatchSize, touchedBars } from "@/lib/validators/patchSize";
export type { PatchValidator } from "@/lib/validators/patchSize";
export { rangeSupportFor } from "@/lib/validators/range";
export type { RangeSupport } from "@/lib/validators/range";
export { errorsOnly, hasErrors, warningsOnly } from "@/lib/validators/types";
export type { Severity, ValidationIssue, Validator } from "@/lib/validators/types";

/**
 * Patch size (spec 10.1 `patchSize`): no single AI patch may create or change
 * more than `songLimits.barsPerPatch` bars.
 *
 * This one does not fit the `Validator` shape, and deliberately so. The others
 * judge a song; this one judges a *proposal*, and it has to answer before the
 * proposal is applied to anything. It is the guard that keeps a runaway model
 * answer from ever reaching the song, so running it after `applyPatch` would
 * defeat its purpose.
 *
 * What counts as a changed bar
 * ----------------------------
 * - `insert_section`: every bar of the new section is new.
 * - `replace_section`: every bar of the new section is written, and every bar
 *   of the section it displaces is gone. The larger of the two is what the
 *   patch actually changes, so that shrinking an eight-bar section to one bar
 *   still counts as eight bars of change rather than one.
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

/** Bars this patch creates or changes. */
export function changedBarCount(song: Song, patch: CopilotPatch): number {
  const written = patch.section.bars.length;
  if (patch.action === "insert_section") return written;

  const displaced = song.sections.find(
    (section) => section.id === patch.targetSectionId,
  );
  return Math.max(written, displaced?.bars.length ?? 0);
}

export const validatePatchSize: PatchValidator = (song, patch) => {
  const changed = changedBarCount(song, patch);
  if (changed <= songLimits.barsPerPatch) return [];

  return [
    {
      code: PATCH_SIZE_CODE,
      severity: "error",
      message:
        `Öneri ${changed} bar oluşturuyor veya değiştiriyor; tek bir AI ` +
        `patch'i en fazla ${songLimits.barsPerPatch} bar dokunabilir.`,
      sectionId: patch.section.id,
    },
  ];
};

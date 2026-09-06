/**
 * Which cards this round is actually asking about (2V-C.2 §2, §4; 2V-D.2 §1).
 *
 * A listening round is a question with a scope, and the scope is not "every
 * card that has ever existed". Everything with a recorded answer is history.
 *
 * **The completion round asks one question (2V-D.2 completion §15).** L30 and
 * L32 came back `pass` and L31 came back `fail` — "İkisi arasında belirgin
 * bir fark yok" — and none of the three is asked again. L33 is a new card
 * built for the same musical question with the fixture defect L31 exposed
 * taken out of it; whatever L33 scores, it cannot move L31's row.
 *
 * A card in this list is one the founder is being asked *now*. A card with an
 * answer is history, and the paste block keeps the two apart: "Bu tur"
 * counts only this one.
 *
 * Keeping this as a list rather than as a flag on the clip is deliberate. A
 * clip does not know which round it is in; a round knows which clips it is
 * about, and next round the list changes without touching a single card.
 */
import { isArchived } from "@/lib/listening/founder-authority";
import type { ListeningClip } from "@/lib/listening/clip-plan";

/** The cards the founder is being asked to judge now. */
export const ACTIVE_CLIP_IDS = ["L33", "L34", "L35"] as const;

export type ActiveClipId = (typeof ACTIVE_CLIP_IDS)[number];


export function isActive(id: string): boolean {
  return (ACTIVE_CLIP_IDS as readonly string[]).includes(id);
}

/**
 * The clips to put in front of the reader.
 *
 * A clip that is neither active nor archived would be a card nobody has
 * decided and nobody is being asked about — it is offered, so that a new card
 * added without touching this list is visible rather than silently lost.
 */
export function activeClips(
  clips: readonly ListeningClip[],
): readonly ListeningClip[] {
  return clips.filter((clip) => !isArchived(clip.id));
}

/** The clips whose answers are already recorded elsewhere. */
export function archivedClips(
  clips: readonly ListeningClip[],
): readonly ListeningClip[] {
  return clips.filter((clip) => isArchived(clip.id));
}

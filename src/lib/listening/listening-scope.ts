/**
 * Which cards this round is actually asking about (2V-C.2 §2, §4; 2V-E.1 §1).
 *
 * A listening round is a question with a scope, and the scope is not "every
 * card that has ever existed". Everything with a recorded answer is history.
 *
 * **This round asks nothing.** L33, L34 and L35 came back `pass` and D.2 is
 * closed; 2V-E.1 turns the engine work into a product loop and adds no new
 * audible behaviour, so there is no card to ask and the pack is empty. An
 * empty round is a statement, not an oversight: a round that invented a card
 * to have something to show would be asking the founder to listen again to
 * audio they have already judged.
 *
 * A card in this list is one the founder is being asked *now*. A card with an
 * answer is history, and the paste block keeps the two apart.
 *
 * Keeping this as a list rather than as a flag on the clip is deliberate. A
 * clip does not know which round it is in; a round knows which clips it is
 * about, and next round the list changes without touching a single card.
 */
import { isArchived } from "@/lib/listening/founder-authority";
import type { ListeningClip } from "@/lib/listening/clip-plan";

/** The cards the founder is being asked to judge now. */
export const ACTIVE_CLIP_IDS: readonly string[] = [];

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

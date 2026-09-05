/**
 * Which cards this round is actually asking about (2V-C.2 §2, §4; 2V-D.1 §19).
 *
 * A listening round is a question with a scope, and the scope is not "every
 * card that has ever existed". Everything with a recorded answer is history.
 *
 * **Empty, at the moment, and that is a state rather than an oversight.**
 * L25 and L26 closed the slide phase, and 2V-D.1 built the multi-axis model
 * underneath the cards that come next without building the cards. An empty
 * round says exactly that: every card has an answer and the founder is not
 * being asked anything. It is not the same as a round with cards nobody
 * answered, and the paste block distinguishes the two.
 *
 * Keeping this as a list rather than as a flag on the clip is deliberate. A
 * clip does not know which round it is in; a round knows which clips it is
 * about, and next round the list changes without touching a single card.
 */
import { isArchived } from "@/lib/listening/founder-authority";
import type { ListeningClip } from "@/lib/listening/clip-plan";

/** The cards the founder is being asked to judge now. */
export const ACTIVE_CLIP_IDS = [] as const;

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

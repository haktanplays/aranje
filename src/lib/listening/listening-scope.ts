/**
 * Which cards this round is actually asking about (2V-C.2 §2, §4; 2V-D.1-C §18).
 *
 * A listening round is a question with a scope, and the scope is not "every
 * card that has ever existed". Everything with a recorded answer is history.
 *
 * **Three cards, and one of them is a parity question.** L27 asks whether a
 * palm mute written as a region sounds like the same mute written on the
 * note; the numbers already say the plan, the length, the envelope and the
 * rendered audio are identical, so what is left is the only thing a number
 * cannot settle. L28 asks whether a harmonic survives a bend, and L29 asks
 * for the sound the region model exists for: one hand, two strings, one of
 * them muted.
 *
 * There is no picking card. The sample bank holds one recording per pitch,
 * so the two strokes are identical in the speakers; asking the founder to
 * hear a difference that is not there would be the pack lying to them.
 *
 * Keeping this as a list rather than as a flag on the clip is deliberate. A
 * clip does not know which round it is in; a round knows which clips it is
 * about, and next round the list changes without touching a single card.
 */
import { isArchived } from "@/lib/listening/founder-authority";
import type { ListeningClip } from "@/lib/listening/clip-plan";

/** The cards the founder is being asked to judge now. */
export const ACTIVE_CLIP_IDS = ["L27", "L28", "L29"] as const;

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

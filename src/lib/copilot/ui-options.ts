/**
 * What the arrange sheet is allowed to offer (spec 11.1, K-18).
 *
 * Pure, so the rules can be tested without a screen. Two of them matter:
 *
 * - **The target list is derived, not typed.** A skill can only be pointed at
 *   an instrument it suits, so an incompatible track is never offered rather
 *   than offered and then refused.
 * - **The locked list is derived too.** Every track that is not the target is
 *   locked, whatever the caller thinks. The screen has no control for it, and
 *   this function is the only thing that builds it, so a shorter list cannot
 *   be sent by mistake.
 */
import { skillAccepts } from "@/lib/copilot/arrange";
import { ARRANGE_SKILLS, type ArrangeSkill } from "@/lib/copilot/contract";
import type { Song, Track } from "@/lib/song/schema";

export type TargetOption = { id: string; name: string };

/** Tracks this skill can be pointed at, in the song's own order. */
export function targetsFor(song: Song, skill: ArrangeSkill): TargetOption[] {
  return song.tracks
    .filter((track: Track) => skillAccepts(skill, track))
    .map((track) => ({ id: track.id, name: track.name }));
}

/** Skills that have somewhere to go in this song. */
export function availableSkills(song: Song): ArrangeSkill[] {
  return ARRANGE_SKILLS.filter((skill) => targetsFor(song, skill).length > 0);
}

/**
 * Everything except the target. The screen never asks the reader about this
 * and never sends anything else (spec 11.1: the server locks it regardless,
 * and this list only makes the intent visible).
 */
export function lockedFor(song: Song, targetTrackId: string): string[] {
  return song.tracks
    .map((track) => track.id)
    .filter((id) => id !== targetTrackId)
    .sort();
}

/**
 * Applying a patch to a song, in memory (spec 11.4/7).
 *
 * Pure: it returns a new candidate song and never touches the canonical one.
 * The canonical song changes only when the user accepts, in the client.
 *
 * The candidate exists so the §10 chain can be run against a whole song
 * rather than against a section in isolation. `tonalMajority` needs the key
 * and the notes either side of a bar; `songLimits` needs the total bar count.
 * Neither question can be answered from the patch alone.
 */
import type { CopilotPatch } from "@/lib/copilot/contract";
import type { Song } from "@/lib/song/schema";

export type ApplyResult =
  | { ok: true; song: Song }
  | { ok: false; reason: "anchor_not_found" };

export function applyPatch(song: Song, patch: CopilotPatch): ApplyResult {
  if (patch.action === "replace_section") {
    const index = song.sections.findIndex(
      (section) => section.id === patch.targetSectionId,
    );
    if (index < 0) return { ok: false, reason: "anchor_not_found" };

    const sections = [...song.sections];
    sections[index] = patch.section;
    return { ok: true, song: { ...song, sections } };
  }

  const index = song.sections.findIndex(
    (section) => section.id === patch.afterSectionId,
  );
  if (index < 0) return { ok: false, reason: "anchor_not_found" };

  const sections = [...song.sections];
  sections.splice(index + 1, 0, patch.section);
  return { ok: true, song: { ...song, sections } };
}

/** The section a patch replaces, when it replaces one. */
export function replacedSection(song: Song, patch: CopilotPatch) {
  if (patch.action !== "replace_section") return undefined;
  return song.sections.find((section) => section.id === patch.targetSectionId);
}

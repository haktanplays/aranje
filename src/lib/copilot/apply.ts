/**
 * Applying a patch to a song, in memory (spec 11.4/7, decision K-18).
 *
 * Pure, and deliberately narrow: it clones the song and writes into exactly
 * one place —
 *
 *     sections[sectionId] -> bars[barIndex] -> slots[targetTrackId]
 *
 * It never builds a section from the model's answer, because a section built
 * from an answer carries whatever the answer said about names, statuses and
 * bar shapes. Cloning and touching one surface means those questions are never
 * asked.
 *
 * The candidate exists so the §10 chain can be run against a whole song rather
 * than a fragment. `tonalMajority` needs the key and the whole bar;
 * `songLimits` needs the total bar count. Neither can be answered from a patch.
 */
import type { CopilotPatch } from "@/lib/copilot/contract";
import type { Bar, DrumSlot, MelodicSlot, Song } from "@/lib/song/schema";

export type ApplyFailure =
  | "section_not_found"
  | "track_not_in_song"
  | "bar_out_of_range";

export type ApplyResult =
  | { ok: true; song: Song }
  | { ok: false; reason: ApplyFailure };

export function applyPatch(song: Song, patch: CopilotPatch): ApplyResult {
  const sectionIndex = song.sections.findIndex(
    (section) => section.id === patch.sectionId,
  );
  const section = song.sections[sectionIndex];
  if (!section) return { ok: false, reason: "section_not_found" };

  if (!song.tracks.some((track) => track.id === patch.targetTrackId)) {
    return { ok: false, reason: "track_not_in_song" };
  }

  const written = new Map<number, MelodicSlot[] | DrumSlot[]>();
  for (const bar of patch.bars) {
    if (bar.barIndex < 0 || bar.barIndex >= section.bars.length) {
      return { ok: false, reason: "bar_out_of_range" };
    }
    written.set(bar.barIndex, bar.slots as MelodicSlot[] | DrumSlot[]);
  }

  const bars: Bar[] = section.bars.map((bar, barIndex) => {
    const slots = written.get(barIndex);
    if (slots === undefined) return bar;
    // Every other key in this bar is carried over untouched.
    return { ...bar, slots: { ...bar.slots, [patch.targetTrackId]: slots } };
  });

  const sections = [...song.sections];
  sections[sectionIndex] = { ...section, bars };

  return { ok: true, song: { ...song, sections } };
}

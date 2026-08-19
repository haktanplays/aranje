/**
 * Tonal majority (spec 10.1 `tonalMajority`, set defined in spec 10.4).
 *
 * A bar fails when **more than half** of the melodic notes struck in it fall
 * outside the allowed tonal set. Spec 10.4 is explicit that a single colour
 * note must never block a patch; the threshold, not the presence of an
 * outside note, is what blocks.
 *
 * Counting
 * --------
 * - The unit is one struck note. A tie or a sustain repeats no decision and is
 *   not counted again, the same reading of "note" the voice counter and the
 *   tab timeline use.
 * - The bar is counted across every melodic track in it, because spec 10.1
 *   says "the melodic notes in a bar", not "in a track".
 * - Drum hits have no pitch and are not counted.
 *
 * Context
 * -------
 * The key lives on the Song (spec 5.1) and the passing-tone rule of spec 10.4
 * looks at the note struck before and after, which may sit in a neighbouring
 * bar or section. Both mean this validator can only be run against a whole
 * song. When it judges an AI patch, it must therefore be run on the candidate
 * song with the patch already applied, never on the patch alone.
 */
import { isDrumInstrument } from "@/lib/instruments/registry";
import { isInTonalSet, parseKey, type ParsedKey } from "@/lib/music/tonality";
import type { NoteEvent, Song } from "@/lib/song/schema";
import type { Validator, ValidationIssue } from "@/lib/validators/types";

export const TONAL_MAJORITY_CODE = "tonalMajority";

/** Strictly more than half; an even split is not a majority. */
const MAJORITY = 0.5;

type Onset = {
  sectionId: string;
  barIndex: number;
  slotIndex: number;
  pitches: string[];
};

/** Every struck melodic note of one track, in playing order. */
function onsetsOf(song: Song, trackId: string): Onset[] {
  const onsets: Onset[] = [];

  for (const section of song.sections) {
    section.bars.forEach((bar, barIndex) => {
      const slots = bar.slots[trackId];
      if (slots === undefined) return;

      slots.forEach((slot, slotIndex) => {
        if (slot === null || slot === "-" || Array.isArray(slot)) return;
        const pitches = (slot.notes as NoteEvent[]).map((note) => note.pitch);
        if (pitches.length === 0) return;
        onsets.push({
          sectionId: section.id,
          barIndex,
          slotIndex,
          pitches,
        });
      });
    });
  }

  return onsets;
}

type Judged = Onset & { outside: string[]; total: number };

function judge(onsets: readonly Onset[], key: ParsedKey): Judged[] {
  return onsets.map((onset, index) => {
    // Spec 10.4's passing tone looks one struck note back and one forward.
    const neighbours = [
      ...(onsets[index - 1]?.pitches ?? []),
      ...(onsets[index + 1]?.pitches ?? []),
    ];
    return {
      ...onset,
      total: onset.pitches.length,
      outside: onset.pitches.filter(
        (pitch) => !isInTonalSet(pitch, neighbours, key),
      ),
    };
  });
}

export const validateTonalMajority: Validator = (song: Song) => {
  const key = parseKey(song.key);
  // An unreadable key is a schema fault; schemaShape owns it.
  if (!key) return [];

  const melodicTracks = song.tracks.filter(
    (track) => !isDrumInstrument(track.instrumentId),
  );

  // Bar key -> running tally, filled per track and read back per bar so the
  // count covers the whole bar rather than one track of it.
  const tally = new Map<string, { total: number; outside: Judged[] }>();
  for (const track of melodicTracks) {
    for (const judged of judge(onsetsOf(song, track.id), key)) {
      const barKey = `${judged.sectionId}:${judged.barIndex}`;
      const entry = tally.get(barKey) ?? { total: 0, outside: [] };
      entry.total += judged.total;
      if (judged.outside.length > 0) entry.outside.push(judged);
      tally.set(barKey, entry);
    }
  }

  const issues: ValidationIssue[] = [];

  for (const section of song.sections) {
    section.bars.forEach((_, barIndex) => {
      const entry = tally.get(`${section.id}:${barIndex}`);
      if (!entry || entry.total === 0) return;

      const outsideCount = entry.outside.reduce(
        (sum, judged) => sum + judged.outside.length,
        0,
      );
      if (outsideCount <= entry.total * MAJORITY) return;

      // Named in slot order so the reader can find them (spec 11.4).
      const named = [...entry.outside]
        .sort((a, b) => a.slotIndex - b.slotIndex)
        .map((judged) => `slot ${judged.slotIndex + 1}: ${judged.outside.join(", ")}`)
        .join("; ");

      issues.push({
        code: TONAL_MAJORITY_CODE,
        severity: "error",
        message:
          `"${section.name}" bölümü, bar ${barIndex + 1}: melodik ` +
          `${entry.total} notanın ${outsideCount} tanesi "${song.key}" ` +
          `tonalitesinin izinli kümesi dışında (yarıdan fazlası). ${named}.`,
        sectionId: section.id,
        barIndex,
      });
    });
  }

  return issues;
};

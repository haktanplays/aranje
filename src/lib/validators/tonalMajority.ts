/**
 * Tonal majority (spec 10.1 `tonalMajority`, core defined in spec 10.4,
 * decision K-17).
 *
 * A bar passes when **more than half** of the pitched onsets struck in it are
 * core tones of the declared key. Exactly half fails: a majority is a
 * majority.
 *
 * Counting, and why each rule is there
 * ------------------------------------
 * - **Numerator: core tones only.** A raised seventh, a flat fifth, a
 *   borrowing or a chromatic step is colour. It is not an error by itself and
 *   it is not evidence of the key either, so it counts in the denominator and
 *   not in the numerator. Colour a style card happens to suggest is still
 *   colour; nothing about where a note came from makes it core.
 * - **Denominator: every pitched onset in the bar,** across every melodic
 *   track, because spec 10.1 says "the melodic notes in a bar" and a bar is
 *   not one track's business. Drum hits carry no pitch and are not counted.
 * - **A tie is not a second onset.** It repeats no decision, the same reading
 *   the voice counter and the tab timeline use.
 * - **Fewer than three onsets and the bar is skipped.** One or two notes are
 *   not evidence of a tonality; a two-note bar with one colour tone would fail
 *   a 50% rule while saying nothing at all about the key.
 *
 * Context
 * -------
 * The key lives on the Song (spec 5.1), so this can only run against a whole
 * song. When it judges an AI patch it runs on the candidate song with the
 * patch already applied, never on the patch alone.
 */
import { isDrumInstrument } from "@/lib/instruments/registry";
import { classifyTone, parseKey, type ParsedKey } from "@/lib/music/tonality";
import type { NoteEvent, Song } from "@/lib/song/schema";
import type { Validator, ValidationIssue } from "@/lib/validators/types";

export const TONAL_MAJORITY_CODE = "tonalMajority";

/** Strictly more than half; an even split is not a majority (spec 10.4). */
const MAJORITY = 0.5;

/**
 * Below this many pitched onsets a bar says nothing about its tonality, so no
 * verdict is given either way (spec 10.4, K-17).
 */
export const MIN_ONSETS_FOR_VERDICT = 3;

type Onset = { slotIndex: number; pitch: string };

type BarTally = { total: number; core: number; colour: Onset[] };

function tallyBar(
  slots: readonly unknown[],
  key: ParsedKey,
  tally: BarTally,
): void {
  slots.forEach((slot, slotIndex) => {
    if (slot === null || slot === "-" || Array.isArray(slot)) return;
    const notes = (slot as { notes: NoteEvent[] }).notes;
    for (const note of notes) {
      const classified = classifyTone(note.pitch, key);
      if (classified.kind === "unreadable") continue; // schemaShape owns it
      tally.total += 1;
      if (classified.kind === "core") {
        tally.core += 1;
      } else {
        tally.colour.push({ slotIndex, pitch: note.pitch });
      }
    }
  });
}

export const validateTonalMajority: Validator = (song: Song) => {
  const key = parseKey(song.key);
  // An unreadable key is a schema fault; schemaShape owns it.
  if (!key) return [];

  const melodic = new Set(
    song.tracks
      .filter((track) => !isDrumInstrument(track.instrumentId))
      .map((track) => track.id),
  );

  const issues: ValidationIssue[] = [];

  for (const section of song.sections) {
    section.bars.forEach((bar, barIndex) => {
      const tally: BarTally = { total: 0, core: 0, colour: [] };

      for (const [trackId, slots] of Object.entries(bar.slots)) {
        if (!melodic.has(trackId)) continue;
        tallyBar(slots, key, tally);
      }

      if (tally.total < MIN_ONSETS_FOR_VERDICT) return;
      if (tally.core > tally.total * MAJORITY) return;

      const named = [...tally.colour]
        .sort((a, b) => a.slotIndex - b.slotIndex || (a.pitch < b.pitch ? -1 : 1))
        .map((onset) => `slot ${onset.slotIndex + 1}: ${onset.pitch}`)
        .join("; ");

      issues.push({
        code: TONAL_MAJORITY_CODE,
        severity: "error",
        message:
          `"${section.name}" bölümü, bar ${barIndex + 1}: ${tally.total} ` +
          `melodik notanın yalnız ${tally.core} tanesi "${song.key}" ` +
          `çekirdek dizisinde. Çoğunluk için yarıdan fazlası gerekiyor. ` +
          `Renk notaları — ${named}.`,
        sectionId: section.id,
        barIndex,
      });
    });
  }

  return issues;
};

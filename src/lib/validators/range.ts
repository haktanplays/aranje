/**
 * Playable range (spec 10.1 `range`).
 *
 * Asks one question: can this instrument reach the written pitch at all?
 *
 * Where the boundary with `fretboardIntegrity` sits
 * ------------------------------------------------
 * A note that carries an explicit position is left to `fretboardIntegrity`.
 * If that position exists on the fretboard then the pitch it sounds is inside
 * the range by construction, and if it does not, `fretboardIntegrity` already
 * says so. Checking such a note here would only repeat the same fault in
 * different words. What this validator adds is the case the other one cannot
 * see: an event with no position written on it (spec 10.1, 10.3).
 *
 * Bounds are derived from the track's own tuning, capo and fret count. No
 * numeric range is written down here or anywhere in the interface.
 */
import { isDrumInstrument } from "@/lib/instruments/registry";
import { fretboardRange } from "@/lib/music/fretboard";
import { midiToPitch, pitchToMidi } from "@/lib/music/pitch";
import type { NoteEvent, Track } from "@/lib/song/schema";
import type { Validator, ValidationIssue } from "@/lib/validators/types";

export type RangeSupport =
  /** Derived from tuning, capo and fret count. */
  | { kind: "fretboard"; lowMidi: number; highMidi: number }
  /** Drums have no melodic range; `drumVocab` owns that track. */
  | { kind: "drums" }
  /**
   * A melodic instrument with no fretboard. The spec defines no numeric range
   * for the phase 2.5 catalogue, and a range is not something to invent, so
   * these are reported as unsupported instead of guessed at.
   */
  | { kind: "deferred"; reason: string };

/** How, or whether, a range can be established for this track. */
export function rangeSupportFor(track: Track): RangeSupport {
  if (isDrumInstrument(track.instrumentId)) return { kind: "drums" };

  if (!track.fretboard) {
    return {
      kind: "deferred",
      reason:
        `"${track.instrumentId}" için sayısal ses aralığı spec'te tanımlı ` +
        `değil; aralık kontrolü bu enstrüman açıldığında eklenecek.`,
    };
  }

  const range = fretboardRange(track.fretboard);
  if (!range) {
    return {
      kind: "deferred",
      reason: `"${track.name}" track'inin akordu okunamadı.`,
    };
  }

  return { kind: "fretboard", ...range };
}

export const validateRange: Validator = (song) => {
  const issues: ValidationIssue[] = [];
  const tracksById = new Map(song.tracks.map((track) => [track.id, track]));

  for (const section of song.sections) {
    section.bars.forEach((bar, barIndex) => {
      for (const [trackId, slots] of Object.entries(bar.slots)) {
        const track = tracksById.get(trackId);
        if (!track) continue; // trackReferences owns this

        const support = rangeSupportFor(track);
        if (support.kind !== "fretboard") continue;

        slots.forEach((slot, slotIndex) => {
          if (slot === null || slot === "-" || Array.isArray(slot)) return;

          for (const note of slot.notes as NoteEvent[]) {
            // Positioned notes belong to fretboardIntegrity; see the note at
            // the top of this file.
            if (note.position) continue;

            const midi = pitchToMidi(note.pitch);
            if (midi === null) continue; // schemaShape owns the written form

            if (midi >= support.lowMidi && midi <= support.highMidi) continue;

            const direction = midi < support.lowMidi ? "altında" : "üstünde";
            issues.push({
              code: "range",
              severity: "error",
              message:
                `"${section.name}" bölümü, bar ${barIndex + 1}, slot ` +
                `${slotIndex + 1}: ${note.pitch} notası "${track.name}" ` +
                `track'inin aralığının ${direction}. Bu akort ve capo ` +
                `${track.fretboard?.capo ?? 0} ile çalınabilir aralık ` +
                `${midiToPitch(support.lowMidi)} - ` +
                `${midiToPitch(support.highMidi)}.`,
              sectionId: section.id,
              barIndex,
              trackId,
              slotIndex,
            });
          }
        });
      }
    });
  }

  return issues;
};

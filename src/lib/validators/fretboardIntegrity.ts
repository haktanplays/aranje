/**
 * Capo-relative fret semantics for explicitly written positions
 * (spec 10.1 `fretboardIntegrity`, semantics in spec 9.1).
 *
 * Only positions the user or the model wrote out are checked. A missing
 * position is not an error here; the position engine fills it in later.
 */
import { isDrumInstrument } from "@/lib/instruments/registry";
import {
  maxCapoRelativeFret,
  soundingMidi,
  type Fretboard,
} from "@/lib/music/fretboard";
import { midiToPitch, pitchToMidi } from "@/lib/music/pitch";
import type { NoteEvent } from "@/lib/song/schema";
import type { Validator, ValidationIssue } from "@/lib/validators/types";

export const validateFretboardIntegrity: Validator = (song) => {
  const issues: ValidationIssue[] = [];
  const tracksById = new Map(song.tracks.map((track) => [track.id, track]));

  for (const section of song.sections) {
    section.bars.forEach((bar, barIndex) => {
      for (const [trackId, slots] of Object.entries(bar.slots)) {
        const track = tracksById.get(trackId);
        if (!track || isDrumInstrument(track.instrumentId)) continue;

        slots.forEach((slot, slotIndex) => {
          if (slot === null || slot === "-" || Array.isArray(slot)) return;

          for (const note of slot.notes as NoteEvent[]) {
            if (!note.position) continue;

            const where = {
              sectionId: section.id,
              barIndex,
              trackId,
              slotIndex,
            };

            if (!track.fretboard) {
              issues.push({
                code: "fretboardIntegrity",
                severity: "error",
                message:
                  `"${section.name}" bölümü, bar ${barIndex + 1}, slot ` +
                  `${slotIndex + 1}: "${track.name}" track'indeki ` +
                  `${note.pitch} notasında tel/perde verilmiş, ama track'in ` +
                  `klavye (akort) tanımı yok.`,
                ...where,
              });
              continue;
            }

            const fretboard: Fretboard = track.fretboard;
            const sounding = soundingMidi(fretboard, note.position);

            if (sounding === null) {
              issues.push({
                code: "fretboardIntegrity",
                severity: "error",
                message:
                  `"${section.name}" bölümü, bar ${barIndex + 1}, slot ` +
                  `${slotIndex + 1}: ${note.pitch} notası tel ` +
                  `${note.position.string}, perde ${note.position.fret} ` +
                  `kullanıyor; ${fretboard.tuning.length} telli ve capo ` +
                  `${fretboard.capo} olan bu klavyede böyle bir pozisyon yok ` +
                  `(geçerli perde 0..${maxCapoRelativeFret(fretboard.capo)}).`,
                ...where,
              });
              continue;
            }

            const written = pitchToMidi(note.pitch);
            if (written !== null && written !== sounding) {
              issues.push({
                code: "fretboardIntegrity",
                severity: "error",
                message:
                  `"${section.name}" bölümü, bar ${barIndex + 1}, slot ` +
                  `${slotIndex + 1}: nota ${note.pitch} yazılmış, ama tel ` +
                  `${note.position.string} perde ${note.position.fret} ` +
                  `capo ${fretboard.capo} ile ${midiToPitch(sounding)} sesini ` +
                  `veriyor.`,
                ...where,
              });
            }
          }
        });
      }
    });
  }

  return issues;
};

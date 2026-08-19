/**
 * Drum vocabulary and slot shape (spec 10.1 `drumVocab`, model in spec 5.4).
 *
 * A drum track carries DrumSlot arrays, where one slot may hold several hits at
 * once (kick + hat + crash). A melodic track carries MelodicSlot values. Mixing
 * the two shapes is a hard error, which is the check zod alone cannot make
 * because it does not know which track is a drum track.
 */
import { DRUM_PIECES, isDrumInstrument } from "@/lib/instruments/registry";
import type { DrumSlot } from "@/lib/song/schema";
import type { Validator, ValidationIssue } from "@/lib/validators/types";

const VALID_PIECES = new Set<string>(DRUM_PIECES);

export const validateDrumVocab: Validator = (song) => {
  const issues: ValidationIssue[] = [];
  const drumTrackIds = new Set(
    song.tracks
      .filter((track) => isDrumInstrument(track.instrumentId))
      .map((track) => track.id),
  );
  const knownTrackIds = new Set(song.tracks.map((track) => track.id));

  for (const section of song.sections) {
    section.bars.forEach((bar, barIndex) => {
      for (const [trackId, slots] of Object.entries(bar.slots)) {
        if (!knownTrackIds.has(trackId)) continue; // reported by trackReferences
        const isDrumTrack = drumTrackIds.has(trackId);

        slots.forEach((slot, slotIndex) => {
          const slotIsArray = Array.isArray(slot);

          if (isDrumTrack && !slotIsArray) {
            issues.push({
              code: "drumVocab",
              severity: "error",
              message:
                `"${section.name}" bölümü, bar ${barIndex + 1}, slot ` +
                `${slotIndex + 1}: "${trackId}" davul track'i melodik slot ` +
                `değil, davul vuruş listesi kullanmalı.`,
              sectionId: section.id,
              barIndex,
              trackId,
              slotIndex,
            });
            return;
          }

          if (!isDrumTrack && slotIsArray) {
            issues.push({
              code: "drumVocab",
              severity: "error",
              message:
                `"${section.name}" bölümü, bar ${barIndex + 1}, slot ` +
                `${slotIndex + 1}: "${trackId}" melodik track'i davul vuruş ` +
                `listesi kullanamaz.`,
              sectionId: section.id,
              barIndex,
              trackId,
              slotIndex,
            });
            return;
          }

          if (!isDrumTrack || !slotIsArray) return;

          for (const hit of slot as DrumSlot) {
            if (VALID_PIECES.has(hit.piece)) continue;
            issues.push({
              code: "drumVocab",
              severity: "error",
              message:
                `"${section.name}" bölümü, bar ${barIndex + 1}, slot ` +
                `${slotIndex + 1}: "${hit.piece}" tanımlı bir davul parçası ` +
                `değil.`,
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

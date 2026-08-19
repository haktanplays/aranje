/**
 * Referential integrity of track ids (spec 10.1 `trackReferences`).
 *
 * Track.id is unique; Track.instrumentId deliberately is not (spec 5.2), so two
 * rhythm guitars sharing an instrument are legal.
 *
 * A track missing from a bar means that track is silent in that bar (spec 5.5),
 * which is not an issue.
 */
import { getInstrument, getPreset } from "@/lib/instruments/registry";
import type { Validator, ValidationIssue } from "@/lib/validators/types";

export const validateTrackReferences: Validator = (song) => {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();

  for (const track of song.tracks) {
    if (seen.has(track.id)) {
      issues.push({
        code: "trackReferences",
        severity: "error",
        message:
          `"${track.id}" track id'si birden fazla kez kullanılmış. ` +
          `Track id'leri benzersiz olmalı.`,
        trackId: track.id,
      });
    }
    seen.add(track.id);

    if (!getInstrument(track.instrumentId)) {
      issues.push({
        code: "trackReferences",
        severity: "error",
        message:
          `"${track.name}" track'i tanınmayan bir enstrümana işaret ediyor: ` +
          `"${track.instrumentId}".`,
        trackId: track.id,
      });
      continue;
    }

    if (!getPreset(track.instrumentId, track.presetId)) {
      issues.push({
        code: "trackReferences",
        severity: "error",
        message:
          `"${track.name}" track'i "${track.instrumentId}" enstrümanında ` +
          `bulunmayan bir preset'e işaret ediyor: "${track.presetId}".`,
        trackId: track.id,
      });
    }
  }

  for (const section of song.sections) {
    section.bars.forEach((bar, barIndex) => {
      for (const trackId of Object.keys(bar.slots)) {
        if (seen.has(trackId)) continue;
        issues.push({
          code: "trackReferences",
          severity: "error",
          message:
            `"${section.name}" bölümü, bar ${barIndex + 1}: şarkıda ` +
            `bulunmayan "${trackId}" track'ine nota yazılmış.`,
          sectionId: section.id,
          barIndex,
          trackId,
        });
      }
    });
  }

  return issues;
};

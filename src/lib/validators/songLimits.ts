/**
 * Central limit checks (spec 10.1 `songLimits`, values in spec 6).
 *
 * Voice counting follows the spec 6 definition: every NoteEvent/DrumHit that
 * starts or is still sounding at the same time. A tie ("-") keeps the voices of
 * the event it continues alive. Tie chains are resolved inside the bar; a bar
 * that opens with a tie has no resolvable origin here and contributes nothing.
 */
import { songLimits } from "@/lib/limits";
import type { Bar, DrumSlot, MelodicSlot } from "@/lib/song/schema";
import type { Validator, ValidationIssue } from "@/lib/validators/types";

/** Voices sounding at `slotIndex` for one track's slot array. */
function voicesAt(
  slots: readonly (MelodicSlot | DrumSlot)[],
  slotIndex: number,
): number {
  const slot = slots[slotIndex];
  if (slot === undefined) return 0;

  if (Array.isArray(slot)) return slot.length;
  if (slot === null) return 0;
  if (slot === "-") {
    // Walk back to the event this tie continues.
    for (let index = slotIndex - 1; index >= 0; index -= 1) {
      const previous = slots[index];
      if (previous === "-") continue;
      if (previous === null || previous === undefined) return 0;
      if (Array.isArray(previous)) return previous.length;
      return previous.notes.length;
    }
    return 0;
  }
  return slot.notes.length;
}

function maxSlotLength(bar: Bar): number {
  return Object.values(bar.slots).reduce(
    (longest, slots) => Math.max(longest, slots.length),
    0,
  );
}

export const validateSongLimits: Validator = (song) => {
  const issues: ValidationIssue[] = [];

  if (song.tracks.length > songLimits.maxTracks) {
    issues.push({
      code: "songLimits",
      severity: "error",
      message:
        `Şarkıda ${song.tracks.length} track var; sınır ` +
        `${songLimits.maxTracks}.`,
    });
  }

  const totalBars = song.sections.reduce(
    (total, section) => total + section.bars.length,
    0,
  );
  if (totalBars > songLimits.totalBars) {
    issues.push({
      code: "songLimits",
      severity: "error",
      message:
        `Şarkıda toplam ${totalBars} bar var; sınır ` +
        `${songLimits.totalBars}.`,
    });
  }

  for (const section of song.sections) {
    if (section.bars.length > songLimits.barsPerSection) {
      issues.push({
        code: "songLimits",
        severity: "error",
        message:
          `"${section.name}" bölümünde ${section.bars.length} bar var; ` +
          `bölüm başına sınır ${songLimits.barsPerSection}.`,
        sectionId: section.id,
      });
    }

    section.bars.forEach((bar, barIndex) => {
      const slotLength = maxSlotLength(bar);
      for (let slotIndex = 0; slotIndex < slotLength; slotIndex += 1) {
        const voices = Object.values(bar.slots).reduce(
          (total, slots) => total + voicesAt(slots, slotIndex),
          0,
        );
        if (voices <= songLimits.maxVoicesPerSlot) continue;
        issues.push({
          code: "songLimits",
          severity: "error",
          message:
            `"${section.name}" bölümü, bar ${barIndex + 1}, slot ` +
            `${slotIndex + 1}: aynı anda ${voices} ses var; sınır ` +
            `${songLimits.maxVoicesPerSlot}.`,
          sectionId: section.id,
          barIndex,
          slotIndex,
        });
      }
    });
  }

  return issues;
};

export const __testing = { voicesAt };

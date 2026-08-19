/**
 * Central limit checks (spec 10.1 `songLimits`, values in spec 6).
 *
 * Voice counting follows the spec 6 definition: every NoteEvent/DrumHit that
 * starts or is still sounding at the same time. A tie ("-") keeps the voices of
 * the event it continues alive.
 *
 * A tie chain reaching the first slot of a bar continues an event in the
 * previous bar, so voice state is carried across bars. Bars are walked in
 * playing order across the whole song, which means the carry also crosses a
 * section boundary. A track absent from a bar is silent there (spec 5.5), so
 * its carry resets to zero.
 */
import { songLimits } from "@/lib/limits";
import type { Bar, DrumSlot, MelodicSlot } from "@/lib/song/schema";
import type { Validator, ValidationIssue } from "@/lib/validators/types";

type Slots = readonly (MelodicSlot | DrumSlot)[];

/**
 * Voices sounding at `slotIndex`.
 *
 * `carriedIn` is what was still sounding at the end of the previous bar; it is
 * only used when a tie chain runs back past the first slot of this bar.
 */
function voicesAt(slots: Slots, slotIndex: number, carriedIn = 0): number {
  const slot = slots[slotIndex];
  if (slot === undefined) return 0;

  if (Array.isArray(slot)) return slot.length;
  if (slot === null) return 0;
  if (slot === "-") {
    for (let index = slotIndex - 1; index >= 0; index -= 1) {
      const previous = slots[index];
      if (previous === "-") continue;
      if (previous === null || previous === undefined) return 0;
      if (Array.isArray(previous)) return previous.length;
      return previous.notes.length;
    }
    // The tie chain reaches the start of the bar; it continues the last event
    // of the previous bar.
    return carriedIn;
  }
  return slot.notes.length;
}

/** Voices still sounding when the bar ends, to hand to the next bar. */
function carryOut(slots: Slots, carriedIn = 0): number {
  if (slots.length === 0) return 0;
  return voicesAt(slots, slots.length - 1, carriedIn);
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
  }

  // Voices are counted over the whole song in playing order so that a tie at
  // the start of a bar keeps the previous bar's event alive.
  const carry = new Map<string, number>();

  for (const section of song.sections) {
    section.bars.forEach((bar, barIndex) => {
      const slotLength = maxSlotLength(bar);

      for (let slotIndex = 0; slotIndex < slotLength; slotIndex += 1) {
        const voices = Object.entries(bar.slots).reduce(
          (total, [trackId, slots]) =>
            total + voicesAt(slots, slotIndex, carry.get(trackId) ?? 0),
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

      // Hand the tail of this bar to the next one. A track the bar does not
      // mention is silent, so it carries nothing forward.
      const written = new Set(Object.keys(bar.slots));
      for (const trackId of carry.keys()) {
        if (!written.has(trackId)) carry.set(trackId, 0);
      }
      for (const [trackId, slots] of Object.entries(bar.slots)) {
        carry.set(trackId, carryOut(slots, carry.get(trackId) ?? 0));
      }
    });
  }

  return issues;
};

export const __testing = { voicesAt, carryOut };

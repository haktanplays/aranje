/**
 * Changing how long one note is, and nothing else (2T §3.2, §7).
 *
 * ## The defect this replaces
 *
 * There was one way to make a note longer: select the slot *after* it and
 * press "Uzat", which wrote a tie into that slot. If the slot was empty that
 * worked. If it held a note — and in the acceptance fixture it held a `0` —
 * the tie was written **over** it and the note was gone. The reader had asked
 * for a longer note and been charged a shorter phrase for it.
 *
 * The tie was never really a duration control. It is a slot-level mark
 * meaning "whatever is sounding continues", so it can only lengthen a note by
 * spending the slot that follows, and it can only spend it by taking it from
 * whatever was there. A duration is a property of a note, so it belongs on
 * the note.
 *
 * ## What this does instead
 *
 * `setNoteDuration` writes `durationTicks` on one note of one slot. It reads
 * no other slot and writes no other slot, so there is nothing it could
 * delete, move or shorten. A note may now be longer than the space before the
 * next onset — that is a real thing guitars do, it is what §3.3 calls a dirty
 * arpeggio, and whether it is *heard* that long is the string's business, not
 * the score's.
 *
 * ## Quantised, and to the grid the reader can see
 *
 * A drag is a number of pixels and a duration is a musical value, so the
 * translation happens once, here, in slots. One slot of drag is one slot of
 * duration — not "the rest of the bar", and not a pixel count rounded into a
 * tick count with a remainder.
 */
import { ticksPerSlot, slotCount } from "@/lib/music/timing";
import {
  isMelodicSlotArray,
  songSchema,
  type NoteEvent,
  type Song,
} from "@/lib/song/schema";

export type DurationTarget = {
  readonly sectionId: string;
  readonly barIndex: number;
  readonly trackId: string;
  readonly slotIndex: number;
  /** Which note of the stack. A chord's voices have their own lengths. */
  readonly noteIndex: number;
};

export type DurationFailure =
  | "target_not_found"
  | "not_a_melodic_track"
  | "not_an_onset"
  | "note_not_found"
  | "duration_out_of_range"
  | "validation_failed";

export type DurationResult =
  | { readonly ok: true; readonly song: Song; readonly ticks: number }
  | { readonly ok: false; readonly reason: DurationFailure };

/**
 * The longest a note may be written: to the end of its own bar, plus the
 * bars after it in the same section.
 *
 * A duration that ran past the end of the music would be a number nothing
 * could draw and nothing could play, so it is refused rather than clipped —
 * clipping would silently give the reader a different note than they asked
 * for, which is the whole family of defect this file exists to end.
 */
export function maxDurationTicks(song: Song, target: DurationTarget): number {
  const section = song.sections.find((entry) => entry.id === target.sectionId);
  if (!section) return 0;
  const bar = section.bars[target.barIndex];
  if (!bar) return 0;

  const slotTicks = ticksPerSlot(bar.resolution);
  const slots = slotCount(bar.timeSignature, bar.resolution);
  let ticks = (slots - target.slotIndex) * slotTicks;

  for (const later of section.bars.slice(target.barIndex + 1)) {
    ticks += slotCount(later.timeSignature, later.resolution) * ticksPerSlot(later.resolution);
  }
  return ticks;
}

/** One slot of this bar, in ticks. The unit a duration drag moves in. */
export function slotTicksAt(song: Song, target: DurationTarget): number {
  const bar = song.sections
    .find((entry) => entry.id === target.sectionId)
    ?.bars[target.barIndex];
  return bar ? ticksPerSlot(bar.resolution) : 0;
}

/**
 * The note's current written length, which is where a drag starts from.
 *
 * A note with no `durationTicks` is one slot long *as far as this control is
 * concerned* — the tie run under it is a separate, older way of saying the
 * same thing, and mixing the two in one drag would make the first pixel of
 * movement jump. Ties keep working and keep meaning what they meant; this
 * control simply does not read them.
 */
export function currentDurationTicks(song: Song, target: DurationTarget): number {
  const note = noteAt(song, target);
  return note?.durationTicks ?? slotTicksAt(song, target);
}

function noteAt(song: Song, target: DurationTarget): NoteEvent | null {
  const bar = song.sections
    .find((entry) => entry.id === target.sectionId)
    ?.bars[target.barIndex];
  const slots = bar?.slots[target.trackId];
  if (!slots || !isMelodicSlotArray(slots)) return null;
  const slot = slots[target.slotIndex];
  if (slot === null || slot === undefined || slot === "-") return null;
  return slot.notes[target.noteIndex] ?? null;
}

/**
 * Set one note's length.
 *
 * Every other note in the song — including the one in the very next slot —
 * comes back byte-identical, because nothing else is read or written.
 */
export function setNoteDuration(
  song: Song,
  target: DurationTarget,
  ticks: number,
): DurationResult {
  const sectionIndex = song.sections.findIndex((entry) => entry.id === target.sectionId);
  if (sectionIndex < 0) return { ok: false, reason: "target_not_found" };
  const bar = song.sections[sectionIndex]!.bars[target.barIndex];
  if (!bar) return { ok: false, reason: "target_not_found" };

  const slots = bar.slots[target.trackId];
  if (!slots) return { ok: false, reason: "target_not_found" };
  if (!isMelodicSlotArray(slots)) return { ok: false, reason: "not_a_melodic_track" };

  const slot = slots[target.slotIndex];
  if (slot === undefined) return { ok: false, reason: "target_not_found" };
  if (slot === null || slot === "-") return { ok: false, reason: "not_an_onset" };
  if (slot.notes[target.noteIndex] === undefined) {
    return { ok: false, reason: "note_not_found" };
  }

  if (!Number.isInteger(ticks) || ticks <= 0) {
    return { ok: false, reason: "duration_out_of_range" };
  }
  if (ticks > maxDurationTicks(song, target)) {
    return { ok: false, reason: "duration_out_of_range" };
  }

  const oneSlot = ticksPerSlot(bar.resolution);
  const notes = slot.notes.map((note, index) => {
    if (index !== target.noteIndex) return note;
    /*
     * Back to one slot means back to having no field at all, so a note the
     * reader dragged out and back is the same bytes as one they never
     * touched. A duration equal to the default written down would be a
     * difference the score cannot hear and a diff would show.
     */
    if (ticks === oneSlot) {
      const rest = { ...note };
      delete rest.durationTicks;
      return rest;
    }
    return { ...note, durationTicks: ticks };
  });

  const next: Song = {
    ...song,
    sections: song.sections.map((section, index) =>
      index !== sectionIndex
        ? section
        : {
            ...section,
            bars: section.bars.map((entry, barIndex) =>
              barIndex !== target.barIndex
                ? entry
                : {
                    ...entry,
                    slots: {
                      ...entry.slots,
                      [target.trackId]: slots.map((current, slotIndex) =>
                        slotIndex === target.slotIndex ? { notes } : current,
                      ),
                    },
                  },
            ),
          },
    ),
  };

  const parsed = songSchema.safeParse(next);
  if (!parsed.success) return { ok: false, reason: "validation_failed" };
  return { ok: true, song: parsed.data, ticks };
}

/**
 * Where a drag of `steps` grid slots lands, clamped to what is writable.
 *
 * Clamping the *drag* is not the same as clipping the *duration*: a finger
 * that keeps moving past the end of the section stops at the end of the
 * section, which is what a reader expects a handle to do. What is refused is
 * a caller asking for a length the music has no room for.
 */
export function durationFromDrag(
  song: Song,
  target: DurationTarget,
  steps: number,
): number {
  const oneSlot = slotTicksAt(song, target);
  if (oneSlot === 0) return 0;
  const from = currentDurationTicks(song, target);
  const wanted = from + Math.round(steps) * oneSlot;
  return Math.min(Math.max(wanted, oneSlot), maxDurationTicks(song, target));
}

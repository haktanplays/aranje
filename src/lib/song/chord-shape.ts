/**
 * Turning a chord into an arpeggio, a strum, or back (2T §3.4, §8).
 *
 * ## Four different things, kept different
 *
 * - A **chord** is voices sharing one written onset.
 * - A **strum** is that same chord, performed by dragging a pick across the
 *   strings — so the onset stays one onset and the *performance* carries a
 *   direction. Splitting it into separate written onsets would be writing
 *   down a lie: nobody counts a strum in sixteenths.
 * - An **arpeggio** is voices written on separate onsets. That is a different
 *   score, and it is what this transform produces.
 * - A **dirty arpeggio** is that, with the notes still ringing over each
 *   other — which is a duration question, and Score Truth v2 made it one.
 *
 * The distinction has to survive into playback or it was never real, which is
 * why a strum sets `strumDirection` on the notes and an arpeggio moves them.
 *
 * ## What a transform may not do
 *
 * Lose a note. Change a pitch. Drop an articulation. Silently clip music that
 * no longer fits the bar. Every one of those is refused or reported rather
 * than done, because a reader who converts a chord and gets four notes back
 * out of five has been robbed by a convenience feature.
 */
import { ticksPerSlot, slotCount } from "@/lib/music/timing";
import {
  isMelodicSlotArray,
  songSchema,
  type MelodicSlot,
  type NoteEvent,
  type Song,
} from "@/lib/song/schema";

export type ChordTarget = {
  readonly sectionId: string;
  readonly barIndex: number;
  readonly trackId: string;
  readonly slotIndex: number;
};

/** Low string to high, or high to low. The physical direction of the hand. */
export type ArpeggioDirection = "down_to_up" | "up_to_down";

/** How far apart the arpeggio's onsets are, in ticks. */
export type ArpeggioStep = 96 | 48 | 24;

export type ArpeggioOptions = {
  readonly direction: ArpeggioDirection;
  readonly stepTicks: ArpeggioStep;
  /**
   * Detached: each voice stops when the next begins.
   * Ringing: every voice keeps its full length and they overlap (§3.3).
   */
  readonly ring: boolean;
};

export type TransformFailure =
  | "target_not_found"
  | "not_a_melodic_track"
  | "not_a_chord"
  | "would_not_fit"
  | "validation_failed";

export type TransformResult =
  | {
      readonly ok: true;
      readonly song: Song;
      /** Where the voices ended up, for a preview to draw. */
      readonly onsets: readonly { readonly slotIndex: number; readonly pitch: string }[];
    }
  | { readonly ok: false; readonly reason: TransformFailure; readonly detail?: string };

type Located = {
  readonly sectionIndex: number;
  readonly slots: readonly MelodicSlot[];
  readonly notes: readonly NoteEvent[];
  readonly slotTicks: number;
  readonly slots_: number;
};

function locate(song: Song, target: ChordTarget): Located | TransformFailure {
  const sectionIndex = song.sections.findIndex((entry) => entry.id === target.sectionId);
  if (sectionIndex < 0) return "target_not_found";
  const bar = song.sections[sectionIndex]!.bars[target.barIndex];
  if (!bar) return "target_not_found";
  const slots = bar.slots[target.trackId];
  if (!slots) return "target_not_found";
  if (!isMelodicSlotArray(slots)) return "not_a_melodic_track";
  const slot = slots[target.slotIndex];
  if (slot === undefined || slot === null || slot === "-") return "not_a_chord";
  return {
    sectionIndex,
    slots,
    notes: slot.notes,
    slotTicks: ticksPerSlot(bar.resolution),
    slots_: slotCount(bar.timeSignature, bar.resolution),
  };
}

function withSlots(
  song: Song,
  target: ChordTarget,
  sectionIndex: number,
  next: readonly MelodicSlot[],
): Song {
  return {
    ...song,
    sections: song.sections.map((section, index) =>
      index !== sectionIndex
        ? section
        : {
            ...section,
            bars: section.bars.map((bar, barIndex) =>
              barIndex !== target.barIndex
                ? bar
                : { ...bar, slots: { ...bar.slots, [target.trackId]: [...next] } },
            ),
          },
    ),
  };
}

const settle = (
  song: Song,
  onsets: readonly { slotIndex: number; pitch: string }[],
): TransformResult => {
  const parsed = songSchema.safeParse(song);
  return parsed.success
    ? { ok: true, song: parsed.data, onsets }
    : { ok: false, reason: "validation_failed" };
};

/**
 * The order a hand crosses the strings.
 *
 * A guitar is written low string first, so "down to up" is the array order
 * and "up to down" is its reverse. Sorting by pitch would be wrong for a
 * voicing where a lower string carries a higher note, which happens.
 */
function ordered(
  notes: readonly NoteEvent[],
  direction: ArpeggioDirection,
): readonly { note: NoteEvent; index: number }[] {
  const list = notes.map((note, index) => ({ note, index }));
  const byString = [...list].sort(
    (a, b) => (a.note.position?.string ?? a.index) - (b.note.position?.string ?? b.index),
  );
  return direction === "down_to_up" ? byString : [...byString].reverse();
}

/**
 * Spread a chord's voices over separate onsets.
 *
 * Everything except onset and duration survives untouched: pitch, string,
 * fret, velocity and articulation all travel with their note. In ringing mode
 * each voice keeps sounding to where the chord's last voice ends, so the
 * strings overlap the way a real let-ring arpeggio does; in detached mode a
 * voice lasts exactly until the next one starts.
 */
export function chordToArpeggio(
  song: Song,
  target: ChordTarget,
  options: ArpeggioOptions,
): TransformResult {
  const found = locate(song, target);
  if (typeof found === "string") return { ok: false, reason: found };
  if (found.notes.length < 2) {
    return { ok: false, reason: "not_a_chord", detail: "Tek sesli bir onset arpej olamaz." };
  }

  const spread = ordered(found.notes, options.direction);
  const stepSlots = options.stepTicks / found.slotTicks;
  if (!Number.isInteger(stepSlots) || stepSlots < 1) {
    return {
      ok: false,
      reason: "would_not_fit",
      detail: "Bu adım bu ızgarada yazılamaz.",
    };
  }

  const lastSlot = target.slotIndex + (spread.length - 1) * stepSlots;
  if (lastSlot >= found.slots_) {
    return {
      ok: false,
      reason: "would_not_fit",
      detail: "Arpej ölçünün dışına taşar.",
    };
  }

  /*
   * Every slot the arpeggio lands on must be free, or converting would
   * destroy music the reader did not mention. Refusing is the whole
   * difference between a transform and a bulldozer.
   */
  const wanted = spread.map((_, position) => target.slotIndex + position * stepSlots);
  for (const slotIndex of wanted.slice(1)) {
    const occupant = found.slots[slotIndex];
    if (occupant !== null && occupant !== undefined) {
      return {
        ok: false,
        reason: "would_not_fit",
        detail: "Arpejin geçeceği yerlerde başka notalar var.",
      };
    }
  }

  const totalTicks = spread.length * options.stepTicks;
  const next = [...found.slots];
  const onsets: { slotIndex: number; pitch: string }[] = [];

  spread.forEach((entry, position) => {
    const slotIndex = wanted[position]!;
    const heldTicks = options.ring
      ? totalTicks - position * options.stepTicks
      : options.stepTicks;
    const note: NoteEvent = { ...entry.note, durationTicks: heldTicks };
    /*
     * The overlap is carried by the durations — each voice is written long
     * enough to reach the end of the figure, and the voices are on different
     * strings, so nothing cuts them (2T-B §3.1). `letRing` is written beside
     * that as the performance instruction it is: do not damp these. It cannot
     * make a string hold two frets, and it is not being asked to.
     */
    if (options.ring) note.letRing = true;
    next[slotIndex] = { notes: [note] };
    onsets.push({ slotIndex, pitch: entry.note.pitch });
  });

  return settle(withSlots(song, target, found.sectionIndex, next), onsets);
}

/**
 * Gather an arpeggio's voices back onto one onset.
 *
 * The inverse in intent, not in bytes: a chord that was arpeggiated and put
 * back has lost the durations the arpeggio gave it, because those were the
 * arpeggio. Pitches, strings, velocities and articulations all return.
 */
export function arpeggioToChord(
  song: Song,
  target: ChordTarget,
  spanSlots: number,
): TransformResult {
  const found = locate(song, target);
  if (typeof found === "string") return { ok: false, reason: found };

  const notes: NoteEvent[] = [];
  const next = [...found.slots];
  const end = Math.min(target.slotIndex + spanSlots, found.slots_);

  for (let slotIndex = target.slotIndex; slotIndex < end; slotIndex += 1) {
    const slot = found.slots[slotIndex];
    if (slot === null || slot === undefined || slot === "-") continue;
    for (const note of slot.notes) {
      const gathered = { ...note };
      delete gathered.durationTicks;
      delete gathered.letRing;
      notes.push(gathered);
    }
    if (slotIndex !== target.slotIndex) next[slotIndex] = null;
  }

  if (notes.length < 2) {
    return { ok: false, reason: "not_a_chord", detail: "Toplanacak birden fazla ses yok." };
  }

  next[target.slotIndex] = { notes };
  return settle(
    withSlots(song, target, found.sectionIndex, next),
    notes.map((note) => ({ slotIndex: target.slotIndex, pitch: note.pitch })),
  );
}

/**
 * Mark a chord as strummed, without moving a single note (§3.4, §8).
 *
 * The onset stays one onset. What changes is how it is *performed*: the
 * strings are crossed low to high or high to low, with the small time offsets
 * a hand actually produces. Those offsets belong to the performance and not
 * to the score, which is why nothing here writes a new onset.
 *
 * `null` takes the mark off again, and takes the field with it — a chord set
 * back to unstrummed is the same bytes as one never marked.
 */
export function setChordStrum(
  song: Song,
  target: ChordTarget,
  direction: "down" | "up" | null,
): TransformResult {
  const found = locate(song, target);
  if (typeof found === "string") return { ok: false, reason: found };
  if (found.notes.length < 2) {
    return { ok: false, reason: "not_a_chord", detail: "Tek ses strum olamaz." };
  }

  const notes = found.notes.map((note) => {
    const next = { ...note };
    if (direction === null) delete next.strum;
    else next.strum = direction;
    return next;
  });

  const slots = [...found.slots];
  slots[target.slotIndex] = { notes };
  return settle(
    withSlots(song, target, found.sectionIndex, slots),
    notes.map((note) => ({ slotIndex: target.slotIndex, pitch: note.pitch })),
  );
}

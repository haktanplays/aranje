/**
 * How long each written note actually sounds (2T §3.2, §3.3).
 *
 * ## The thing this replaces
 *
 * A track's bar is one array of slots, and until Score Truth v2 a slot was an
 * onset for *every* string at once. So the reading was: an onset opens notes,
 * a tie extends whatever is open, and **any** later onset closes **all** of
 * them. That is a monophonic rule wearing a polyphonic costume, and it is the
 * shape behind three separate founder findings — a note's length being cut by
 * the next note, a bass string that will not ring under a melody, and an
 * arpeggio that cannot be dirty.
 *
 * ## The reading now
 *
 * Three questions, asked separately, because they are separate:
 *
 * 1. **Where does it start?** The slot it is written on. Unchanged.
 * 2. **How long is it written for?** Its own `durationTicks` if it has one;
 *    otherwise the tie run under it, which is exactly the old rule. A song
 *    with no durations therefore reads identically — that is what makes the
 *    migration silent in the honest sense.
 * 3. **How long does it sound?** Its written length, unless the same string
 *    is struck again first — and even then only when the note did not ask to
 *    ring on. A different string being struck does nothing to it at all.
 *
 * Only the third question is about physics, and it is the only one that
 * shortens anything. Nothing here deletes, moves or rewrites a note: this
 * module reads a score and returns what would be heard.
 */
import { isMelodicSlotArray, type Bar, type NoteEvent, type Song } from "@/lib/song/schema";
import { slotCount, ticksPerSlot } from "@/lib/music/timing";

export type WrittenSpan = {
  readonly barIndex: number;
  readonly slotIndex: number;
  readonly noteIndex: number;
  readonly note: NoteEvent;
  readonly startTicks: number;
  /** What the score says. Never shortened by anything on another string. */
  readonly writtenTicks: number;
  /** True when the length came from the note itself rather than a tie run. */
  readonly explicit: boolean;
};

export type SoundingSpan = WrittenSpan & {
  /** What is heard. Equal to `writtenTicks` unless the string was retaken. */
  readonly soundingTicks: number;
  /** The string this was resolved onto, or null when nothing resolved it. */
  readonly stringIndex: number | null;
  /** True when a later attack on the same string ended it early. */
  readonly cutByRestrike: boolean;
};

/** Where each bar of a section begins, in ticks from the section's start. */
export function barOffsets(bars: readonly Bar[]): readonly number[] {
  const offsets: number[] = [];
  let at = 0;
  for (const bar of bars) {
    offsets.push(at);
    at += slotCount(bar.timeSignature, bar.resolution) * ticksPerSlot(bar.resolution);
  }
  return offsets;
}

/**
 * The tie run under a slot, in ticks, crossing bars the way a tie does.
 *
 * Bars can be on different grids, so this is summed slot by slot rather than
 * multiplied: a note tied from a sixteenth bar into a thirty-second one is
 * two different slot lengths added together, not one length counted twice.
 */
function legacyTicks(
  bars: readonly Bar[],
  trackId: string,
  barIndex: number,
  slotIndex: number,
): number {
  let ticks = ticksPerSlot(bars[barIndex]!.resolution);
  let bar = barIndex;
  let slot = slotIndex + 1;

  for (;;) {
    const current = bars[bar];
    if (!current) break;
    const slots = current.slots[trackId];
    if (!slots || !isMelodicSlotArray(slots)) break;

    if (slot >= slots.length) {
      bar += 1;
      slot = 0;
      continue;
    }
    if (slots[slot] !== "-") break;
    ticks += ticksPerSlot(current.resolution);
    slot += 1;
  }
  return ticks;
}

/**
 * Every written note in one track of one section, with its written length.
 *
 * Pure and string-blind: nothing here knows which string anything is on, so
 * nothing here can cut one note short because of another. That is deliberate
 * — the score is what it is, and occlusion is a separate, later question.
 */
export function writtenSpans(
  bars: readonly Bar[],
  trackId: string,
): readonly WrittenSpan[] {
  const offsets = barOffsets(bars);
  const spans: WrittenSpan[] = [];

  bars.forEach((bar, barIndex) => {
    const slots = bar.slots[trackId];
    if (!slots || !isMelodicSlotArray(slots)) return;
    const slotTicks = ticksPerSlot(bar.resolution);

    slots.forEach((slot, slotIndex) => {
      if (slot === null || slot === "-") return;
      const startTicks = offsets[barIndex]! + slotIndex * slotTicks;
      slot.notes.forEach((note, noteIndex) => {
        const explicit = note.durationTicks !== undefined;
        spans.push({
          barIndex,
          slotIndex,
          noteIndex,
          note,
          startTicks,
          writtenTicks:
            note.durationTicks ?? legacyTicks(bars, trackId, barIndex, slotIndex),
          explicit,
        });
      });
    });
  });

  return spans;
}

/**
 * What a string can physically do, applied to written spans (§3.3).
 *
 * One string sounds one note, so a second attack on it ends the first — that
 * is the guitar, not a policy. `letRing` is the reader saying they want the
 * dirty version anyway, and it is honoured: a let-ring note keeps its full
 * written length and the two overlap, which is what a real let-ring pedal
 * point sounds like and what the previous model could not express at all.
 *
 * Notes on *different* strings never touch each other here. That is the whole
 * point: six strings, six independent lives.
 *
 * `stringOf` resolves a span to a string. It returns null for a note nothing
 * could place, and an unplaced note occludes nothing and is occluded by
 * nothing — a note with no string cannot be competing for one.
 */
export function soundingSpans(
  spans: readonly WrittenSpan[],
  stringOf: (span: WrittenSpan) => number | null,
): readonly SoundingSpan[] {
  const withStrings = spans.map((span) => ({ span, stringIndex: stringOf(span) }));

  /* Attack times per string, so "the next attack" is a lookup, not a scan. */
  const attacks = new Map<number, number[]>();
  for (const { span, stringIndex } of withStrings) {
    if (stringIndex === null) continue;
    const list = attacks.get(stringIndex) ?? [];
    list.push(span.startTicks);
    attacks.set(stringIndex, list);
  }
  for (const list of attacks.values()) list.sort((a, b) => a - b);

  return withStrings.map(({ span, stringIndex }) => {
    const letRing = span.note.letRing === true;
    if (stringIndex === null || letRing) {
      return {
        ...span,
        stringIndex,
        soundingTicks: span.writtenTicks,
        cutByRestrike: false,
      };
    }
    const next = (attacks.get(stringIndex) ?? []).find(
      (at) => at > span.startTicks,
    );
    const room = next === undefined ? span.writtenTicks : next - span.startTicks;
    const soundingTicks = Math.min(span.writtenTicks, room);
    return {
      ...span,
      stringIndex,
      soundingTicks,
      cutByRestrike: soundingTicks < span.writtenTicks,
    };
  });
}

/** Both passes, for a caller that has a placement to hand. */
export function soundingOf(
  song: Song,
  sectionId: string,
  trackId: string,
  stringOf: (span: WrittenSpan) => number | null,
): readonly SoundingSpan[] {
  const section = song.sections.find((entry) => entry.id === sectionId);
  if (!section) return [];
  return soundingSpans(writtenSpans(section.bars, trackId), stringOf);
}

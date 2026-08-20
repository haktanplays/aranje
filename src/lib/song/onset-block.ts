/**
 * What a musician grabs hold of when they move something in time.
 *
 * The unit is **not** a note and **not** a slot: it is an *onset block* — one
 * struck slot, every note of the chord in it, and the unbroken run of ties
 * that keeps that chord sounding (spec 5.4, 5.5). Moving anything smaller
 * would either break a chord apart or leave a tie behind with nothing to
 * continue, and neither is something a player would recognise as their music.
 *
 * Everything here is pure and reads a section as a flat stream of slots, so a
 * move can cross a bar line without any assumption about 4/4 or eight slots.
 * A bar the track is not written in still contributes its positions, marked as
 * not writable, because that is a hole a block may not be dropped into (spec
 * 5.5) — not a gap to be silently skipped over.
 */
import { slotCount, ticksPerSlot } from "@/lib/music/timing";
import { isDrumSlotArray, type MelodicSlot, type Section, type Song } from "@/lib/song/schema";

/** One slot of one track inside a section. */
export type OnsetRef = { barIndex: number; slotIndex: number };

/** One position in the section's flat slot stream. */
export type SlotPosition = OnsetRef & {
  /** False when the track is not written in this bar (spec 5.5). */
  writable: boolean;
  /** The slot as written, or undefined where the track is not written. */
  slot: MelodicSlot | undefined;
  /**
   * Where this slot begins, in ticks from the start of the section.
   *
   * Bars no longer share a grid (spec 5.5, K-34), so a slot index means
   * nothing on its own: slot 8 is beat three of a 1/16 bar and beat two of a
   * 1/32 one. Anything that moves music in *time* has to work from this
   * rather than from the index.
   */
  startTicks: number;
  /** How long this slot lasts, on its own bar's grid. */
  durationTicks: number;
};

export type OnsetBlock = {
  /** The struck slot the block starts on. */
  start: OnsetRef;
  /** The tie slots that keep it sounding, in order; may cross bar lines. */
  tail: readonly OnsetRef[];
  /** Start plus tail, in flat-stream order. */
  length: number;
  /** Index of `start` in the section's flat slot stream. */
  startIndex: number;
};

export function sameRef(a: OnsetRef, b: OnsetRef): boolean {
  return a.barIndex === b.barIndex && a.slotIndex === b.slotIndex;
}

export function refKey(ref: OnsetRef): string {
  return `${ref.barIndex}:${ref.slotIndex}`;
}

/**
 * Every slot position of one track in one section, in playing order.
 *
 * Bars are enumerated by their own `timeSignature` and `resolution`, so a
 * section of mixed metres flattens correctly and nothing assumes a slot count.
 */
export function sectionSlotStream(
  section: Section,
  trackId: string,
): SlotPosition[] {
  const stream: SlotPosition[] = [];
  let barStartTicks = 0;

  section.bars.forEach((bar, barIndex) => {
    const slots = bar.slots[trackId];
    const count = slotCount(bar.timeSignature, bar.resolution);
    const step = ticksPerSlot(bar.resolution);
    // A drum slot array is not this track's shape; it is treated as unwritable
    // rather than pretending a melodic block could land in it.
    const writable = slots !== undefined && !isDrumSlotArray(slots);
    const melodic = writable ? (slots as readonly MelodicSlot[]) : undefined;

    for (let slotIndex = 0; slotIndex < count; slotIndex += 1) {
      stream.push({
        barIndex,
        slotIndex,
        writable,
        slot: writable ? (melodic?.[slotIndex] ?? null) : undefined,
        startTicks: barStartTicks + slotIndex * step,
        durationTicks: step,
      });
    }

    barStartTicks += count * step;
  });

  return stream;
}

/** Where each bar of a section begins, in ticks from the section's start. */
export function sectionBarStartTicks(section: Section): number[] {
  const starts: number[] = [];
  let ticks = 0;
  for (const bar of section.bars) {
    starts.push(ticks);
    ticks += slotCount(bar.timeSignature, bar.resolution) * ticksPerSlot(bar.resolution);
  }
  return starts;
}

/** The section with this id, or null. */
export function findSection(song: Song, sectionId: string): Section | null {
  return song.sections.find((section) => section.id === sectionId) ?? null;
}

/** True when this stream entry is a struck chord rather than a rest or a tie. */
function isOnset(entry: SlotPosition | undefined): boolean {
  return entry !== undefined && entry.writable && entry.slot !== null && entry.slot !== "-";
}

/**
 * Every onset block of one track in one section, in playing order.
 *
 * A tie run stops at a rest, at another onset, and at a bar the track is not
 * written in — the same three things that end a sounding note everywhere else.
 */
export function sectionOnsetBlocks(
  section: Section,
  trackId: string,
): OnsetBlock[] {
  const stream = sectionSlotStream(section, trackId);
  const blocks: OnsetBlock[] = [];

  stream.forEach((entry, index) => {
    if (!isOnset(entry)) return;

    const tail: OnsetRef[] = [];
    for (let cursor = index + 1; cursor < stream.length; cursor += 1) {
      const next = stream[cursor];
      if (!next || !next.writable || next.slot !== "-") break;
      tail.push({ barIndex: next.barIndex, slotIndex: next.slotIndex });
    }

    blocks.push({
      start: { barIndex: entry.barIndex, slotIndex: entry.slotIndex },
      tail,
      length: tail.length + 1,
      startIndex: index,
    });
  });

  return blocks;
}

/**
 * The block a slot belongs to, whether the slot is the onset itself or one of
 * its ties. A rest belongs to nothing.
 *
 * This is what a tap resolves to: touching any string of a chord, or any part
 * of the sound it holds, is touching the same block.
 */
export function blockContaining(
  blocks: readonly OnsetBlock[],
  ref: OnsetRef,
): OnsetBlock | null {
  for (const block of blocks) {
    if (sameRef(block.start, ref)) return block;
    if (block.tail.some((entry) => sameRef(entry, ref))) return block;
  }
  return null;
}

/** Every slot a block occupies, in order. */
export function blockRefs(block: OnsetBlock): OnsetRef[] {
  return [block.start, ...block.tail];
}

/** Canonical order: by bar, then by slot. Selections are always kept this way. */
export function compareRefs(a: OnsetRef, b: OnsetRef): number {
  return a.barIndex - b.barIndex || a.slotIndex - b.slotIndex;
}

/** Sorted and de-duplicated, so the same selection is always the same list. */
export function canonicalRefs(refs: readonly OnsetRef[]): OnsetRef[] {
  const seen = new Set<string>();
  const unique: OnsetRef[] = [];
  for (const ref of refs) {
    const key = refKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ barIndex: ref.barIndex, slotIndex: ref.slotIndex });
  }
  return unique.sort(compareRefs);
}

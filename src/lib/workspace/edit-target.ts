/**
 * Where the editor's panels are pointing (2V-B.4 §4, §5, §12, §14).
 *
 * ## One target, four panels
 *
 * Nota, Akor, Hızlı dizi and Süre all need the same handful of facts: which
 * section and measure, which track, where in the measure, how long a beat is,
 * how much room there is, what is already written nearby. Computing them in
 * four components would be four chances to disagree about which measure the
 * reader is in — and the one thing worse than an edit landing nowhere is an
 * edit landing somewhere else.
 *
 * ## Ticks from the start of the measure
 *
 * Every offset here is bar-relative, because that is the frame the write
 * commands take. The one exception is `sectionTicks`, which is what the
 * chord command and the selection use, and it is named so it cannot be
 * mistaken for the other.
 *
 * Pure: a Song, a track and the reader's current cell or range go in, and a
 * description comes out. It writes nothing.
 */
import { slotCount, ticksPerBar, ticksPerSlot, PPQ } from "@/lib/music/timing";
import { isMelodicSlotArray, type MelodicSlot, type Song } from "@/lib/song/schema";

export type EditTarget = {
  readonly sectionId: string;
  readonly trackId: string;
  readonly barIndex: number;
  /** One-based, the number the tab draws and the reader says out loud. */
  readonly barNumber: number;
  /** Where the target starts, in ticks from the start of the measure. */
  readonly startTicks: number;
  /** And in ticks from the start of the section, for the chord command. */
  readonly sectionTicks: number;
  /** How much time the target covers. One grid step for a single cell. */
  readonly spanTicks: number;
  readonly slotTicks: number;
  readonly beatTicks: number;
  readonly barTicks: number;
  readonly resolution: number;
  /** How long the note here sounds now, or 0 when the cell is empty. */
  readonly currentTicks: number;
  /** The next onset on this track after the target, in bar ticks, or null. */
  readonly nextOnsetTicks: number | null;
  /** Every occupied moment in this measure, for the rhythm authority. */
  readonly existingTicks: readonly number[];
  /** The most a note here could last without leaving the measure. */
  readonly maxTicks: number;
  /** Which string the reader is on, when the target is one cell. */
  readonly stringIndex: number | null;
};

/** Where the reader's cell is, in the terms this module needs. */
export type CellRef = {
  readonly barKey: string;
  readonly slotIndex: number;
  readonly stringIndex: number;
};

/** Where a held range is, in section ticks. */
export type RangeRef = {
  readonly sectionId: string;
  readonly startTicks: number;
  readonly endTicks: number;
};

function barStartTicks(song: Song, sectionId: string, barIndex: number): number {
  const section = song.sections.find((entry) => entry.id === sectionId);
  if (!section) return 0;
  let ticks = 0;
  for (const [index, bar] of section.bars.entries()) {
    if (index === barIndex) return ticks;
    ticks += ticksPerBar(bar.timeSignature, bar.resolution);
  }
  return ticks;
}

function laneOf(song: Song, sectionId: string, barIndex: number, trackId: string) {
  const bar = song.sections.find((entry) => entry.id === sectionId)?.bars[barIndex];
  const lane = bar?.slots[trackId];
  return lane && isMelodicSlotArray(lane) ? (lane as readonly MelodicSlot[]) : null;
}

/**
 * A target from the cell the reader tapped.
 *
 * The span of a single cell is one grid step: that is what "here" means when
 * a finger lands on one position, and it is what the fast-sequence flow
 * divides when the reader has not held a range.
 */
export function targetFromCell(
  song: Song,
  trackId: string,
  cell: CellRef,
): EditTarget | null {
  const [sectionId, barText] = cell.barKey.split(":");
  const barIndex = Number(barText);
  if (!sectionId || !Number.isInteger(barIndex)) return null;
  const section = song.sections.find((entry) => entry.id === sectionId);
  const bar = section?.bars[barIndex];
  if (!section || !bar) return null;

  const slotTicks = ticksPerSlot(bar.resolution);
  const barTicks = ticksPerBar(bar.timeSignature, bar.resolution);
  const startTicks = cell.slotIndex * slotTicks;
  const lane = laneOf(song, sectionId, barIndex, trackId);

  const occupied: number[] = [];
  let nextOnset: number | null = null;
  let current = 0;
  if (lane) {
    for (const [index, slot] of lane.entries()) {
      if (slot === null) continue;
      occupied.push(index * slotTicks);
      if (slot === "-") continue;
      if (index * slotTicks > startTicks && nextOnset === null) {
        nextOnset = index * slotTicks;
      }
    }
    /* How long the run under the finger lasts: the onset plus its ties. */
    const here = lane[cell.slotIndex];
    if (here !== null && here !== undefined && here !== "-") {
      current = slotTicks;
      for (const slot of lane.slice(cell.slotIndex + 1)) {
        if (slot !== "-") break;
        current += slotTicks;
      }
    }
  }

  return {
    sectionId,
    trackId,
    barIndex,
    barNumber: barIndex + 1,
    startTicks,
    sectionTicks: barStartTicks(song, sectionId, barIndex) + startTicks,
    spanTicks: nextOnset === null ? Math.max(slotTicks, current) : nextOnset - startTicks,
    slotTicks,
    beatTicks: PPQ * (4 / bar.timeSignature[1]),
    barTicks,
    resolution: bar.resolution,
    currentTicks: current,
    nextOnsetTicks: nextOnset,
    existingTicks: occupied,
    maxTicks: barTicks - startTicks,
    stringIndex: cell.stringIndex,
  };
}

/**
 * A target from a held range.
 *
 * The range may cross measures; the target is the measure its *start* is in,
 * because that is the measure an edit would be written into and the one whose
 * grid decides whether a denser run is expressible.
 */
export function targetFromRange(
  song: Song,
  trackId: string,
  range: RangeRef,
): EditTarget | null {
  const section = song.sections.find((entry) => entry.id === range.sectionId);
  if (!section) return null;

  let ticks = 0;
  for (const [barIndex, bar] of section.bars.entries()) {
    const barTicks = ticksPerBar(bar.timeSignature, bar.resolution);
    if (range.startTicks < ticks + barTicks) {
      const slotTicks = ticksPerSlot(bar.resolution);
      const startTicks = range.startTicks - ticks;
      const lane = laneOf(song, section.id, barIndex, trackId);
      const occupied: number[] = [];
      let nextOnset: number | null = null;
      if (lane) {
        for (const [index, slot] of lane.entries()) {
          if (slot === null) continue;
          occupied.push(index * slotTicks);
          if (slot !== "-" && index * slotTicks >= range.endTicks - ticks && nextOnset === null) {
            nextOnset = index * slotTicks;
          }
        }
      }
      return {
        sectionId: section.id,
        trackId,
        barIndex,
        barNumber: barIndex + 1,
        startTicks,
        sectionTicks: range.startTicks,
        spanTicks: Math.max(slotTicks, range.endTicks - range.startTicks),
        slotTicks,
        beatTicks: PPQ * (4 / bar.timeSignature[1]),
        barTicks,
        resolution: bar.resolution,
        currentTicks: range.endTicks - range.startTicks,
        nextOnsetTicks: nextOnset,
        existingTicks: occupied,
        maxTicks: barTicks - startTicks,
        stringIndex: null,
      };
    }
    ticks += barTicks;
  }
  return null;
}

/** How many slots this measure has. For a caller that draws them. */
export function slotsOfTarget(song: Song, target: EditTarget): number {
  const bar = song.sections.find((entry) => entry.id === target.sectionId)?.bars[
    target.barIndex
  ];
  return bar ? slotCount(bar.timeSignature, bar.resolution) : 0;
}

/**
 * The kit as a grid you can tap (2Q-B §5.1).
 *
 * A row per piece, a cell per slot, and every cell carrying the **tick** it
 * stands for — because that is what the entry commands take, and a model that
 * handed a component a slot index would make the component do arithmetic it
 * has no business doing.
 *
 * ## Which rows exist
 *
 * Two sources, both already in the app, and no third list invented here:
 *
 * - the pieces the song already uses on this track, which is what the tab's
 *   own drum timeline draws, and
 * - the core kit's pieces, so a track with nothing written in it still has
 *   somewhere to write. Without this a brand new kit renders zero rows and
 *   the first hit is impossible — the same shape of defect K-55 closed for
 *   the missing lane.
 *
 * Order is notation order (`DRUM_PIECES`), so the rows read top to bottom the
 * way a drum staff does and never re-order themselves as the reader writes.
 */
import {
  CORE_DRUM_PIECES,
  DRUM_PIECES,
  type DrumPiece,
} from "@/lib/instruments/registry";
import { drumPieceName } from "@/lib/instruments/labels";
import { slotCount, ticksPerSlot } from "@/lib/music/timing";
import type { DrumHit, DrumSlot, Song, TimeSignature } from "@/lib/song/schema";

export type DrumStepCell = {
  /** Ticks from the start of the section — what an entry command wants. */
  readonly ticks: number;
  readonly barKey: string;
  readonly barIndex: number;
  readonly slotIndex: number;
  /** The hit that is there, when there is one. */
  readonly hit: DrumHit | null;
};

export type DrumStepRow = {
  readonly piece: DrumPiece;
  /** The reader's word for it. Never the identifier. */
  readonly label: string;
  readonly cells: readonly DrumStepCell[];
};

export type DrumStepBar = {
  readonly key: string;
  readonly barIndex: number;
  readonly barNumber: number;
  readonly slotCount: number;
  readonly timeSignature: TimeSignature;
  readonly resolution: number;
  /** Ticks from the start of the section. */
  readonly startTicks: number;
};

export type DrumStepModel = {
  readonly trackId: string;
  readonly sectionId: string;
  readonly rows: readonly DrumStepRow[];
  readonly bars: readonly DrumStepBar[];
  /** True when this track is not written in a single bar of this section. */
  readonly silentThroughout: boolean;
};

/** The rows this track gets: what it uses, plus what the core kit offers. */
export function stepRowsFor(song: Song, trackId: string): DrumPiece[] {
  const used = new Set<DrumPiece>();
  for (const section of song.sections) {
    for (const bar of section.bars) {
      const lane = bar.slots[trackId];
      if (!Array.isArray(lane)) continue;
      for (const slot of lane) {
        if (!Array.isArray(slot)) continue;
        for (const hit of slot as DrumSlot) used.add(hit.piece);
      }
    }
  }
  for (const piece of CORE_DRUM_PIECES) used.add(piece);
  return DRUM_PIECES.filter((piece) => used.has(piece));
}

export function buildDrumStepModel(
  song: Song,
  sectionId: string,
  trackId: string,
): DrumStepModel {
  const section =
    song.sections.find((entry) => entry.id === sectionId) ?? song.sections[0];
  const resolvedId = section?.id ?? sectionId;

  let barNumber = 0;
  for (const entry of song.sections) {
    if (entry.id === resolvedId) break;
    barNumber += entry.bars.length;
  }

  let startTicks = 0;
  const bars: DrumStepBar[] = [];
  for (const [barIndex, bar] of (section?.bars ?? []).entries()) {
    const count = slotCount(bar.timeSignature, bar.resolution);
    bars.push({
      key: `${resolvedId}:${barIndex}`,
      barIndex,
      barNumber: barNumber + barIndex + 1,
      slotCount: count,
      timeSignature: bar.timeSignature,
      resolution: bar.resolution,
      startTicks,
    });
    startTicks += count * ticksPerSlot(bar.resolution);
  }

  const pieces = stepRowsFor(song, trackId);
  const rows = pieces.map((piece): DrumStepRow => {
    const cells: DrumStepCell[] = [];
    for (const bar of bars) {
      const lane = section?.bars[bar.barIndex]?.slots[trackId];
      const perSlot = ticksPerSlot(bar.resolution);
      for (let slotIndex = 0; slotIndex < bar.slotCount; slotIndex += 1) {
        const slot = Array.isArray(lane) ? lane[slotIndex] : undefined;
        const hits = Array.isArray(slot) ? (slot as DrumSlot) : [];
        cells.push({
          ticks: bar.startTicks + slotIndex * perSlot,
          barKey: bar.key,
          barIndex: bar.barIndex,
          slotIndex,
          hit: hits.find((entry) => entry.piece === piece) ?? null,
        });
      }
    }
    return { piece, label: drumPieceName(piece), cells };
  });

  return {
    trackId,
    sectionId: resolvedId,
    rows,
    bars,
    silentThroughout: (section?.bars ?? []).every(
      (bar) => !Object.prototype.hasOwnProperty.call(bar.slots, trackId),
    ),
  };
}

/**
 * Where every bar of the whole song sits on one horizontal axis (2Q-C §2).
 *
 * Until this module existed, "where is bar N" had two answers and neither
 * covered the song. The tab walked `SongPlan.bars` from the left edge every
 * time it was asked (`components/workspace/playhead.ts`), and the Çoklu view
 * built a fresh axis for *one section* of its own. Two
 * answers is how a playhead ends up a slot away from the note it is over; one
 * section is why the surface reset itself every time the music crossed a
 * boundary.
 *
 * This is the single authority, and it is deliberately the *whole song*:
 * continuous playback has to be able to scroll from the last bar of one
 * section into the first bar of the next without anything being rebuilt.
 *
 * ## What decides a bar's width
 *
 * Its slot count, times the slot width. That is the rule the tab has always
 * used and it is a **musical** rule rather than a temporal one:
 *
 * - **Tempo does not appear in it.** Slowing a song down does not stretch its
 *   notation, and a section with a `bpmOverride` is drawn exactly as wide as
 *   the same bars without one. Tempo changes how fast the axis is *travelled*,
 *   which is the follow model's business (§5), not the axis's.
 * - **It is not proportional to tick duration.** Two bars of equal duration
 *   written at 1/8 and at 1/32 would then be the same width and the 1/32
 *   bar's glyphs a quarter of the size — unreadable, on the surface whose
 *   whole purpose is reading. The tick duration is carried beside the width so
 *   nothing has to recompute it.
 *
 * A tick position and an x position are therefore two different facts, and
 * this module is the only place allowed to convert between them.
 *
 * ## What does not change it
 *
 * A missing track key, a track that is silent throughout, a folded lane, and
 * which renderer a lane uses are all invisible here. Meter and resolution
 * belong to the **bar**, so every track written in a bar has the same slot
 * count — which is why every lane's bar lines land on the same x by
 * construction rather than by being kept in step.
 */
import { slotCount, ticksPerSlot, type Resolution } from "@/lib/music/timing";
import type { Song, TimeSignature } from "@/lib/song/schema";

export type SongAxisBar = {
  /** `sectionId:localBarIndex` — the key the whole app already speaks. */
  readonly key: string;
  readonly sectionId: string;
  readonly localBarIndex: number;
  readonly globalBarIndex: number;
  /** Ticks from the start of the **song**. */
  readonly startTicks: number;
  readonly endTicks: number;
  readonly leftPx: number;
  readonly widthPx: number;
  readonly slotCount: number;
  readonly resolution: Resolution;
  readonly timeSignature: TimeSignature;
};

export type SongAxisSection = {
  readonly sectionId: string;
  readonly startTicks: number;
  readonly endTicks: number;
  readonly leftPx: number;
  readonly widthPx: number;
  readonly firstGlobalBarIndex: number;
  readonly barCount: number;
};

export type SongAxis = {
  readonly bars: readonly SongAxisBar[];
  readonly sections: readonly SongAxisSection[];
  readonly totalTicks: number;
  readonly totalWidthPx: number;
  /** The slot width this axis was built with, so a caller cannot assume one. */
  readonly slotWidthPx: number;
};

/**
 * Build the axis. One pass, left to right, prefix sums.
 *
 * The song is read and never written. Building the same song twice produces
 * the same numbers, which is what lets a scroll position survive a re-render.
 */
export function buildSongAxis(song: Song, slotWidthPx: number): SongAxis {
  const bars: SongAxisBar[] = [];
  const sections: SongAxisSection[] = [];

  let leftPx = 0;
  let startTicks = 0;
  let globalBarIndex = 0;

  for (const section of song.sections) {
    const sectionLeftPx = leftPx;
    const sectionStartTicks = startTicks;
    const firstGlobalBarIndex = globalBarIndex;

    for (const [localBarIndex, bar] of section.bars.entries()) {
      const slots = slotCount(bar.timeSignature, bar.resolution);
      const durationTicks = slots * ticksPerSlot(bar.resolution);
      const widthPx = slots * slotWidthPx;
      bars.push({
        key: `${section.id}:${localBarIndex}`,
        sectionId: section.id,
        localBarIndex,
        globalBarIndex,
        startTicks,
        endTicks: startTicks + durationTicks,
        leftPx,
        widthPx,
        slotCount: slots,
        resolution: bar.resolution,
        timeSignature: bar.timeSignature,
      });
      leftPx += widthPx;
      startTicks += durationTicks;
      globalBarIndex += 1;
    }

    sections.push({
      sectionId: section.id,
      startTicks: sectionStartTicks,
      endTicks: startTicks,
      leftPx: sectionLeftPx,
      widthPx: leftPx - sectionLeftPx,
      firstGlobalBarIndex,
      barCount: section.bars.length,
    });
  }

  return {
    bars,
    sections,
    totalTicks: startTicks,
    totalWidthPx: leftPx,
    slotWidthPx,
  };
}

/* ------------------------------------------------------------ lookups */

/** The bar a song tick falls in, or null when the tick is outside the song. */
export function barAtTicks(axis: SongAxis, songTicks: number): SongAxisBar | null {
  if (axis.bars.length === 0) return null;
  if (songTicks < 0) return null;
  /*
   * Binary search rather than a walk. The walk was fine for a playhead asked
   * once a frame on a four-bar song; it is asked once a frame on a thirty-two
   * bar one now, and the follow model asks it again for its target.
   */
  let low = 0;
  let high = axis.bars.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const bar = axis.bars[middle]!;
    if (songTicks < bar.startTicks) high = middle - 1;
    else if (songTicks >= bar.endTicks) low = middle + 1;
    else return bar;
  }
  // Exactly at the end of the last bar is the end of the song, not outside it.
  const last = axis.bars[axis.bars.length - 1]!;
  return songTicks === last.endTicks ? last : null;
}

export function barByKey(axis: SongAxis, key: string): SongAxisBar | null {
  return axis.bars.find((bar) => bar.key === key) ?? null;
}

export function sectionById(axis: SongAxis, sectionId: string): SongAxisSection | null {
  return axis.sections.find((section) => section.sectionId === sectionId) ?? null;
}

/* -------------------------------------------------------- conversions */

/**
 * Where a song tick sits, in axis pixels. Null when it is not in the song.
 *
 * Null rather than a clamped edge, for the reason the section axis already
 * gave: a playhead pinned to the left margin while the music is somewhere
 * else is a drawn claim that is not true.
 */
export function xAtTicks(axis: SongAxis, songTicks: number): number | null {
  const bar = barAtTicks(axis, songTicks);
  if (!bar) return null;
  const duration = bar.endTicks - bar.startTicks;
  if (duration <= 0) return bar.leftPx;
  const through = (songTicks - bar.startTicks) / duration;
  return bar.leftPx + through * bar.widthPx;
}

/** Where a bar starts, in axis pixels. Null when the key names no bar. */
export function xAtBarKey(axis: SongAxis, key: string): number | null {
  return barByKey(axis, key)?.leftPx ?? null;
}

/** Where a section starts, in axis pixels. Null when the id names none. */
export function xAtSection(axis: SongAxis, sectionId: string): number | null {
  return sectionById(axis, sectionId)?.leftPx ?? null;
}

export type AxisPoint = {
  readonly bar: SongAxisBar;
  /** The slot the x falls inside — the cell under the finger, not the nearest. */
  readonly slotIndex: number;
  /** The tick that slot begins on. Representable by definition. */
  readonly slotStartTicks: number;
};

/**
 * What an x position names: a bar, the slot it falls inside, and that slot's
 * own start tick.
 *
 * It does **not** round to the nearest grid line. Which cell an x is inside is
 * a fact; which cell it is *nearest* is an opinion, and one that would move a
 * note half a slot from where the finger was. Callers that want a boundary
 * decision make it from `slotIndex` themselves.
 *
 * The tick returned is the slot's start, so it is always exactly representable
 * on that bar's own grid — never a tick between two slots that no command
 * could accept.
 */
export function pointAtX(axis: SongAxis, x: number): AxisPoint | null {
  if (axis.bars.length === 0 || x < 0 || x > axis.totalWidthPx) return null;
  let low = 0;
  let high = axis.bars.length - 1;
  let found: SongAxisBar | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const bar = axis.bars[middle]!;
    if (x < bar.leftPx) high = middle - 1;
    else if (x >= bar.leftPx + bar.widthPx) low = middle + 1;
    else {
      found = bar;
      break;
    }
  }
  // The very right edge belongs to the last bar's last slot, not to nothing.
  const bar = found ?? (x === axis.totalWidthPx ? axis.bars[axis.bars.length - 1]! : null);
  if (!bar) return null;

  const slotWidth = bar.widthPx / bar.slotCount;
  const raw = slotWidth <= 0 ? 0 : Math.floor((x - bar.leftPx) / slotWidth);
  const slotIndex = Math.max(0, Math.min(bar.slotCount - 1, raw));
  return {
    bar,
    slotIndex,
    slotStartTicks: bar.startTicks + slotIndex * ticksPerSlot(bar.resolution),
  };
}

/**
 * Where one slot of one bar starts, in the axis's own coordinates.
 *
 * The slot width is divided out of the bar rather than taken from a constant.
 * A bar's slots share its width by definition, and a second opinion about the
 * slot width is how a selection band ends up a pixel off the cell it is meant
 * to sit under — the exact failure the multi-track view had before it took its
 * widths from the bar it was drawing.
 */
export function slotLeftPx(bar: SongAxisBar, slotIndex: number): number {
  return bar.leftPx + slotIndex * (bar.widthPx / Math.max(1, bar.slotCount));
}

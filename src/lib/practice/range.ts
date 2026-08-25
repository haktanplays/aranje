/**
 * The bars a reader is practising, and the loop that plays them (2R-A §8, §10).
 *
 * ## What a practice range is, and what it deliberately is not
 *
 * It is a run of **whole bars inside one section**, held for this session
 * only. It is not saved, not exported, not part of the Song, and not
 * something a project file carries: reopening the app is the reader arriving
 * fresh, and a range they set at midnight is not a fact about the music.
 *
 * Whole bars, because a loop that restarts mid-bar has no downbeat to come
 * back to and a count-in has nothing to count. One section, because tempo and
 * meter belong to the section and a range that spanned two would be a loop
 * whose length changed depending on where in it you asked.
 *
 * ## Identity is the bar key, not the index
 *
 * `${sectionId}:${localBarIndex}` — the same key the tab, the arrangement and
 * the transport already use. A range holds keys rather than positions so that
 * inserting a bar earlier in the song moves the range's music with it instead
 * of leaving it pointing at whatever slid into those indices. A key that no
 * longer names a bar makes the range stale, and a stale range is dropped
 * rather than repaired: guessing which bar the reader meant is how a loop
 * silently starts practising something else.
 *
 * ## The end is exclusive
 *
 * `endBarKey` names the last bar **in** the range, and the ticks it resolves
 * to are the first tick *after* that bar. Every other range in this app is
 * half-open — `TimeSelection`, the window, the axis — and a loop that used an
 * inclusive tick would play one tick of the following bar on every pass,
 * which at 1/32 is audible as a click.
 */
import { barTimeline, type BarMarker, type SongPlan } from "@/lib/audio/schedule";
import { songLimits } from "@/lib/limits";
import type { Song } from "@/lib/song/schema";

export type PracticeRange = {
  readonly sectionId: string;
  /** The first bar in the range. */
  readonly startBarKey: string;
  /** The last bar **in** the range, not the one after it. */
  readonly endBarKey: string;
};

/** Where a loop's bounds come from, named so the two can never be confused. */
export type PlaybackLoop =
  | { readonly kind: "none" }
  | { readonly kind: "section"; readonly sectionId: string }
  | { readonly kind: "practice_range"; readonly range: PracticeRange };

export const NO_LOOP: PlaybackLoop = { kind: "none" };

/** The section and local index a bar key names, or null if it names neither. */
export function barKeyParts(
  barKey: string,
): { readonly sectionId: string; readonly localBarIndex: number } | null {
  const cut = barKey.lastIndexOf(":");
  if (cut <= 0) return null;
  const localBarIndex = Number(barKey.slice(cut + 1));
  if (!Number.isInteger(localBarIndex) || localBarIndex < 0) return null;
  return { sectionId: barKey.slice(0, cut), localBarIndex };
}

export const barKeyOf = (sectionId: string, localBarIndex: number): string =>
  `${sectionId}:${localBarIndex}`;

/**
 * Why a pair of bars cannot be a practice range.
 *
 * Returned rather than thrown, and named rather than boolean, because each
 * one has a different thing to say to the reader (§9) and "false" has none.
 */
export type RangeRefusal =
  | "unknown_bar"
  | "different_sections"
  | "too_many_bars";

export type RangeResult =
  | { readonly ok: true; readonly range: PracticeRange }
  | { readonly ok: false; readonly reason: RangeRefusal };

/**
 * A range from two bar keys, in either order.
 *
 * Either order because the reader may drag right-to-left, and asking them to
 * select backwards-is-not-allowed would be the app explaining its own
 * bookkeeping. The keys are sorted here, once.
 */
export function practiceRange(song: Song, a: string, b: string): RangeResult {
  const first = barKeyParts(a);
  const second = barKeyParts(b);
  if (!first || !second) return { ok: false, reason: "unknown_bar" };
  if (first.sectionId !== second.sectionId) {
    return { ok: false, reason: "different_sections" };
  }

  const section = song.sections.find((entry) => entry.id === first.sectionId);
  if (!section) return { ok: false, reason: "unknown_bar" };
  const last = section.bars.length - 1;
  if (
    first.localBarIndex > last ||
    second.localBarIndex > last ||
    last < 0
  ) {
    return { ok: false, reason: "unknown_bar" };
  }

  const from = Math.min(first.localBarIndex, second.localBarIndex);
  const to = Math.max(first.localBarIndex, second.localBarIndex);
  /*
   * A section cannot hold more bars than the contract allows, so this can
   * only fire on a song that got past the schema — but the range is what the
   * transport loops over, and a bound checked here is one the loop cannot
   * outrun.
   */
  if (to - from + 1 > songLimits.barsPerSection) {
    return { ok: false, reason: "too_many_bars" };
  }

  return {
    ok: true,
    range: {
      sectionId: first.sectionId,
      startBarKey: barKeyOf(first.sectionId, from),
      endBarKey: barKeyOf(first.sectionId, to),
    },
  };
}

/** One bar, practised on its own. The commonest range there is (§9.2). */
export function singleBarRange(song: Song, barKey: string): RangeResult {
  return practiceRange(song, barKey, barKey);
}

/** Every bar key the range covers, in playing order. */
export function rangeBarKeys(range: PracticeRange): readonly string[] {
  const from = barKeyParts(range.startBarKey);
  const to = barKeyParts(range.endBarKey);
  if (!from || !to) return [];
  const keys: string[] = [];
  for (let index = from.localBarIndex; index <= to.localBarIndex; index += 1) {
    keys.push(barKeyOf(range.sectionId, index));
  }
  return keys;
}

export const rangeBarCount = (range: PracticeRange): number =>
  rangeBarKeys(range).length;

/**
 * Whether the song still holds every bar this range names.
 *
 * The one question a session-only range has to keep asking: bars can be
 * inserted, removed and re-gridded while it is held, and a range that outlived
 * its music must stop looping rather than loop something else.
 */
export function rangeIsLive(song: Song, range: PracticeRange): boolean {
  const section = song.sections.find((entry) => entry.id === range.sectionId);
  if (!section) return false;
  const from = barKeyParts(range.startBarKey);
  const to = barKeyParts(range.endBarKey);
  if (!from || !to) return false;
  return (
    from.localBarIndex <= to.localBarIndex &&
    to.localBarIndex < section.bars.length
  );
}

export type LoopBounds = {
  /** Inclusive: the first tick that plays. */
  readonly startTicks: number;
  /** Exclusive: the first tick that does not. */
  readonly endTicks: number;
};

const markerFor = (plan: SongPlan, barKey: string): BarMarker | undefined =>
  plan.bars.find((bar) => bar.barKey === barKey);

/**
 * Where a practice range starts and stops, on the transport's own timeline.
 *
 * Null when any of its bars is gone, which is the same answer as "do not
 * loop" — the caller must not fall back to the section, because a loop the
 * reader did not ask for is worse than no loop at all.
 */
export function rangeLoopBounds(
  plan: SongPlan,
  range: PracticeRange,
): LoopBounds | null {
  const first = markerFor(plan, range.startBarKey);
  const last = markerFor(plan, range.endBarKey);
  if (!first || !last) return null;
  const endTicks = last.time + last.durationTicks;
  if (endTicks <= first.time) return null;
  return { startTicks: first.time, endTicks };
}

/** The same, for a whole section: every bar it has, first tick to last. */
export function sectionBounds(plan: SongPlan, sectionId: string): LoopBounds | null {
  const bars = plan.bars.filter((bar) => bar.sectionId === sectionId);
  const first = bars[0];
  const last = bars[bars.length - 1];
  if (!first || !last) return null;
  return { startTicks: first.time, endTicks: last.time + last.durationTicks };
}

/**
 * The one place a `PlaybackLoop` becomes ticks.
 *
 * Two kinds of loop, one conversion. Before this existed the transport knew
 * only "loop this section", and adding a second kind by widening that string
 * would have meant every reader of it guessing which kind it held.
 */
export function loopBounds(plan: SongPlan, loop: PlaybackLoop): LoopBounds | null {
  if (loop.kind === "none") return null;
  if (loop.kind === "section") return sectionBounds(plan, loop.sectionId);
  return rangeLoopBounds(plan, loop.range);
}

/** A plan straight from a song, for callers that hold no transport. */
export const planOf = (song: Song): SongPlan => ({
  events: [],
  bars: barTimeline(song),
  totalTicks: barTimeline(song).reduce(
    (total, bar) => Math.max(total, bar.time + bar.durationTicks),
    0,
  ),
});

/**
 * The three ways in, and the one range they all produce (2R-A §V).
 *
 * A reader reaches a practice loop from three places: they say "this bar",
 * they pick two bars, or they already have a time selection that happens to
 * sit on bar lines. Those are three gestures and one answer — and the answer
 * has to be *the same object*, not three shapes that agree today.
 *
 * So the entries live here, together, as pure functions over the Song. None
 * of them touches the transport, the store, history or storage; none of them
 * changes the Song. Each returns either a `PracticeRange` or a named refusal
 * the reader can be told about in their own words.
 *
 * ## Why a time selection is not simply rounded
 *
 * A practice loop is whole bars, and a selection that starts halfway through
 * one is not a loop with a rough edge — it is a different piece of music. The
 * app could snap it to the nearest bar line and would then be looping bars
 * the reader did not choose, silently, on every pass. So it refuses, by name,
 * and the reader decides.
 *
 * That refusal is not a validation error either. Nothing is wrong: they made
 * a perfectly good selection for the thing selections are for. It is just not
 * a practice range, and the message says so.
 */
import { sectionBarStartTicks } from "@/lib/song/onset-block";
import { slotCount, ticksPerSlot } from "@/lib/music/timing";
import type { BarSelection } from "@/lib/song/bar-selection";
import type { TimeSelection } from "@/lib/song/time-selection";
import type { Song } from "@/lib/song/schema";
import {
  barKeyOf,
  practiceRange,
  singleBarRange,
  type PracticeRange,
  type RangeRefusal,
} from "@/lib/practice/range";

/**
 * Why a gesture did not become a practice range.
 *
 * The three from `range.ts` plus the one only a time selection can hit.
 */
export type EntryRefusal = RangeRefusal | "requires_full_bars";

export type EntryResult =
  | { readonly ok: true; readonly range: PracticeRange }
  | { readonly ok: false; readonly reason: EntryRefusal };

/** Which door a range came through, for the sheet to say so. */
export type RangeSource = "single_bar" | "bar_pair" | "time_selection";

/* ------------------------------------------------------------ 1. one bar */

export function rangeFromBar(song: Song, barKey: string): EntryResult {
  return singleBarRange(song, barKey);
}

/* ----------------------------------------------------------- 2. two bars */

/**
 * A range from the two bars the reader tapped, in either order.
 *
 * Order is normalised by **bar index only**. Nothing here rounds a tick,
 * nudges an edge or picks a nearer bar: the two bars named are the two bars
 * used, and everything between them is included.
 */
export function rangeFromBarPair(song: Song, a: string, b: string): EntryResult {
  return practiceRange(song, a, b);
}

/**
 * The same, from the bar selection the arrangement already holds.
 *
 * Reuses that model rather than adding a second one. A `track`-scoped
 * selection is still a range of *time* — the loop plays every track — so the
 * scope is deliberately ignored here, and the doc says so rather than leaving
 * a reader of this code to wonder whether it was forgotten.
 */
export function rangeFromBarSelection(
  song: Song,
  selection: BarSelection,
): EntryResult {
  return practiceRange(
    song,
    barKeyOf(selection.sectionId, selection.startBarIndex),
    barKeyOf(selection.sectionId, selection.endBarIndex),
  );
}

/* ------------------------------------------------------ 3. a time selection */

/**
 * Every bar boundary of a section, in ticks from its start.
 *
 * The last entry is the section's own end, so a selection that runs to the
 * final bar line has something to match. Bars no longer share a grid, so this
 * is summed rather than multiplied.
 */
function boundariesOf(song: Song, sectionId: string): number[] | null {
  const section = song.sections.find((entry) => entry.id === sectionId);
  if (!section) return null;
  const starts = sectionBarStartTicks(section);
  const last = section.bars[section.bars.length - 1];
  if (!last) return null;
  const end =
    (starts[starts.length - 1] ?? 0) +
    slotCount(last.timeSignature, last.resolution) * ticksPerSlot(last.resolution);
  return [...starts, end];
}

/**
 * A practice range from a time selection, or a refusal.
 *
 * Both edges must land **exactly** on a bar line. Not within a slot, not
 * within a tick: exactly. A selection is made on a grid and a bar line is on
 * that grid, so a reader who selected whole bars has already produced exact
 * numbers — and one who did not meant something else.
 */
export function rangeFromTimeSelection(
  song: Song,
  selection: TimeSelection,
): EntryResult {
  const boundaries = boundariesOf(song, selection.sectionId);
  if (!boundaries) return { ok: false, reason: "unknown_bar" };
  if (selection.endTicks <= selection.startTicks) {
    return { ok: false, reason: "requires_full_bars" };
  }

  const startIndex = boundaries.indexOf(selection.startTicks);
  const endIndex = boundaries.indexOf(selection.endTicks);
  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return { ok: false, reason: "requires_full_bars" };
  }
  // The last boundary is the section's end, not a bar anyone can start on.
  if (startIndex === boundaries.length - 1) {
    return { ok: false, reason: "requires_full_bars" };
  }

  return practiceRange(
    song,
    barKeyOf(selection.sectionId, startIndex),
    // Exclusive end: the selection stops *at* the line after its last bar.
    barKeyOf(selection.sectionId, endIndex - 1),
  );
}

/**
 * Whether a time selection is offerable as a practice range at all.
 *
 * For a UI deciding whether to show the action. Cheap, and exactly the same
 * rule the conversion uses — a second, looser predicate is how an action
 * comes to be offered and then refuse.
 */
export function offersPracticeRange(song: Song, selection: TimeSelection): boolean {
  return rangeFromTimeSelection(song, selection).ok;
}

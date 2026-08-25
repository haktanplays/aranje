/**
 * What a practice loop's edges cut through (2R-A §10).
 *
 * A practice range does not change the Song — it only decides where playback
 * starts and where it goes back to. That makes it *sound* harmless, and it is
 * exactly why this reading exists: a loop whose edges land inside a held note
 * or a legato bond does not fail, it just quietly plays something the music
 * does not say, over and over, while the reader practises against it.
 *
 * Three of the five answers are about a real musical relationship:
 *
 * - **The start continues a tie.** The range's first bar opens on a `"-"`,
 *   so the strike that made that sound is *before* the range. On every pass
 *   the reader hears a note begin out of nowhere, mid-sustain.
 * - **The end cuts a sustain.** A note struck inside the range is still
 *   sounding at the end tick. Every pass chops it.
 * - **A legato bond crosses an edge.** A slide, hammer-on or pull-off only
 *   sounds because the note before it is still there, and the note before it
 *   is on the other side of the loop.
 *
 * The fourth, `crosses_section`, is when the chain continues past the end of
 * the section. A practice range lives in one section by construction, so
 * there is nowhere to widen to and the honest answer is to say so.
 *
 * ## The one thing this module refuses to do
 *
 * It never widens the range. It computes the range that *would* cover the
 * chain and hands it back as an offer — `Bağlantıyı da dahil et` — for the
 * reader to accept. 2N-A removed silent widening from the edit path for the
 * reason it is banned here too: a range that grows itself is a range the
 * reader no longer knows the extent of, and on a loop they would hear the
 * difference before they understood it.
 *
 * Whole bars either way. Widening to cover a chain moves the edge to the bar
 * boundary that contains it, never to a tick inside a bar, because everything
 * downstream — the count-in, the downbeat, the section's meter — is built on
 * bars.
 */
import { sectionBarStartTicks, sectionSlotStream } from "@/lib/song/onset-block";
import { CHAINING_ARTICULATIONS } from "@/lib/song/articulation-roles";
import { isDrumSlotArray, type Section, type Song } from "@/lib/song/schema";
import {
  barKeyOf,
  barKeyParts,
  practiceRange,
  type PracticeRange,
} from "@/lib/practice/range";

export type RangeEdgeKind =
  | "safe"
  | "start_continues_tie"
  | "end_cuts_sustain"
  | "legato_boundary"
  | "crosses_section";

/** One thing found at one edge, on one track. */
export type RangeEdgeFinding = {
  readonly kind: Exclude<RangeEdgeKind, "safe">;
  readonly trackId: string;
  /** Which edge it was found at. */
  readonly edge: "start" | "end";
  /** The bar the chain reaches into, or null when it leaves the section. */
  readonly reachesBarKey: string | null;
};

/**
 * What the reader is actually being asked, reduced to the three answers
 * there are (2R-A §VI).
 *
 * The findings above say what was *found* — a tie here, a bond there — and
 * that is what the message is built from. This is what can be *done*, and
 * there are only three things: nothing, take the connection too, or the range
 * cannot exist. Several boundaries of several kinds still make one decision;
 * a reader asked twice about one loop has been asked about bookkeeping.
 */
export type RangeDecision =
  | { readonly kind: "no_chain_impact" }
  | {
      readonly kind: "include_connection";
      /** The range that would contain every chain. Offered, never applied. */
      readonly widened: PracticeRange;
    }
  | { readonly kind: "blocked"; readonly reason: "crosses_section" };

export type RangePreflight = {
  /**
   * The single worst thing found, for a reader who wants one sentence.
   *
   * "Worst" is ordered by what cannot be repaired: leaving the section beats
   * a broken bond, which beats a cut sustain, which beats a truncated start.
   */
  readonly kind: RangeEdgeKind;
  readonly findings: readonly RangeEdgeFinding[];
  /**
   * The range that would contain every chain, or null when there is nothing
   * to offer — either because the range is already safe, or because a chain
   * leaves the section and no range in this section can cover it.
   *
   * An offer, never an action.
   */
  readonly widened: PracticeRange | null;
};

const SAFE: RangePreflight = { kind: "safe", findings: [], widened: null };

/**
 * The decision, from the reading.
 *
 * Fail-closed at the section seam: a chain that continues into the next
 * section cannot be contained by any range in this one, and offering a range
 * that "mostly" contains it would be the silent widening this module refuses.
 * So there is no range, and the reader is told why.
 *
 * A chain that *could* be contained but has not been is not blocked — the
 * reader may perfectly well mean to loop into the middle of a held note. It
 * is an offer, and the range they set stands until they take it.
 */
export function rangeDecision(preflight: RangePreflight): RangeDecision {
  if (preflight.kind === "crosses_section") {
    return { kind: "blocked", reason: "crosses_section" };
  }
  if (preflight.widened !== null) {
    return { kind: "include_connection", widened: preflight.widened };
  }
  return { kind: "no_chain_impact" };
}

/** Worst first: the order the summary picks from. */
const SEVERITY: readonly RangeEdgeKind[] = [
  "crosses_section",
  "legato_boundary",
  "end_cuts_sustain",
  "start_continues_tie",
  "safe",
];

/** Every track written anywhere in this section, in the song's own order. */
function tracksIn(song: Song, section: Section): readonly string[] {
  const ids: string[] = [];
  for (const track of song.tracks) {
    const written = section.bars.some((bar) => {
      const slots = bar.slots[track.id];
      return slots !== undefined && !isDrumSlotArray(slots);
    });
    if (written) ids.push(track.id);
  }
  return ids;
}

/**
 * Read both edges of one track's music against the range.
 *
 * The stream is the section's slots in playing order with real tick
 * positions, so a bar at 1/32 and a bar at 1/8 are compared on the same
 * timeline rather than by slot index — which is the bug that made mixed-grid
 * ranges wrong before K-34.
 */
function findingsFor(
  section: Section,
  trackId: string,
  startBarIndex: number,
  endBarIndex: number,
): RangeEdgeFinding[] {
  const stream = sectionSlotStream(section, trackId);
  const found: RangeEdgeFinding[] = [];
  const inRange = (barIndex: number) =>
    barIndex >= startBarIndex && barIndex <= endBarIndex;

  /* ---- the start: does the range open in the middle of a held note? */
  const firstInside = stream.find(
    (position) => position.barIndex === startBarIndex && position.writable,
  );
  if (firstInside?.slot === "-") {
    /*
     * Walk back to the strike. It is what says whether the note began in
     * this section at all: a `"-"` run that reaches slot zero of the section
     * is the tail of something the previous section struck, and no range
     * here can include it.
     */
    let index = stream.indexOf(firstInside) - 1;
    while (index >= 0 && stream[index]!.slot === "-") index -= 1;
    const strike = index >= 0 ? stream[index] : undefined;
    found.push({
      kind: strike ? "start_continues_tie" : "crosses_section",
      trackId,
      edge: "start",
      reachesBarKey: strike ? barKeyOf(section.id, strike.barIndex) : null,
    });
  }

  /* ---- the end: does a note struck inside carry on past the last bar? */
  const afterEnd = stream.filter(
    (position) => position.barIndex > endBarIndex && position.writable,
  );
  const firstAfter = afterEnd[0];
  if (firstAfter?.slot === "-") {
    // The tie run after the edge belongs to a strike inside the range: the
    // slot before the edge is either that strike or more of its tail.
    let index = stream.indexOf(firstAfter);
    while (index < stream.length && stream[index]!.slot === "-") index += 1;
    const resumes = index < stream.length ? stream[index] : undefined;
    found.push({
      kind: "end_cuts_sustain",
      trackId,
      edge: "end",
      // The bar the sustain reaches into: where the range would have to
      // stretch to for the note to finish sounding.
      reachesBarKey: barKeyOf(
        section.id,
        resumes ? Math.max(firstAfter.barIndex, resumes.barIndex - 1) : firstAfter.barIndex,
      ),
    });
  }

  /* ---- legato bonds reaching across either edge. */
  for (let index = 0; index < stream.length; index += 1) {
    const position = stream[index]!;
    const slot = position.slot;
    if (!position.writable || slot === null || slot === undefined || slot === "-") {
      continue;
    }
    const bonded = slot.notes.some(
      (note) =>
        note.articulation !== undefined &&
        CHAINING_ARTICULATIONS.has(note.articulation),
    );
    if (!bonded) continue;

    /*
     * A bond binds this onset to the one *before* it, so it crosses an edge
     * when exactly one of the two is inside the range. The previous onset is
     * the nearest earlier written slot that is not a tie.
     */
    let back = index - 1;
    while (
      back >= 0 &&
      (stream[back]!.slot === "-" ||
        stream[back]!.slot === null ||
        stream[back]!.slot === undefined ||
        !stream[back]!.writable)
    ) {
      back -= 1;
    }
    const previous = back >= 0 ? stream[back] : undefined;
    if (!previous) {
      // Nothing before it in this section: the bond reaches into music this
      // range cannot include.
      if (inRange(position.barIndex)) {
        found.push({
          kind: "crosses_section",
          trackId,
          edge: "start",
          reachesBarKey: null,
        });
      }
      continue;
    }
    const here = inRange(position.barIndex);
    const there = inRange(previous.barIndex);
    if (here === there) continue;
    found.push({
      kind: "legato_boundary",
      trackId,
      edge: here ? "start" : "end",
      reachesBarKey: barKeyOf(
        section.id,
        here ? previous.barIndex : position.barIndex,
      ),
    });
  }

  return found;
}

/**
 * The reading, taken before anything loops.
 *
 * Pure: it holds no state, plays nothing and changes nothing. Given the same
 * song and the same range it gives the same answer, which is what lets the
 * sheet show it and the transport act on it without the two disagreeing.
 */
export function rangePreflight(song: Song, range: PracticeRange): RangePreflight {
  const section = song.sections.find((entry) => entry.id === range.sectionId);
  if (!section) return SAFE;
  const from = barKeyParts(range.startBarKey);
  const to = barKeyParts(range.endBarKey);
  if (!from || !to) return SAFE;
  // Bar starts are read so the stream and the range are known to be on the
  // same section timeline; an empty section has no edges to cut.
  if (sectionBarStartTicks(section).length === 0) return SAFE;

  const findings: RangeEdgeFinding[] = [];
  for (const trackId of tracksIn(song, section)) {
    findings.push(
      ...findingsFor(section, trackId, from.localBarIndex, to.localBarIndex),
    );
  }
  if (findings.length === 0) return SAFE;

  const kind =
    SEVERITY.find((entry) => findings.some((finding) => finding.kind === entry)) ??
    "safe";

  return { kind, findings, widened: widenedFor(song, range, findings) };
}

/**
 * The range that would contain every chain — computed, never applied.
 *
 * Null when a chain leaves the section, because no range in this section can
 * cover it and offering one that "mostly" does would be the silent widening
 * this module exists to refuse.
 */
function widenedFor(
  song: Song,
  range: PracticeRange,
  findings: readonly RangeEdgeFinding[],
): PracticeRange | null {
  if (findings.some((finding) => finding.kind === "crosses_section")) return null;

  const from = barKeyParts(range.startBarKey);
  const to = barKeyParts(range.endBarKey);
  if (!from || !to) return null;

  let start = from.localBarIndex;
  let end = to.localBarIndex;
  for (const finding of findings) {
    const reach = finding.reachesBarKey ? barKeyParts(finding.reachesBarKey) : null;
    if (!reach) continue;
    start = Math.min(start, reach.localBarIndex);
    end = Math.max(end, reach.localBarIndex);
  }
  if (start === from.localBarIndex && end === to.localBarIndex) return null;

  const widened = practiceRange(
    song,
    barKeyOf(range.sectionId, start),
    barKeyOf(range.sectionId, end),
  );
  return widened.ok ? widened.range : null;
}

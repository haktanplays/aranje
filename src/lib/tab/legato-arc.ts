/**
 * The arcs that say a note was not picked (2S-A §4).
 *
 * A hammer-on and a pull-off are the two things a reader who cannot read
 * notation still has to see at a glance, because they are the difference
 * between eight picked notes and two picked notes with six fingers. Tab says
 * it with a slur above the string and an `H` or a `P` on it, and that is what
 * is modelled here.
 *
 * Everything about the shape is geometry, so it is decided here rather than in
 * a component:
 *
 * - the arc is **above** the string it belongs to, in the gap over that row,
 *   so it never crosses a string line and never sits on a fret number;
 * - two arcs in a row **alternate their height**, so a run like `5h7h8p7`
 *   reads as three separate gestures rather than as one long capsule;
 * - the arc stops short of both fret numbers, so the number stays the thing
 *   the eye lands on;
 * - bend, slide and tie marks are drawn elsewhere (to the right of the digit,
 *   and on the string line itself), so nothing here can merge with them.
 *
 * The layer that draws these takes no pointer events. An arc is a statement
 * about two notes, not a control, and a finger that lands on one must reach
 * the cell underneath.
 */
import { pitchToMidi } from "@/lib/music/pitch";
import type { FrettedBar, TabSpan } from "@/lib/tab/timeline";

import { legatoLabel } from "@/lib/tab/glyph-model";

export type LegatoArcKind = "hammer_on" | "pull_off";

export type LegatoArc = {
  readonly kind: LegatoArcKind;
  /** `H` for a hammer-on, `P` for a pull-off. Never the identifier. */
  readonly mark: "H" | "P";
  readonly stringIndex: number;
  readonly fromSlot: number;
  readonly toSlot: number;
  readonly fromFret: number | null;
  readonly toFret: number | null;
  /** An SVG quadratic, in the bar's own pixel space. */
  readonly path: string;
  /** Where the `H` or `P` sits, at the top of the arc. */
  readonly markX: number;
  readonly markY: number;
  /** The two ends, drawn when the pair is selected or a decision is pending. */
  readonly endpoints: readonly { readonly x: number; readonly y: number }[];
  /** How high this arc rises; consecutive arcs differ so they stay readable. */
  readonly rise: number;
  readonly label: string;
};

export type ArcLayout = {
  readonly slotWidth: number;
  readonly stringRowHeight: number;
  /** Top of the staff for this bar, so the arc knows which row it is over. */
  readonly rowTop: (stringIndex: number) => number;
  /** How far the arc rises above the string, at its lowest. */
  readonly baseRise?: number;
  /** Extra rise the alternating arc takes. */
  readonly stepRise?: number;
  /** How far the arc keeps clear of a fret number, horizontally. */
  readonly clearance?: number;
};

const DEFAULT_BASE_RISE = 9;
const DEFAULT_STEP_RISE = 5;
const DEFAULT_CLEARANCE = 6;

/** The onset before this one on the same string, inside this bar. */
function previousOnSameString(
  bar: FrettedBar,
  span: TabSpan,
): TabSpan | undefined {
  let found: TabSpan | undefined;
  for (const other of bar.spans) {
    if (other.stringIndex !== span.stringIndex) continue;
    if (other.startSlot >= span.startSlot) continue;
    if (other.openStart) continue;
    found = other;
  }
  return found;
}

/**
 * Whether the pair moves the way the articulation says it does.
 *
 * From the **sounding pitch**, not the fret number: on a fretboard the two can
 * point opposite ways, and an arc that disagrees with what is heard is worse
 * than no arc. A pair that does not move the right way gets no arc at all —
 * the validator is what tells the reader why (spec 10.3).
 */
function movesAsWritten(
  previous: TabSpan,
  span: TabSpan,
  kind: LegatoArcKind,
): boolean {
  const from = pitchToMidi(previous.pitch);
  const to = pitchToMidi(span.pitch);
  if (from === null || to === null) return false;
  return kind === "hammer_on" ? to > from : to < from;
}

/**
 * Every hammer-on and pull-off arc of one bar, in reading order.
 *
 * Only pairs that are both in this bar: an arc may not cross a bar line, for
 * the same reason a beam may not — the bar is what the reader's eye groups by,
 * and a line drawn over the boundary claims a grouping that is not there.
 */
export function buildLegatoArcs(
  bar: FrettedBar,
  layout: ArcLayout,
): LegatoArc[] {
  if (bar.silent) return [];

  const baseRise = layout.baseRise ?? DEFAULT_BASE_RISE;
  const stepRise = layout.stepRise ?? DEFAULT_STEP_RISE;
  const clearance = layout.clearance ?? DEFAULT_CLEARANCE;
  const half = layout.slotWidth / 2;

  const arcs: LegatoArc[] = [];
  const ordered = [...bar.spans].sort((a, b) => a.startSlot - b.startSlot);

  /** How many arcs already end where this one starts, per string. */
  const chain = new Map<number, number>();

  for (const span of ordered) {
    const kind = span.articulation;
    if (kind !== "hammer_on" && kind !== "pull_off") continue;
    if (span.openStart) continue;

    const previous = previousOnSameString(bar, span);
    if (!previous) {
      chain.set(span.stringIndex, 0);
      continue;
    }
    if (!movesAsWritten(previous, span, kind)) {
      chain.set(span.stringIndex, 0);
      continue;
    }

    const depth = chain.get(span.stringIndex) ?? 0;
    // Consecutive arcs alternate, so a run reads as separate gestures.
    const rise = baseRise + (depth % 2) * stepRise;

    const top = layout.rowTop(span.stringIndex);
    const y = top + layout.stringRowHeight / 2;
    const fromX = previous.startSlot * layout.slotWidth + half + clearance;
    const toX = span.startSlot * layout.slotWidth + half - clearance;
    const midX = (fromX + toX) / 2;
    const peakY = y - rise;
    // A quadratic whose control point is twice the rise, so the curve itself
    // peaks at `rise` rather than at half of it.
    const controlY = y - rise * 2;

    arcs.push({
      kind,
      mark: kind === "hammer_on" ? "H" : "P",
      stringIndex: span.stringIndex,
      fromSlot: previous.startSlot,
      toSlot: span.startSlot,
      fromFret: previous.fret,
      toFret: span.fret,
      path: `M ${round(fromX)} ${round(y - 1)} Q ${round(midX)} ${round(controlY)} ${round(toX)} ${round(y - 1)}`,
      markX: midX,
      markY: peakY,
      endpoints: [
        { x: round(fromX), y: round(y - 1) },
        { x: round(toX), y: round(y - 1) },
      ],
      rise,
      label: legatoLabel(previous.fret, span.fret, kind),
    });

    chain.set(span.stringIndex, depth + 1);
  }

  return arcs;
}

const round = (value: number): number => Math.round(value * 100) / 100;

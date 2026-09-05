/**
 * A span is a rectangle, and every edit is arithmetic on it (2V-D.1-C §3).
 *
 * ## Why this is one module and not five
 *
 * Copy, move, repeat, delete and transpose all ask the same two questions of
 * a technique span: which part of it does this selection touch, and where
 * does that part end up. Written separately they would be five nearly-equal
 * answers, and the first divergence would be a span that copy kept and move
 * lost — a difference nobody sees until they play it.
 *
 * So the selection is a rectangle with a time axis and a string axis, the
 * span is another, and the operations are set arithmetic on the pair. The
 * commands above this file decide *what* to do; this decides what the result
 * is, and it never touches a Song.
 *
 * ## What "orphan" means, and what it does not
 *
 * A span with no notes under it is **not** an orphan. A guitarist marks the
 * hand position over a phrase, and a rest inside that phrase is still inside
 * it — deleting the technique because a bar happens to be empty would be the
 * editor overruling the reader. A real orphan names a track or section that
 * does not exist, a range with no time in it, or a string the instrument does
 * not have, and `validate` is where those are caught.
 *
 * ## Identity
 *
 * A span cut in two keeps its identity in one piece and gives the other a
 * derived one, so undo can put them back and a reader's second edit still
 * finds the span they were working on. A pasted or repeated copy is a *new*
 * span and gets a new identity. None of it is random: ids are derived from
 * the span and the operation, so redoing a command produces the same bytes it
 * produced the first time.
 */
import type { TechniqueSpan } from "@/lib/song/schema";

/** A time range and a set of strings. Half-open in time, like everything. */
export type SpanRect = {
  readonly startTicks: number;
  readonly endTicks: number;
  readonly stringIndices: readonly number[];
};

export type SpanFault =
  /** No time in it. */
  | "empty_range"
  /** No strings, a repeat, or a string the instrument does not have. */
  | "bad_strings"
  /** A track or section that is not there. */
  | "no_such_owner"
  /** Reaches past the section it is written in. */
  | "crosses_section";

const sortStrings = (indices: readonly number[]): number[] =>
  [...new Set(indices)].sort((a, b) => a - b);

/** Two rectangles meet where both axes do. Null when they do not meet. */
export function intersect(a: SpanRect, b: SpanRect): SpanRect | null {
  const startTicks = Math.max(a.startTicks, b.startTicks);
  const endTicks = Math.min(a.endTicks, b.endTicks);
  if (endTicks <= startTicks) return null;
  const wanted = new Set(b.stringIndices);
  const stringIndices = a.stringIndices.filter((index) => wanted.has(index));
  if (stringIndices.length === 0) return null;
  return { startTicks, endTicks, stringIndices: sortStrings(stringIndices) };
}

/**
 * What is left of `a` once `b` is taken out of it.
 *
 * Up to three pieces, and the shape of them is the whole point: the strings
 * `b` does not name keep the *whole* time range, and the strings it does keep
 * only the time on either side. A subtraction that returned one rectangle
 * would have to choose which of those to lose.
 */
export function subtract(a: SpanRect, b: SpanRect): readonly SpanRect[] {
  const meeting = intersect(a, b);
  if (!meeting) return [a];

  const pieces: SpanRect[] = [];
  const cut = new Set(meeting.stringIndices);
  const untouched = a.stringIndices.filter((index) => !cut.has(index));
  if (untouched.length > 0) {
    pieces.push({
      startTicks: a.startTicks,
      endTicks: a.endTicks,
      stringIndices: sortStrings(untouched),
    });
  }
  if (meeting.startTicks > a.startTicks) {
    pieces.push({
      startTicks: a.startTicks,
      endTicks: meeting.startTicks,
      stringIndices: meeting.stringIndices,
    });
  }
  if (meeting.endTicks < a.endTicks) {
    pieces.push({
      startTicks: meeting.endTicks,
      endTicks: a.endTicks,
      stringIndices: meeting.stringIndices,
    });
  }
  return pieces;
}

/** Slide a rectangle along the time axis. */
export function translate(rect: SpanRect, byTicks: number): SpanRect {
  return {
    startTicks: rect.startTicks + byTicks,
    endTicks: rect.endTicks + byTicks,
    stringIndices: rect.stringIndices,
  };
}

/**
 * Move a rectangle onto different strings.
 *
 * `null` from the mapping means that string has nowhere to go, and the result
 * is null rather than a rectangle quietly missing one — a technique that
 * silently stopped covering a string is the failure this whole module is
 * arranged to prevent.
 */
export function remapStrings(
  rect: SpanRect,
  to: (stringIndex: number) => number | null,
): SpanRect | null {
  const moved: number[] = [];
  for (const index of rect.stringIndices) {
    const next = to(index);
    if (next === null) return null;
    moved.push(next);
  }
  const unique = sortStrings(moved);
  /* Two strings landing on one is a real collapse, not a rounding: the span
     would cover fewer strings than the reader wrote. */
  if (unique.length !== rect.stringIndices.length) return null;
  return { ...rect, stringIndices: unique };
}

/** Trim a rectangle to a section's own length. Null when it falls outside. */
export function clipToSection(rect: SpanRect, sectionTicks: number): SpanRect | null {
  return intersect(rect, {
    startTicks: 0,
    endTicks: sectionTicks,
    stringIndices: rect.stringIndices,
  });
}

/** One section a split lands in: which one, and where inside it. */
export type SectionPlacement = {
  readonly sectionId: string;
  /** Ticks from the start of the song. */
  readonly startTicks: number;
  readonly lengthTicks: number;
};

/**
 * Cut a song-relative rectangle into section-local pieces.
 *
 * A span may not cross a section, so a range that does becomes several — one
 * per section it touches, each addressed from that section's own start. The
 * alternative is refusing the whole edit because the reader's selection
 * happened to span a section line, which is not something they did wrong.
 */
export function splitAcrossSections(
  rect: SpanRect,
  sections: readonly SectionPlacement[],
): readonly { readonly sectionId: string; readonly rect: SpanRect }[] {
  const pieces: { sectionId: string; rect: SpanRect }[] = [];
  for (const section of sections) {
    const overlap = intersect(rect, {
      startTicks: section.startTicks,
      endTicks: section.startTicks + section.lengthTicks,
      stringIndices: rect.stringIndices,
    });
    if (!overlap) continue;
    pieces.push({
      sectionId: section.sectionId,
      rect: translate(overlap, -section.startTicks),
    });
  }
  return pieces;
}

/**
 * The canonical form of a set of rectangles.
 *
 * Sorted and de-duplicated so two runs of the same command produce the same
 * bytes. Deliberately **not** merging neighbours: two spans a reader wrote
 * are two spans, and one of them may be the one they want to move next.
 */
export function normalize(rects: readonly SpanRect[]): readonly SpanRect[] {
  const seen = new Set<string>();
  const kept: SpanRect[] = [];
  for (const rect of rects) {
    if (rect.endTicks <= rect.startTicks) continue;
    const strings = sortStrings(rect.stringIndices);
    if (strings.length === 0) continue;
    const key = `${rect.startTicks}-${rect.endTicks}:${strings.join("/")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ ...rect, stringIndices: strings });
  }
  return kept.sort(
    (a, b) =>
      a.startTicks - b.startTicks ||
      a.endTicks - b.endTicks ||
      (a.stringIndices[0] ?? 0) - (b.stringIndices[0] ?? 0),
  );
}

/** What is wrong with this span, or null. See the header on orphans. */
export function validate(
  span: TechniqueSpan,
  owner: {
    /** The section it claims, and how long that section is. */
    readonly sectionTicks: number | null;
    /** How many strings its track has, or null when the track is missing. */
    readonly stringCount: number | null;
  },
): SpanFault | null {
  if (owner.sectionTicks === null || owner.stringCount === null) {
    return "no_such_owner";
  }
  if (span.endTicks <= span.startTicks) return "empty_range";
  if (span.stringIndices.length === 0) return "bad_strings";
  if (new Set(span.stringIndices).size !== span.stringIndices.length) {
    return "bad_strings";
  }
  if (span.stringIndices.some((index) => index < 0 || index >= owner.stringCount!)) {
    return "bad_strings";
  }
  if (span.startTicks < 0 || span.endTicks > owner.sectionTicks) {
    return "crosses_section";
  }
  return null;
}

/**
 * The identity a fragment of `span` gets.
 *
 * Derived, never random: the same command run twice produces the same id, so
 * a redo is byte-exact and an undo has something stable to put back. The
 * first piece keeps the span's own id so a reader's next edit still finds the
 * span they were working on.
 */
export function fragmentId(span: TechniqueSpan, index: number): string {
  return index === 0 ? span.id : `${span.id}~${index}`;
}

/** The identity a copy gets. New, because a copy is a different span. */
export function copyId(span: TechniqueSpan, seed: string, index: number): string {
  return `${span.id}+${seed}${index === 0 ? "" : `~${index}`}`;
}

/** Put a rectangle back on a span, keeping everything else it said. */
export function withRect(
  span: TechniqueSpan,
  rect: SpanRect,
  id: string,
): TechniqueSpan {
  return {
    ...span,
    id,
    startTicks: rect.startTicks,
    endTicks: rect.endTicks,
    stringIndices: [...rect.stringIndices],
  };
}

/** The rectangle a span occupies. */
export function rectOf(span: TechniqueSpan): SpanRect {
  return {
    startTicks: span.startTicks,
    endTicks: span.endTicks,
    stringIndices: span.stringIndices,
  };
}

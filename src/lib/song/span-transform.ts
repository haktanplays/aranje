/**
 * What the editing commands do to a technique span (2V-D.1-C §4–§8).
 *
 * `span-rect` knows the arithmetic; this knows which arithmetic each command
 * is. Copy reads a region, delete subtracts one, move subtracts and re-adds,
 * repeat adds several, and a string move remaps the strings — five commands,
 * one set of primitives, so a span cannot survive a copy and disappear on a
 * move.
 *
 * Everything here is pure and section-local: a span is written in section
 * ticks, never crosses a section line, and belongs to exactly one track. A
 * region that would push a span past the end of its section is refused rather
 * than trimmed, because a silently shortened palm mute is a wrong recording,
 * not a smaller one.
 *
 * ## Identity
 *
 * A fragment left behind by a cut keeps the reader's span alive in its first
 * piece (`fragmentId`); a copy is a new span and gets a new id (`copyId`).
 * Both are derived from the span and the destination rather than generated, so
 * redo writes the same bytes as the first run. Where a derived id would land
 * on one already in the section, it is extended until it does not — still
 * deterministic, because it is decided from the state being edited.
 */
import {
  copyId,
  fragmentId,
  intersect,
  normalize,
  rectOf,
  remapStrings,
  subtract,
  translate,
  withRect,
  type SpanRect,
} from "@/lib/music/span-rect";
import type { Section, TechniqueSpan } from "@/lib/song/schema";

/** A selection, as this layer sees it: one track, some time, some strings. */
export type SpanRegion = {
  readonly trackId: string;
  readonly startTicks: number;
  readonly endTicks: number;
  readonly stringIndices: readonly number[];
};

/**
 * A span on the clipboard.
 *
 * Positioned relative to the copied region, like `ClipboardEvent`, so the
 * same clipboard can be pasted anywhere without the copy remembering where it
 * came from.
 */
export type ClipboardSpan = {
  readonly kind: TechniqueSpan["kind"];
  readonly offsetTicks: number;
  readonly lengthTicks: number;
  readonly stringIndices: readonly number[];
};

export type SpanTransformFault =
  /** The result would reach outside the section it is written in. */
  | "span_out_of_section"
  /** A string in the result does not exist on this track. */
  | "span_string_missing";

export type SpanWriteResult =
  | { readonly ok: true; readonly spans: readonly TechniqueSpan[] }
  | { readonly ok: false; readonly fault: SpanTransformFault };

const rectOfRegion = (region: SpanRegion): SpanRect => ({
  startTicks: region.startTicks,
  endTicks: region.endTicks,
  stringIndices: region.stringIndices,
});

/** Every string a track has. The time selection covers all of them. */
export function allStrings(stringCount: number): readonly number[] {
  return Array.from({ length: stringCount }, (_, index) => index);
}

const spansOf = (section: Section): readonly TechniqueSpan[] => section.techniqueSpans ?? [];

/**
 * A section's spans, with this track's replaced and every other track's left
 * exactly as it was.
 *
 * Sorted so two runs of one command write the same bytes; the field is dropped
 * entirely when nothing is left, because an empty array and no array are the
 * same music and only one of them should ever be saved.
 */
export function withTrackSpans(
  section: Section,
  trackId: string,
  next: readonly TechniqueSpan[],
): Section {
  const others = spansOf(section).filter((span) => span.trackId !== trackId);
  const all = [...others, ...next].slice().sort((a, b) =>
    a.trackId.localeCompare(b.trackId) ||
    a.startTicks - b.startTicks ||
    a.endTicks - b.endTicks ||
    a.id.localeCompare(b.id),
  );
  if (all.length === 0) {
    const bare: Section = { ...section, techniqueSpans: all };
    delete bare.techniqueSpans;
    return bare;
  }
  return { ...section, techniqueSpans: all };
}

/** This track's spans, in the order they are written. */
export function trackSpans(section: Section, trackId: string): readonly TechniqueSpan[] {
  return spansOf(section).filter((span) => span.trackId === trackId);
}

// ------------------------------------------------------------------ read

/** What a copy of this region carries. Clipped to the region, never grown. */
export function readSpans(
  spans: readonly TechniqueSpan[],
  region: SpanRegion,
): readonly ClipboardSpan[] {
  const window = rectOfRegion(region);
  const out: ClipboardSpan[] = [];
  for (const span of spans) {
    if (span.trackId !== region.trackId) continue;
    const meeting = intersect(rectOf(span), window);
    if (!meeting) continue;
    out.push({
      kind: span.kind,
      offsetTicks: meeting.startTicks - region.startTicks,
      lengthTicks: meeting.endTicks - meeting.startTicks,
      stringIndices: [...meeting.stringIndices],
    });
  }
  return out.sort(
    (a, b) => a.offsetTicks - b.offsetTicks || (a.stringIndices[0] ?? 0) - (b.stringIndices[0] ?? 0),
  );
}

// ---------------------------------------------------------------- subtract

/**
 * The region taken out of every span that reaches into it.
 *
 * A span that only touches the region on some strings keeps the others, and a
 * span cut through the middle becomes two — the fragments are the honest
 * answer, and merging them back would be inventing a technique the reader did
 * not write.
 */
export function removeRegion(
  spans: readonly TechniqueSpan[],
  region: SpanRegion,
): readonly TechniqueSpan[] {
  const window = rectOfRegion(region);
  const out: TechniqueSpan[] = [];
  for (const span of spans) {
    if (span.trackId !== region.trackId) {
      out.push(span);
      continue;
    }
    const pieces = normalize(subtract(rectOf(span), window));
    pieces.forEach((piece, index) => out.push(withRect(span, piece, fragmentId(span, index))));
  }
  return out;
}

// ------------------------------------------------------------------- write

/**
 * A deterministic id that is not already in use.
 *
 * The suffix grows rather than counting from a random seed, so a redo run
 * against the same state produces the same id and undo has something stable to
 * put back.
 */
function freeId(candidate: string, taken: Set<string>): string {
  let id = candidate;
  while (taken.has(id)) id = `${id}'`;
  taken.add(id);
  return id;
}

/**
 * Put clipboard spans down at `atTicks`.
 *
 * Refuses rather than trims: a span that would reach past the section, or onto
 * a string this track does not have, comes back as a fault so the caller can
 * leave the whole command unapplied.
 */
export function writeSpans(
  spans: readonly TechniqueSpan[],
  input: {
    readonly trackId: string;
    readonly atTicks: number;
    readonly clipboard: readonly ClipboardSpan[];
    readonly sectionTicks: number;
    readonly stringCount: number;
    /** Distinguishes this paste from another of the same clipboard. */
    readonly seed: string;
  },
): SpanWriteResult {
  if (input.clipboard.length === 0) return { ok: true, spans };

  const taken = new Set(spans.map((span) => span.id));
  const added: TechniqueSpan[] = [];

  for (const [index, entry] of input.clipboard.entries()) {
    const startTicks = input.atTicks + entry.offsetTicks;
    const endTicks = startTicks + entry.lengthTicks;
    if (startTicks < 0 || endTicks > input.sectionTicks) {
      return { ok: false, fault: "span_out_of_section" };
    }
    if (entry.stringIndices.some((one) => one < 0 || one >= input.stringCount)) {
      return { ok: false, fault: "span_string_missing" };
    }
    const source: TechniqueSpan = {
      id: `${entry.kind}@${entry.offsetTicks}`,
      kind: entry.kind,
      trackId: input.trackId,
      startTicks,
      endTicks,
      stringIndices: [...entry.stringIndices],
    };
    added.push({ ...source, id: freeId(copyId(source, input.seed, index), taken) });
  }

  return { ok: true, spans: [...spans, ...added] };
}

// -------------------------------------------------------------------- move

/**
 * Move the part of each span that lies inside the region.
 *
 * The moved part keeps the reader's identity, because it is the music they
 * picked up; what stayed behind is the fragment. One array comes back, so
 * there is no state in which half of a span moved.
 */
export function moveRegion(
  spans: readonly TechniqueSpan[],
  region: SpanRegion,
  input: { readonly deltaTicks: number; readonly sectionTicks: number },
): SpanWriteResult {
  const window = rectOfRegion(region);
  const out: TechniqueSpan[] = [];

  for (const span of spans) {
    if (span.trackId !== region.trackId) {
      out.push(span);
      continue;
    }
    const meeting = intersect(rectOf(span), window);
    if (!meeting) {
      out.push(span);
      continue;
    }
    const moved = translate(meeting, input.deltaTicks);
    if (moved.startTicks < 0 || moved.endTicks > input.sectionTicks) {
      return { ok: false, fault: "span_out_of_section" };
    }
    const pieces = [moved, ...normalize(subtract(rectOf(span), window))];
    pieces.forEach((piece, index) => out.push(withRect(span, piece, fragmentId(span, index))));
  }

  return { ok: true, spans: out };
}

// ------------------------------------------------------------------ remap

/**
 * Slide the covered part of each span onto other strings.
 *
 * Only the part inside the region moves: a palm mute that runs on past the
 * selection keeps covering the strings it always did, on the time the reader
 * did not select. When a string in the covered part has nowhere to go, the
 * whole command is refused — a span that quietly covers one string fewer is
 * the failure this module exists to prevent.
 */
export function remapRegion(
  spans: readonly TechniqueSpan[],
  region: SpanRegion,
  input: { readonly stringDelta: number; readonly stringCount: number },
): SpanWriteResult {
  if (input.stringDelta === 0) return { ok: true, spans };

  const window = rectOfRegion(region);
  const out: TechniqueSpan[] = [];

  for (const span of spans) {
    if (span.trackId !== region.trackId) {
      out.push(span);
      continue;
    }
    const meeting = intersect(rectOf(span), window);
    if (!meeting) {
      out.push(span);
      continue;
    }
    const moved = remapStrings(meeting, (index) => {
      const next = index + input.stringDelta;
      return next < 0 || next >= input.stringCount ? null : next;
    });
    if (!moved) return { ok: false, fault: "span_string_missing" };

    const pieces = [moved, ...normalize(subtract(rectOf(span), window))];
    pieces.forEach((piece, index) => out.push(withRect(span, piece, fragmentId(span, index))));
  }

  return { ok: true, spans: out };
}

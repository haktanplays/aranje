/**
 * Techniques that last, and who is inside one (2V-D.1 §6).
 *
 * ## Why a span and not a flag
 *
 * Palm mute was a value of `articulation` and let ring was a boolean on the
 * note. Both work, and both say the wrong shape of thing. A guitarist muting
 * with the heel of the hand is not making a decision per note — the hand is
 * down, and it stays down across whatever is played until it lifts. More to
 * the point, the hand covers *some* strings: the low ones are choked while
 * the top one rings over them, which is the sound of half the riffs anyone
 * learns, and a per-note flag can only say it by repeating itself on every
 * note and hoping nobody edits one of them.
 *
 * So the range is the thing that is written down, and the notes inside it are
 * found rather than marked.
 *
 * ## Membership is a half-open range, on purpose
 *
 *     startTicks <= onsetTicks < endTicks
 *
 * By onset, not by overlap. A note that started before the span and is still
 * ringing inside it is not retroactively muted — the hand came down after it
 * was struck, and no hand can reach back. Half-open so two spans can touch
 * without either claiming the instant between them.
 *
 * ## What is refused
 *
 * Two spans of the same kind, or a palm mute and a let ring, on the same
 * track, overlapping in time **and** sharing a string. That is one hand asked
 * to be in two places. Spans on different strings coexist freely, which is
 * the entire point; spans that merely touch are two spans and stay two,
 * because a reader who wrote two may want to move one.
 *
 * Pure. Sections hold spans and sections cannot overlap, so nothing here
 * needs to think about a span crossing a section: it cannot be written.
 */
import type { Section, TechniqueSpan } from "@/lib/song/schema";

export type SpanKind = TechniqueSpan["kind"];

/** Why a set of spans is not writable. Named, never silently repaired. */
export type SpanRefusal =
  /** Two of the same technique over one string at one time. */
  | "duplicate_span"
  /** A palm mute and a let ring asked of one string at one time. */
  | "contradictory_span"
  /** A span with no strings, or with a string the track does not have. */
  | "unplayable_scope"
  /** `endTicks` at or before `startTicks`. */
  | "empty_span";

export const SPAN_REFUSAL_MESSAGE: Readonly<Record<SpanRefusal, string>> = {
  duplicate_span:
    "Bu teller bu aralıkta zaten aynı tekniği taşıyor. Var olanı düzenle.",
  contradictory_span:
    "Aynı tel aynı anda hem susturulup hem çınlatılamaz. Önce diğerini kaldır.",
  unplayable_scope: "Bu teknik için geçerli bir tel seçilmedi.",
  empty_span: "Bu aralıkta hiç süre yok.",
};

/** Do these two ranges share any tick? Half-open, so touching is not sharing. */
export function rangesOverlap(
  a: { readonly startTicks: number; readonly endTicks: number },
  b: { readonly startTicks: number; readonly endTicks: number },
): boolean {
  return a.startTicks < b.endTicks && b.startTicks < a.endTicks;
}

/** Do these two spans name any string in common? */
export function stringsIntersect(
  a: readonly number[],
  b: readonly number[],
): boolean {
  const set = new Set(a);
  return b.some((index) => set.has(index));
}

/**
 * Whether one onset is inside one span.
 *
 * The track is compared as well as the time and the string, because a span
 * belongs to a track and two tracks can have a string 2.
 */
export function spanCovers(
  span: TechniqueSpan,
  onset: {
    readonly trackId: string;
    readonly timeTicks: number;
    readonly stringIndex: number | null;
  },
): boolean {
  if (span.trackId !== onset.trackId) return false;
  if (onset.stringIndex === null) return false;
  if (onset.timeTicks < span.startTicks || onset.timeTicks >= span.endTicks) {
    return false;
  }
  return span.stringIndices.includes(onset.stringIndex);
}

/**
 * Whether this set of spans can live together.
 *
 * Returns the first reason it cannot, or null. Checked as a set rather than
 * one at a time because the question is about pairs: a span is never invalid
 * on its own account except for being empty or scopeless.
 */
export function spanConflict(
  spans: readonly TechniqueSpan[],
  stringCountOf?: (trackId: string) => number | null,
): SpanRefusal | null {
  for (const span of spans) {
    if (span.endTicks <= span.startTicks) return "empty_span";
    if (span.stringIndices.length === 0) return "unplayable_scope";
    const count = stringCountOf?.(span.trackId);
    if (count !== undefined && count !== null) {
      if (span.stringIndices.some((index) => index < 0 || index >= count)) {
        return "unplayable_scope";
      }
    }
  }

  /*
   * Sorted by start, so the inner loop can stop as soon as a later span
   * begins after this one ends. Without that this is every pair of spans in
   * the section on every check, and a section may hold a great many.
   */
  const sorted = [...spans].sort((a, b) => a.startTicks - b.startTicks);
  for (let i = 0; i < sorted.length; i += 1) {
    const first = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j += 1) {
      const second = sorted[j]!;
      if (second.startTicks >= first.endTicks) break;
      if (first.trackId !== second.trackId) continue;
      if (!rangesOverlap(first, second)) continue;
      if (!stringsIntersect(first.stringIndices, second.stringIndices)) continue;
      return first.kind === second.kind ? "duplicate_span" : "contradictory_span";
    }
  }
  return null;
}

/**
 * A section's spans, arranged so a lookup is not a scan of all of them.
 *
 * Built once per read of a section and thrown away with it: it is derived
 * from the spans and is never written to, so it cannot become a second thing
 * that has to agree with the first. Sorted by `startTicks`, so an onset walks
 * only the spans that could possibly have started by then.
 */
export type TechniqueSpanIndex = {
  /** Spans covering this onset, in written order. Empty when none do. */
  at(onset: {
    readonly trackId: string;
    readonly timeTicks: number;
    readonly stringIndex: number | null;
  }): readonly TechniqueSpan[];
  /** How many spans it holds, for tests that must not be vacuous. */
  readonly size: number;
};

const NONE: readonly TechniqueSpan[] = [];

export function indexSpans(
  spans: readonly TechniqueSpan[] | undefined,
): TechniqueSpanIndex {
  const sorted = [...(spans ?? [])].sort((a, b) => a.startTicks - b.startTicks);
  /* The longest span decides how far back a lookup has to walk. Without it
     every lookup starts at zero, which is the scan this exists to avoid. */
  let longest = 0;
  for (const span of sorted) {
    longest = Math.max(longest, span.endTicks - span.startTicks);
  }

  return {
    size: sorted.length,
    at(onset) {
      if (sorted.length === 0 || onset.stringIndex === null) return NONE;
      /* First span that could still be open at this tick. */
      let low = 0;
      let high = sorted.length;
      const from = onset.timeTicks - longest;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (sorted[middle]!.startTicks < from) low = middle + 1;
        else high = middle;
      }
      const found: TechniqueSpan[] = [];
      for (let i = low; i < sorted.length; i += 1) {
        const span = sorted[i]!;
        if (span.startTicks > onset.timeTicks) break;
        if (spanCovers(span, onset)) found.push(span);
      }
      return found;
    },
  };
}

/** Every span of every section, in one flat list. For whole-song passes. */
export function allSpans(sections: readonly Section[]): readonly TechniqueSpan[] {
  return sections.flatMap((section) => section.techniqueSpans ?? []);
}

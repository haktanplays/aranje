/**
 * What a command would do to the connections around it (spec 13.20 §2, 2N-A).
 *
 * Music holds notes together in two ways. A **tie chain** is one strike and
 * the `"-"` slots that keep it sounding. A **legato chain** is consecutive
 * onsets bound by `slide`, `hammer_on` or `pull_off`, which only sound at all
 * because the note before them is still there. Either can be cut in half by a
 * range that stops in the middle of it.
 *
 * Until this checkpoint the core answered that on the reader's behalf: any
 * range touching a chain was silently grown to cover the whole of it before
 * anything happened. That is a safe answer and a dishonest one — it moved
 * music nobody selected, and the reader was told about it afterwards, in a
 * badge, if at all.
 *
 * So the growing is gone and this took its place. It is a **preflight**: a
 * pure reading, taken before any mutation, that says what the relationship
 * between the selection and the music around it actually is. The command then
 * requires an explicit decision about it — see `ChainPolicy` — and refuses to
 * run without one. There is no default, because a default is exactly what the
 * old behaviour was.
 *
 * ## The five answers
 *
 * - `no_chain_impact` — nothing crosses the edges. No decision is needed.
 * - `crosses_tie_boundary` — a held note is cut.
 * - `crosses_legato_boundary` — a slide, hammer-on or pull-off reaches across
 *   an edge.
 * - `crosses_multiple_boundaries` — **both kinds** are involved. Two legato
 *   bonds, one at each end, stay `crosses_legato_boundary`: that is the
 *   commonest case of all — a chord in the middle of a run — and naming it
 *   after the number of edges rather than after what is at them would make
 *   `crosses_legato_boundary` a code that almost never fires.
 * - `crosses_section_boundary` — the chain continues past the end of this
 *   section, into music this command cannot reach. It is reported separately
 *   because neither answer is available there: the range cannot be grown to
 *   cover another section, and detaching would mean editing a section the
 *   reader is not looking at. The command fails closed and says so.
 *
 * ## What detaching means, exactly
 *
 * One list of edits, computed here and applied by the caller, so preview and
 * commit cannot disagree about what "only the chord" meant:
 *
 * - Legato bonds **inside** the range are untouched. Only the ones reaching
 *   across an edge are removed, and only from the slot at that edge.
 * - Removing one clears the `articulation` field. `"normal"` is never written
 *   in its place: the contract says an absent field is an ordinary note, and
 *   writing the word would be a second way of saying the same thing.
 * - Other articulations on the same note — vibrato, palm mute, a bend — are
 *   not chain relations and are left alone.
 * - Tie slots that would be orphaned become rests. A `"-"` with nothing in
 *   front of it is not something this may ever produce.
 * - A range that **begins** inside a tie run cannot be detached at all. There
 *   is no honest repair: the strike is outside, so what is inside is the tail
 *   of a note the reader did not select. The caller is told, and the choice
 *   is to take the whole note or nothing.
 */
import { isDrumSlotArray, type Articulation, type NoteEvent, type Section, type Song } from "@/lib/song/schema";
import {
  sectionSlotStream,
  type OnsetRef,
  type SlotPosition,
} from "@/lib/song/onset-block";
import type { TimeSelection } from "@/lib/song/time-selection";

/** Legato articulations: the ones that only sound if a note is already there. */
export const CHAINING_ARTICULATIONS: ReadonlySet<Articulation> = new Set([
  "slide",
  "hammer_on",
  "pull_off",
]);

export type ChainImpactKind =
  | "no_chain_impact"
  | "crosses_tie_boundary"
  | "crosses_legato_boundary"
  | "crosses_multiple_boundaries"
  | "crosses_section_boundary";

/** What the reader may decide to do about a chain the command would cut. */
export type ChainPolicy = "include_chain" | "detach_boundary";

export type ChainBoundary = {
  readonly kind: "tie" | "legato";
  readonly side: "start" | "end";
  /** True when the other end of the relation is in a different section. */
  readonly crossesSection: boolean;
  /** The slot inside the range that the relation reaches from. */
  readonly inside: OnsetRef;
  /** The slot just outside it, or null when that slot is in another section. */
  readonly outside: OnsetRef | null;
  /** The bond, when it is a legato one. */
  readonly articulation?: Articulation;
};

/** One deterministic edit that detaching performs. */
export type DetachEdit =
  /** Remove every chaining articulation written in this slot. */
  | { readonly kind: "clear_articulation"; readonly barIndex: number; readonly slotIndex: number }
  /** Turn a tie slot that would be orphaned into a rest. */
  | { readonly kind: "rest"; readonly barIndex: number; readonly slotIndex: number };

export type ChainImpact = {
  readonly kind: ChainImpactKind;
  readonly boundaries: readonly ChainBoundary[];
  /** The range that was asked for, unchanged. */
  readonly selection: TimeSelection;
  /** The range `include_chain` would act on: whole chains at both ends. */
  readonly expanded: TimeSelection;
  /** True when the range begins on a tie rather than on its strike. */
  readonly startsInsideTie: boolean;
  /** What `detach_boundary` would do, in order. Empty when nothing crosses. */
  readonly detach: readonly DetachEdit[];
};

/* ------------------------------------------------------------------ reading */

const isStruck = (entry: SlotPosition | undefined): boolean =>
  entry !== undefined && entry.writable && entry.slot !== null && entry.slot !== "-";

const isTie = (entry: SlotPosition | undefined): boolean =>
  entry !== undefined && entry.writable && entry.slot === "-";

const notesOf = (entry: SlotPosition | undefined): readonly NoteEvent[] =>
  entry?.slot && entry.slot !== "-" ? entry.slot.notes : [];

const chainingNotes = (entry: SlotPosition | undefined): readonly NoteEvent[] =>
  notesOf(entry).filter(
    (note) => note.articulation !== undefined && CHAINING_ARTICULATIONS.has(note.articulation),
  );

const refOf = (entry: SlotPosition): OnsetRef => ({
  barIndex: entry.barIndex,
  slotIndex: entry.slotIndex,
});

/**
 * The strike whose sound is still going at `index - 1`, or null.
 *
 * A tie is the note it continues, so a run of `"-"` is walked back to the slot
 * that struck it. A rest, or a bar the track is not written in, ends the sound
 * and returns null — which is what makes a dangling articulation dangling
 * rather than a bond.
 */
function soundingBefore(
  stream: readonly SlotPosition[],
  index: number,
): SlotPosition | null {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const entry = stream[cursor];
    if (!entry || !entry.writable) return null;
    if (isTie(entry)) continue;
    return isStruck(entry) ? entry : null;
  }
  return null;
}

/** Strings a slot's notes are written on, for deciding whether a bond is real. */
const stringsOf = (entry: SlotPosition | null): ReadonlySet<number> =>
  new Set(
    notesOf(entry ?? undefined)
      .map((note) => note.position?.string)
      .filter((value): value is number => value !== undefined),
  );

/**
 * Whether a legato note really has something to lean on.
 *
 * A hammer-on written over a rest is not a chain: it is a note that will be
 * played plainly, and the validator already warns about it (spec 10.3). Asking
 * the reader to decide about a bond that does not exist would be noise, so the
 * predecessor has to be sounding **on the same string**.
 */
function bondedNotes(
  chained: readonly NoteEvent[],
  previous: SlotPosition | null,
): readonly NoteEvent[] {
  if (!previous) return [];
  const strings = stringsOf(previous);
  return chained.filter(
    (note) => note.position !== undefined && strings.has(note.position.string),
  );
}

/** The first written slot of a section for this track, or undefined. */
function firstSlotOf(section: Section | undefined, trackId: string) {
  const bar = section?.bars[0];
  const slots = bar?.slots[trackId];
  if (!Array.isArray(slots) || isDrumSlotArray(slots)) return undefined;
  return slots[0];
}

/** Whether the section before this one writes anything at all for the track. */
function hasWrittenContent(section: Section | undefined, trackId: string): boolean {
  return (
    section?.bars.some((bar) => {
      const slots = bar.slots[trackId];
      return Array.isArray(slots) && !isDrumSlotArray(slots);
    }) ?? false
  );
}

/* -------------------------------------------------------------- boundaries */

type Edges = { readonly firstIndex: number; readonly lastIndex: number } | null;

function edgesOf(stream: readonly SlotPosition[], selection: TimeSelection): Edges {
  let firstIndex = -1;
  let lastIndex = -1;
  stream.forEach((entry, index) => {
    if (entry.startTicks < selection.startTicks) return;
    if (entry.startTicks >= selection.endTicks) return;
    if (firstIndex < 0) firstIndex = index;
    lastIndex = index;
  });
  return firstIndex < 0 ? null : { firstIndex, lastIndex };
}

type Context = {
  readonly song: Song;
  readonly sectionIndex: number;
  readonly trackId: string;
  readonly stream: readonly SlotPosition[];
};

/**
 * Every relation crossing the edges of one range.
 *
 * Both edges are asked the same two questions — is a held note being cut, and
 * is a legato bond being broken — so neither side can quietly behave
 * differently from the other.
 */
function boundariesOf(context: Context, selection: TimeSelection): ChainBoundary[] {
  const { song, sectionIndex, trackId, stream } = context;
  const edges = edgesOf(stream, selection);
  if (!edges) return [];
  const { firstIndex, lastIndex } = edges;
  const boundaries: ChainBoundary[] = [];

  const first = stream[firstIndex];
  const last = stream[lastIndex];
  if (!first || !last) return [];

  /* ---- the start edge */
  if (isTie(first)) {
    const strike = soundingBefore(stream, firstIndex);
    boundaries.push({
      kind: "tie",
      side: "start",
      // Nothing sounding inside this section means the strike is in the one
      // before it — a tie run that begins at slot 0 of the section.
      crossesSection: strike === null,
      inside: refOf(first),
      outside: strike ? refOf(strike) : null,
    });
  } else if (isStruck(first)) {
    const chained = chainingNotes(first);
    if (chained.length > 0) {
      if (firstIndex === 0) {
        /*
         * The bond, if there is one, reaches into the previous section. It is
         * only a boundary when that section actually writes this track; a
         * hammer-on in the first bar of the first section has nothing behind
         * it and is already the validator's business, not this one's.
         */
        const previousSection = song.sections[sectionIndex - 1];
        if (hasWrittenContent(previousSection, trackId)) {
          boundaries.push({
            kind: "legato",
            side: "start",
            crossesSection: true,
            inside: refOf(first),
            outside: null,
            ...(chained[0]?.articulation === undefined
              ? {}
              : { articulation: chained[0].articulation }),
          });
        }
      } else {
        const previous = soundingBefore(stream, firstIndex);
        const real = bondedNotes(chained, previous);
        if (previous && real.length > 0) {
          boundaries.push({
            kind: "legato",
            side: "start",
            crossesSection: false,
            inside: refOf(first),
            outside: refOf(previous),
            ...(real[0]?.articulation === undefined
              ? {}
              : { articulation: real[0].articulation }),
          });
        }
      }
    }
  }

  /* ---- the end edge */
  const next = stream[lastIndex + 1];
  if (next === undefined) {
    /*
     * The range reaches the end of the section, so whatever continues is in
     * the next one. Both relations are looked for: a tie carries on as a `"-"`
     * in its first bar, a legato bond as a chaining articulation there.
     */
    const following = firstSlotOf(song.sections[sectionIndex + 1], trackId);
    if (following === "-") {
      boundaries.push({
        kind: "tie",
        side: "end",
        crossesSection: true,
        inside: refOf(last),
        outside: null,
      });
    } else if (following && following !== null && !Array.isArray(following)) {
      const chained = following.notes.filter(
        (note) =>
          note.articulation !== undefined && CHAINING_ARTICULATIONS.has(note.articulation),
      );
      if (chained.length > 0) {
        boundaries.push({
          kind: "legato",
          side: "end",
          crossesSection: true,
          inside: refOf(last),
          outside: null,
          ...(chained[0]?.articulation === undefined
            ? {}
            : { articulation: chained[0].articulation }),
        });
      }
    }
  } else if (isTie(next)) {
    boundaries.push({
      kind: "tie",
      side: "end",
      crossesSection: false,
      inside: refOf(last),
      outside: refOf(next),
    });
  } else if (isStruck(next)) {
    const chained = chainingNotes(next);
    // The note it leans on is whatever is still sounding at the range's end.
    const sounding = isStruck(last) ? last : soundingBefore(stream, lastIndex + 1);
    const real = bondedNotes(chained, sounding);
    if (real.length > 0) {
      boundaries.push({
        kind: "legato",
        side: "end",
        crossesSection: false,
        inside: refOf(last),
        outside: refOf(next),
        ...(real[0]?.articulation === undefined
          ? {}
          : { articulation: real[0].articulation }),
      });
    }
  }

  return boundaries;
}

/* ---------------------------------------------------------------- expanding */

const indexOfRef = (stream: readonly SlotPosition[], ref: OnsetRef): number =>
  stream.findIndex(
    (entry) => entry.barIndex === ref.barIndex && entry.slotIndex === ref.slotIndex,
  );

/**
 * Grow a range until nothing crosses its edges.
 *
 * Written in terms of `boundariesOf` on purpose: the range `include_chain`
 * acts on is, by construction, the range at which the preflight finds nothing
 * left to report. The two can therefore not drift apart the way a separate
 * expansion routine and a separate detector would.
 */
function expand(context: Context, selection: TimeSelection): TimeSelection {
  const { stream } = context;
  let scope = selection;

  for (let guard = 0; guard <= stream.length; guard += 1) {
    const boundaries = boundariesOf(context, scope).filter(
      (boundary) => !boundary.crossesSection,
    );
    if (boundaries.length === 0) return scope;

    let { startTicks, endTicks } = scope;

    for (const boundary of boundaries) {
      if (boundary.outside === null) continue;
      const index = indexOfRef(stream, boundary.outside);
      const entry = stream[index];
      if (!entry) continue;

      if (boundary.side === "start") {
        // Back to where the outside note is struck, ties and all: half a note
        // is not something the range may stop on.
        let cursor = index;
        while (cursor > 0 && isTie(stream[cursor])) cursor -= 1;
        startTicks = Math.min(startTicks, stream[cursor]?.startTicks ?? entry.startTicks);
      } else {
        // Forward over the outside note and everything holding it.
        let cursor = index;
        while (cursor + 1 < stream.length && isTie(stream[cursor + 1])) cursor += 1;
        const tail = stream[cursor] ?? entry;
        endTicks = Math.max(endTicks, tail.startTicks + tail.durationTicks);
      }
    }

    if (startTicks === scope.startTicks && endTicks === scope.endTicks) return scope;
    scope = { ...scope, startTicks, endTicks };
  }

  return scope;
}

/* ----------------------------------------------------------------- detaching */

/**
 * The edits that turn "only what I selected" into something that stands alone.
 *
 * Deterministic and ordered, so the same impact always produces the same list
 * — which is what lets the preview and the commit be the same act rather than
 * two similar ones.
 */
function detachEditsFor(
  stream: readonly SlotPosition[],
  boundaries: readonly ChainBoundary[],
): DetachEdit[] {
  const edits: DetachEdit[] = [];
  const seen = new Set<string>();
  const push = (edit: DetachEdit) => {
    const key = `${edit.kind}:${edit.barIndex}:${edit.slotIndex}`;
    if (seen.has(key)) return;
    seen.add(key);
    edits.push(edit);
  };

  for (const boundary of boundaries) {
    if (boundary.crossesSection) continue;

    if (boundary.kind === "legato") {
      /*
       * The articulation is cleared where it is *written*. At the start edge
       * that is the first slot inside the range; at the end edge it is the
       * slot just outside, because the note that leans is the later one.
       */
      const target = boundary.side === "start" ? boundary.inside : boundary.outside;
      if (target) push({ kind: "clear_articulation", ...target });
      continue;
    }

    // A tie run beyond the end of the range: every slot of it becomes a rest,
    // or the first of them would be a `"-"` with nothing in front of it.
    if (boundary.side === "end" && boundary.outside) {
      let cursor = indexOfRef(stream, boundary.outside);
      while (cursor >= 0 && cursor < stream.length && isTie(stream[cursor])) {
        const entry = stream[cursor];
        if (!entry) break;
        push({ kind: "rest", barIndex: entry.barIndex, slotIndex: entry.slotIndex });
        cursor += 1;
      }
    }
    // A tie run the range starts inside is deliberately not repaired here.
    // `startsInsideTie` reports it and the caller refuses; see the header.
  }

  return edits;
}

/* ------------------------------------------------------------------- the api */

function classify(boundaries: readonly ChainBoundary[]): ChainImpactKind {
  if (boundaries.length === 0) return "no_chain_impact";
  if (boundaries.some((boundary) => boundary.crossesSection)) {
    return "crosses_section_boundary";
  }
  const kinds = new Set(boundaries.map((boundary) => boundary.kind));
  if (kinds.size > 1) return "crosses_multiple_boundaries";
  return kinds.has("tie") ? "crosses_tie_boundary" : "crosses_legato_boundary";
}

/** The preflight, for a caller that has already resolved the section. */
export function chainImpactOf(context: Context, selection: TimeSelection): ChainImpact {
  const boundaries = boundariesOf(context, selection);
  const kind = classify(boundaries);
  const expanded =
    kind === "no_chain_impact" || kind === "crosses_section_boundary"
      ? selection
      : expand(context, selection);

  const edges = edgesOf(context.stream, selection);
  const first = edges ? context.stream[edges.firstIndex] : undefined;

  return {
    kind,
    boundaries,
    selection,
    expanded,
    startsInsideTie: isTie(first),
    detach: kind === "no_chain_impact" ? [] : detachEditsFor(context.stream, boundaries),
  };
}

/**
 * The preflight, for a caller holding only a song and a range.
 *
 * Null when the section or the track is not there — the command path reports
 * that with its own typed refusal, and repeating the message here would give
 * the screen two ways to say the same thing.
 */
export function chainImpact(song: Song, selection: TimeSelection): ChainImpact | null {
  const sectionIndex = song.sections.findIndex((entry) => entry.id === selection.sectionId);
  const section = song.sections[sectionIndex];
  if (!section) return null;
  return chainImpactOf(
    {
      song,
      sectionIndex,
      trackId: selection.trackId,
      stream: sectionSlotStream(section, selection.trackId),
    },
    selection,
  );
}

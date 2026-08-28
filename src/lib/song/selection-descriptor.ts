/**
 * What is selected, said once so nothing has to guess (2U-A §2).
 *
 * ## The problem this replaces
 *
 * The app grew three selections, each right for its own job: `Selection` is a
 * set of onsets a tap picked out, `TimeSelection` is a span of ticks on one
 * track, and `BarSelection` is a run of whole bars in one of two scopes. They
 * are not going away — each is the honest shape of a different gesture.
 *
 * What was missing is the sentence a *command* needs. Asking "is this a
 * chord?" by counting notes, or "is this whole bars?" by comparing a tick to
 * a bar width, is a question answered again in every component that asks it,
 * and answered slightly differently each time. A screen that decides which
 * verbs to offer by counting notes is a screen that will offer "Arpeje çevir"
 * on a rest the day the counting is off by one.
 *
 * So the three keep their shapes and gain one common description. A
 * descriptor says what was selected, where it is, what it covers and whether
 * it happens to be whole bars — and every "can I do X to this?" is answered
 * from the descriptor by `selection-capability.ts`, never by re-reading the
 * Song in a component.
 *
 * ## Event identity is positional, and that is not a shortcut
 *
 * The Song Contract has no note ids. A note *is* its position: this string,
 * this slot, this bar, this track. That is a deliberate property of the
 * contract — two identical notes written in the same place are the same note,
 * and there is no hidden identity that would make them differ.
 *
 * So `eventIds` here are built from position, and they mean exactly what
 * position means: they identify a note inside one version of one song, and
 * they change when the music moves. A clipboard therefore cannot carry them
 * (it carries music, and music has no address), and a paste cannot reuse them
 * (its notes are somewhere else, so they are different notes). Both of those
 * fall out of the contract rather than being rules a command has to remember.
 *
 * Adding a persisted `id` to `NoteEvent` would change all of that, and it is
 * a one-way door: every song ever written would need one, and two notes that
 * are musically identical would stop being equal. That decision is not this
 * checkpoint's to make.
 */
import { ticksPerBar } from "@/lib/music/timing";
import { sectionSlotStream } from "@/lib/song/onset-block";
import type { BarSelection } from "@/lib/song/bar-selection";
import type { Section, Song } from "@/lib/song/schema";
import type { TimeSelection } from "@/lib/song/time-selection";

/**
 * What kind of thing is held.
 *
 * Ordered from smallest to largest, and the order is meaningful: a command
 * offered on `note` is offered on everything bigger, and a command offered
 * only on `measures` is offered on nothing smaller.
 */
export type SelectionScope =
  /** One note, on one string, at one onset. */
  | "note"
  /** Several notes struck together at one onset. */
  | "chord"
  /** A span of musical time on one track. */
  | "range"
  /** Whole bars, with every track in them. */
  | "measures";

export type BarRange = {
  /** Inclusive. */
  readonly startBarIndex: number;
  /** Inclusive. */
  readonly endBarIndex: number;
};

export type SelectionDescriptor = {
  readonly scope: SelectionScope;
  readonly sectionId: string;
  /** Inclusive, in ticks from the start of the section. */
  readonly startTicks: number;
  /** Exclusive. */
  readonly endTicks: number;
  /** Every track the selection acts on. One for a range; all for measures. */
  readonly trackIds: readonly string[];
  /** Strings carrying a selected note, ascending. Empty for a silent range. */
  readonly stringIndexes: readonly number[];
  /** Positional identity of every selected note. See the header. */
  readonly eventIds: readonly string[];
  /** True when the range begins on a bar line and ends on one. */
  readonly wholeBars: boolean;
  /** The bars covered, when the selection is expressed in bars at all. */
  readonly barRange: BarRange | null;
  /** Struck onsets inside the selection. Ties belong to their onset. */
  readonly onsetCount: number;
};

/** A note's address inside one version of one song. */
export function eventId(input: {
  readonly sectionId: string;
  readonly barIndex: number;
  readonly slotIndex: number;
  readonly trackId: string;
  readonly stringIndex: number;
}): string {
  return [
    input.sectionId,
    input.barIndex,
    input.slotIndex,
    input.trackId,
    input.stringIndex,
  ].join(":");
}

/** Where each bar of a section starts and ends, in section ticks. */
function barSpans(section: Section): readonly { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const bar of section.bars) {
    const width = ticksPerBar(bar.timeSignature, bar.resolution);
    spans.push({ start: cursor, end: cursor + width });
    cursor += width;
  }
  return spans;
}

/** The bars a tick range touches, or null when it touches none. */
function coveredBars(
  section: Section,
  startTicks: number,
  endTicks: number,
): BarRange | null {
  const spans = barSpans(section);
  let first = -1;
  let last = -1;
  spans.forEach((span, index) => {
    const overlaps = span.start < endTicks && startTicks < span.end;
    if (!overlaps) return;
    if (first === -1) first = index;
    last = index;
  });
  return first === -1 ? null : { startBarIndex: first, endBarIndex: last };
}

/** True when both edges of the range sit exactly on a bar line. */
function sitsOnBarLines(
  section: Section,
  startTicks: number,
  endTicks: number,
): boolean {
  if (endTicks <= startTicks) return false;
  const spans = barSpans(section);
  return (
    spans.some((span) => span.start === startTicks) &&
    spans.some((span) => span.end === endTicks)
  );
}

/**
 * Describe a span of time on one track.
 *
 * The scope is read from what is actually in the range rather than from how
 * the reader made it: one note is a note however wide the gesture was, and a
 * range with two onsets is a range even if it is only one slot wide.
 */
export function describeTimeSelection(
  song: Song,
  selection: TimeSelection,
): SelectionDescriptor | null {
  const section = song.sections.find((entry) => entry.id === selection.sectionId);
  if (!section) return null;

  const stream = sectionSlotStream(section, selection.trackId);
  const struck = stream.filter(
    (entry) =>
      entry.slot !== null &&
      entry.slot !== "-" &&
      entry.startTicks >= selection.startTicks &&
      entry.startTicks < selection.endTicks,
  );

  const eventIds: string[] = [];
  const strings = new Set<number>();
  for (const entry of struck) {
    const slot = entry.slot;
    if (slot === undefined || slot === null || slot === "-" || Array.isArray(slot)) {
      continue;
    }
    for (const note of slot.notes) {
      const stringIndex = note.position?.string;
      if (stringIndex === undefined) continue;
      strings.add(stringIndex);
      eventIds.push(
        eventId({
          sectionId: selection.sectionId,
          barIndex: entry.barIndex,
          slotIndex: entry.slotIndex,
          trackId: selection.trackId,
          stringIndex,
        }),
      );
    }
  }

  /*
   * One onset carrying one note is a note; one onset carrying several is a
   * chord. Anything else — more onsets, or none at all — is a range, because
   * those are the two cases where "which note?" has no single answer.
   */
  const scope: SelectionScope =
    struck.length === 1 ? (eventIds.length === 1 ? "note" : "chord") : "range";

  return {
    scope,
    sectionId: selection.sectionId,
    startTicks: selection.startTicks,
    endTicks: selection.endTicks,
    trackIds: [selection.trackId],
    stringIndexes: [...strings].sort((a, b) => a - b),
    eventIds,
    wholeBars: sitsOnBarLines(section, selection.startTicks, selection.endTicks),
    barRange: coveredBars(section, selection.startTicks, selection.endTicks),
    onsetCount: struck.length,
  };
}

/**
 * Describe a run of whole bars.
 *
 * A `full` bar selection covers every track, because that is what it means:
 * the bars as objects, with everything written in them. A `track` selection
 * covers one, and says so — the two must never be read as the same thing
 * (`bar-selection.ts`).
 */
export function describeBarSelection(
  song: Song,
  selection: BarSelection,
): SelectionDescriptor | null {
  const section = song.sections.find((entry) => entry.id === selection.sectionId);
  if (!section) return null;

  const spans = barSpans(section);
  const first = spans[selection.startBarIndex];
  const last = spans[selection.endBarIndex];
  if (!first || !last) return null;

  const trackIds =
    selection.scope === "track"
      ? [selection.trackId]
      : song.tracks.map((track) => track.id);

  const eventIds: string[] = [];
  const strings = new Set<number>();
  let onsetCount = 0;

  for (const trackId of trackIds) {
    const stream = sectionSlotStream(section, trackId);
    for (const entry of stream) {
      if (
        entry.barIndex < selection.startBarIndex ||
        entry.barIndex > selection.endBarIndex
      ) {
        continue;
      }
      const slot = entry.slot;
      if (slot === undefined || slot === null || slot === "-" || Array.isArray(slot)) {
      continue;
    }
      onsetCount += 1;
      for (const note of slot.notes) {
        const stringIndex = note.position?.string;
        if (stringIndex === undefined) continue;
        strings.add(stringIndex);
        eventIds.push(
          eventId({
            sectionId: selection.sectionId,
            barIndex: entry.barIndex,
            slotIndex: entry.slotIndex,
            trackId,
            stringIndex,
          }),
        );
      }
    }
  }

  return {
    scope: "measures",
    sectionId: selection.sectionId,
    startTicks: first.start,
    endTicks: last.end,
    trackIds,
    stringIndexes: [...strings].sort((a, b) => a - b),
    eventIds,
    wholeBars: true,
    barRange: {
      startBarIndex: selection.startBarIndex,
      endBarIndex: selection.endBarIndex,
    },
    onsetCount,
  };
}

/** How many bars a descriptor covers. Zero when it covers none. */
export function barCount(descriptor: SelectionDescriptor): number {
  if (!descriptor.barRange) return 0;
  return descriptor.barRange.endBarIndex - descriptor.barRange.startBarIndex + 1;
}

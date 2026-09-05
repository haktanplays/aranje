/**
 * The written rhythm under the staff (2T-B §4).
 *
 * ## What this replaces, and why the old one was not enough
 *
 * The rhythm guide before this drew beams and nothing else, and it worked out
 * how long each note was by counting tie slots. Both of those were fine while
 * a note's length *was* its tie run. Score Truth v2 ended that: a note now
 * carries its own value, and a value is the thing a stem, its beams, its dot
 * and its tuplet bracket are all claims about.
 *
 * So this reads written values in exact ticks and produces the whole tail:
 *
 * - a **stem** for every note that has one, so an unbeamed quarter is not
 *   invisible in the rhythm row;
 * - **beams** across notes read together, with the second and third beams
 *   drawn only under the notes that actually carry them, and a **hook** where
 *   a note carries a beam its neighbours do not;
 * - a **dot** where the value is dotted, because a dotted eighth and an eighth
 *   are different notes and the reader has no other way to tell;
 * - **tuplet brackets** over runs of triplet values, which a beam cannot say;
 * - **rests**, with their own values, and only where the bar is really silent;
 * - a **tie mark** where a duration is not a single written value at all.
 *
 * ## Rests are asked about the whole bar, not one slot
 *
 * A slot with nothing written in it is not automatically a rest: a note from
 * three slots ago may still be sounding over it. A rest is written only where
 * nothing at all is sounding, which is why this takes the spans as well as the
 * rest slots. Getting that wrong prints a rest under a ringing chord.
 *
 * ## Grouping follows the meter, not a count of four
 *
 * Beams break at beat lines and beat lines come from the meter — 6/8 groups in
 * two dotted beats, 3/4 in three quarters. Nothing here divides the bar into
 * fours from the bar line and calls it a beat. Where the meter has no felt
 * beat the notated one is used and nothing is invented on top (spec 5.5).
 */
import {
  BEAMS,
  hasStem,
  noteValueOf,
  splitIntoValues,
  type NoteValue,
} from "@/lib/music/note-value";
import { meterBeats } from "@/lib/music/meter-beats";
import type { BeatGrouping } from "@/lib/music/rhythm-profile";
import {
  ticksPerSlot,
  type Resolution,
  type TimeSignature,
} from "@/lib/music/timing";
import type { TabSpan } from "@/lib/tab/timeline";

export type TailNote = {
  readonly slotIndex: number;
  readonly kind: "note" | "rest";
  /** Ticks the tail is drawing. For a tie chain, the first value's worth. */
  readonly ticks: number;
  /** Null only for a duration the vocabulary cannot write at all. */
  readonly value: NoteValue | null;
  /** Beams this note carries: 1 for an eighth, 2 a sixteenth, 3 finer. */
  readonly beams: number;
  /** Flags to draw instead, when no beam group took this note in. */
  readonly flags: number;
  readonly dots: number;
  readonly stem: boolean;
  /** The written duration needed more than one value, so a tie follows. */
  readonly tiedTo: boolean;
  /** The voices sharing this onset do not all have the same length. */
  readonly mixed: boolean;
};

export type BeamRun = {
  /** 1 for the primary beam, 2 and 3 for the ones above it. */
  readonly level: number;
  readonly fromSlot: number;
  readonly toSlot: number;
  /** Set when one note carries this beam alone, and the stub needs a side. */
  readonly hook: "left" | "right" | null;
  /** Notes this run joins, for the reading a screen reader is given. */
  readonly notes: number;
};

export type TupletBracket = {
  readonly fromSlot: number;
  readonly toSlot: number;
  /** Notes in the space of two — always 3 in the vocabulary we can write. */
  readonly count: number;
};

export type RhythmTail = {
  readonly notes: readonly TailNote[];
  readonly beams: readonly BeamRun[];
  readonly tuplets: readonly TupletBracket[];
  /** Slots a beat begins on, so a view can draw the grouping it grouped by. */
  readonly beats: readonly number[];
};

export type TailInput = {
  readonly spans: readonly TabSpan[];
  readonly restSlots: readonly number[];
  readonly timeSignature: TimeSignature;
  readonly resolution: Resolution;
  readonly slotCount: number;
  /** The feel the bar carries, when it carries one (2V-D.2 §12). */
  readonly grouping?: BeatGrouping;
};

/**
 * Where each beat of this bar starts, in slots.
 *
 * Read off the bar's grouping (2V-D.2 §12), so the lines a reader sees are
 * the beats the metronome clicks. In 7/8 felt `2+2+3` that is three lines at
 * the first, third and fifth eighths — not seven identical ticks, which is
 * what a single beat length produced and is not how anybody counts a 7/8.
 *
 * `slotCount` is still honoured over the grouping's own total: a caller
 * drawing a bar draws the bar it has.
 */
export function beatSlots(
  timeSignature: TimeSignature,
  resolution: Resolution,
  slotCount: number,
  grouping?: BeatGrouping,
): readonly number[] {
  const beats = meterBeats({ meter: timeSignature, resolution, grouping })
    .map((beat) => beat.slot)
    .filter((slot) => slot < slotCount);
  return beats.length > 0 ? beats : [0];
}

/** The value a tail draws for a duration, and whether a tie follows it. */
function drawnValue(ticks: number): { value: NoteValue | null; tiedTo: boolean } {
  const exact = noteValueOf(ticks);
  if (exact !== null) return { value: exact, tiedTo: false };
  const parts = splitIntoValues(ticks);
  return { value: parts[0] ?? null, tiedTo: parts.length > 1 };
}

function tailNote(
  slotIndex: number,
  kind: "note" | "rest",
  ticks: number,
  mixed: boolean,
): TailNote {
  const { value, tiedTo } = drawnValue(ticks);
  const beams = value === null ? 0 : BEAMS[value.base];
  return {
    slotIndex,
    kind,
    ticks: value?.ticks ?? ticks,
    value,
    /*
     * A rest has no stem, so no beam may reach it and nothing may be shared
     * with a neighbour. Its value is drawn on the glyph itself, as hooks —
     * which is what `flags` means everywhere here.
     */
    beams: kind === "rest" ? 0 : beams,
    flags: kind === "rest" ? beams : 0,
    dots: value?.modifier === "dotted" ? 1 : 0,
    stem: kind === "note" && value !== null && hasStem(value.base),
    tiedTo,
    mixed,
  };
}

/** One entry per onset, with the length that drives what happens next. */
function onsetsOf(spans: readonly TabSpan[]): readonly TailNote[] {
  const bySlot = new Map<number, number[]>();
  for (const span of spans) {
    if (span.openStart) continue; // a continuation is not a new onset
    bySlot.set(span.startSlot, [...(bySlot.get(span.startSlot) ?? []), span.writtenTicks]);
  }
  return [...bySlot.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([slotIndex, lengths]) => {
      /*
       * A chord is one rhythm. Where its voices disagree about how long they
       * are, the shortest is what the hand does next — and the disagreement
       * is reported rather than smoothed over, because it is a second voice
       * wearing a chord's clothes.
       */
      const shortest = Math.min(...lengths);
      const mixed = lengths.some((length) => length !== shortest);
      return tailNote(slotIndex, "note", shortest, mixed);
    });
}

/** Rest runs, merged where they can be and broken at every beat line. */
function restsOf(
  input: TailInput,
  beats: readonly number[],
): readonly TailNote[] {
  const sounding = new Set<number>();
  for (const span of input.spans) {
    for (let slot = span.startSlot; slot <= span.endSlot; slot += 1) sounding.add(slot);
  }
  const silent = new Set(
    input.restSlots.filter((slot) => !sounding.has(slot) && slot < input.slotCount),
  );

  const step = ticksPerSlot(input.resolution);
  const breaks = new Set(beats);
  const rests: TailNote[] = [];
  let slot = 0;

  while (slot < input.slotCount) {
    if (!silent.has(slot)) {
      slot += 1;
      continue;
    }
    let length = 1;
    /* A rest may be merged with the next one, but never across a beat line. */
    while (
      silent.has(slot + length) &&
      !breaks.has(slot + length) &&
      slot + length < input.slotCount
    ) {
      length += 1;
    }
    rests.push(tailNote(slot, "rest", length * step, false));
    slot += length;
  }

  return rests;
}

/**
 * Notes read as one gesture: contiguous, inside one beat, all beamable.
 *
 * "Contiguous" is measured in ticks, not slots, so a dotted eighth followed
 * by a sixteenth is one group and an eighth followed by a rest is not.
 */
function beamGroups(
  notes: readonly TailNote[],
  beats: readonly number[],
  resolution: Resolution,
): readonly (readonly TailNote[])[] {
  const step = ticksPerSlot(resolution);
  const beatOf = (slot: number) =>
    beats.reduce((found, start, index) => (slot >= start ? index : found), 0);

  const groups: TailNote[][] = [];
  let run: TailNote[] = [];

  const flush = () => {
    if (run.length >= 2) groups.push(run);
    run = [];
  };

  for (const note of notes) {
    const previous = run[run.length - 1];
    const contiguous =
      previous !== undefined &&
      previous.slotIndex * step + previous.ticks === note.slotIndex * step;
    const sameBeat =
      previous !== undefined && beatOf(previous.slotIndex) === beatOf(note.slotIndex);
    if (note.beams === 0) {
      flush();
      continue;
    }
    if (!contiguous || !sameBeat) flush();
    run.push(note);
  }
  flush();
  return groups;
}

/** Where secondary beams break inside an over-long group, in slots. */
function secondaryBreak(group: readonly TailNote[]): number | null {
  /* Four sixteenths take an unbroken double beam; eight thirty-seconds do
     not, and break at the half-beat the way a copyist would write them. */
  if (group.length <= 4) return null;
  const middle = group[Math.floor(group.length / 2)];
  return middle?.slotIndex ?? null;
}

function runsAtLevel(
  group: readonly TailNote[],
  level: number,
  breakAt: number | null,
): readonly BeamRun[] {
  const runs: BeamRun[] = [];
  let current: TailNote[] = [];

  const flush = () => {
    const first = current[0];
    const last = current[current.length - 1];
    if (first !== undefined && last !== undefined) {
      runs.push(
        current.length > 1
          ? {
              level,
              fromSlot: first.slotIndex,
              toSlot: last.slotIndex,
              hook: null,
              notes: current.length,
            }
          : {
              level,
              fromSlot: first.slotIndex,
              toSlot: first.slotIndex,
              /* A lone beam points back at the group it belongs to, unless
                 it is the group's own first note and has nothing behind it. */
              hook: first.slotIndex === group[0]?.slotIndex ? "right" : "left",
              notes: 1,
            },
      );
    }
    current = [];
  };

  for (const note of group) {
    if (note.beams < level) {
      flush();
      continue;
    }
    if (breakAt !== null && note.slotIndex === breakAt) flush();
    current.push(note);
  }
  flush();
  return runs;
}

/** Runs of triplet values, which need a bracket a beam cannot draw. */
function tupletsOf(notes: readonly TailNote[]): readonly TupletBracket[] {
  const brackets: TupletBracket[] = [];
  let run: TailNote[] = [];

  const flush = () => {
    /* Three in the space of two. A run that is not a multiple of three is
       not a grouping this module knows, and it says nothing rather than
       bracketing something it cannot name. */
    for (let start = 0; start + 3 <= run.length; start += 3) {
      brackets.push({
        fromSlot: run[start]!.slotIndex,
        toSlot: run[start + 2]!.slotIndex,
        count: 3,
      });
    }
    run = [];
  };

  for (const note of notes) {
    if (note.value?.modifier !== "triplet") flush();
    else run.push(note);
  }
  flush();
  return brackets;
}

export function buildRhythmTail(input: TailInput): RhythmTail {
  const beats = beatSlots(
    input.timeSignature,
    input.resolution,
    input.slotCount,
    input.grouping,
  );
  const onsets = onsetsOf(input.spans);
  const rests = restsOf(input, beats);

  const groups = beamGroups(onsets, beats, input.resolution);
  const beamed = new Set(groups.flat().map((note) => note.slotIndex));
  const beams = groups.flatMap((group) => {
    const breakAt = secondaryBreak(group);
    const levels = Math.max(...group.map((note) => note.beams));
    return Array.from({ length: levels }, (_, index) =>
      runsAtLevel(group, index + 1, index === 0 ? null : breakAt),
    ).flat();
  });

  /* A beamable note nobody beamed carries its own flags instead. */
  const notes = [...onsets, ...rests]
    .map((note) =>
      note.kind === "note" && !beamed.has(note.slotIndex)
        ? { ...note, flags: note.beams }
        : note,
    )
    .sort((a, b) => a.slotIndex - b.slotIndex);

  return { notes, beams, tuplets: tupletsOf(onsets), beats };
}

/**
 * What a screen reader is told about one beam run (spec 13.20 §7).
 *
 * The wording is the rhythm guide's, unchanged, because a reader who learned
 * it should not have to learn it again — and because the acceptance harnesses
 * find beams by this label.
 */
export function beamRunLabel(run: BeamRun, tuplet: boolean): string {
  const value = run.level === 1 ? "1/8" : run.level === 2 ? "1/16" : "1/32";
  return `Ritim grubu: ${run.notes} nota, ${value}${tuplet ? " üçleme" : ""}`;
}

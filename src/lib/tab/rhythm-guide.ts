/**
 * Which short notes are read together (spec 13.20 §7, 2N-A).
 *
 * Tab tells you *where* to put your fingers and almost nothing about *when*.
 * A row of fret numbers on a sixteenth grid looks exactly like a row on an
 * eighth grid, and a reader who does not already know the piece has to count
 * cells to find out. Standard notation solves this by beaming short notes
 * together inside a beat, and that is the one thing borrowed here.
 *
 * ## What it claims, and what it does not
 *
 * It is a **rhythmic** guide and nothing else. It does not say these notes are
 * a scale, a lick, a phrase or a chord shape; it says they fall inside the same
 * beat and are read as one gesture. Nothing about pitch is consulted, so no
 * reading of it can be a claim about pitch.
 *
 * It is also not a notation engraver. Stem direction, voices, dynamics,
 * alternate endings, grace notes and sweeps are out of scope (spec 13.20 §7)
 * and none of them are approximated here.
 *
 * ## Where the answers come from
 *
 * Every one of them is already in the model:
 *
 * - **A chord is one onset.** `frettedRhythm` collapses a bar to one
 *   `SlotState` per slot, so a six-string chord is a single `"onset"` — the
 *   property is inherited rather than re-derived, and no second traversal of
 *   the bar exists to disagree with the first.
 * - **A tie is not an onset.** It is `"sustain"`, which extends the note it
 *   continues rather than starting a group member.
 * - **A rest ends the beam.** `"rest"` and `"empty"` both break a run, because
 *   silence is what a beam may not be drawn over.
 * - **The bar line ends it too.** The states are one bar's, so a group cannot
 *   reach past the end of the bar it is in.
 * - **Beat grouping** comes from the bar's own feel (2V-D.2 §12). 6/8 groups
 *   in two dotted beats; 7/8 groups the way the bar says it is felt, and a bar
 *   that says nothing gets the metre's ordinary feel — `2+2+3` in 7/8 — which
 *   the reader can see and change. That is a change of stance: before the
 *   Song Contract had a field for it, 7/8 beamed in seven equal eighths
 *   because inventing a feel was worse than declining to guess. There is a
 *   field now, so declining would mean ignoring what the bar said.
 *
 *   The beats are **not evenly spaced any more**, so grouping is decided by
 *   which beat a slot falls in rather than by dividing the slot number, and a
 *   beam still cannot cross from one beat into the next.
 */
import { meterBeats, type MeterBeat } from "@/lib/music/meter-beats";
import type { BeatGrouping } from "@/lib/music/rhythm-profile";
import {
  isTripletGrid,
  ticksPerSlot,
  type Resolution,
  type TimeSignature,
} from "@/lib/music/timing";
import type { SlotState } from "@/lib/tab/timeline";

export type BeamGroup = {
  /** Slots of the onsets read together, in order. Always two or more. */
  readonly slots: readonly number[];
  /** Beam lines to draw: 1 for an eighth, 2 for a sixteenth, 3 for finer. */
  readonly levels: number;
  /** True on a triplet grid, where the group carries a visible "3". */
  readonly triplet: boolean;
};

export type RhythmGuide = {
  readonly groups: readonly BeamGroup[];
  /**
   * The beats the groups were grouped by, so a view draws the same divisions
   * the beams were built from. A list rather than a slot count: 7/8 felt
   * `2+2+3` has three beats and no single length that describes them.
   */
  readonly beats: readonly MeterBeat[];
};

/** A quarter note, in ticks. Everything shorter than this can be beamed. */
const QUARTER = ticksPerSlot(4);

/**
 * How many beams a note of this length gets.
 *
 * Written as note *values*, not as slot counts, because the same slot count
 * means different things on different grids. On a triplet grid three notes
 * fill the space of two, so the value a reader would write is half again as
 * long as the sounding time — which is why an eighth triplet gets one beam
 * like any other eighth, rather than two because it happens to be shorter.
 */
export function beamLevels(durationTicks: number, resolution: Resolution): number {
  const value = isTripletGrid(resolution) ? (durationTicks * 3) / 2 : durationTicks;
  if (value >= QUARTER) return 0;
  if (value >= QUARTER / 2) return 1;
  if (value >= QUARTER / 4) return 2;
  return 3;
}

/**
 * The beam groups of one bar.
 *
 * `states` is what `frettedRhythm` or `drumRhythm` already produced for the
 * bar: one entry per slot, saying whether it is struck, still sounding, a rest
 * or empty.
 */
export function buildRhythmGuide(
  states: readonly SlotState[],
  timeSignature: TimeSignature,
  resolution: Resolution,
  grouping?: BeatGrouping,
): RhythmGuide {
  const beats = meterBeats({ meter: timeSignature, resolution, grouping });
  /* Which beat a slot belongs to. A linear walk rather than a division,
     because the beats of an asymmetric metre are not the same length. */
  const beatOf = (slot: number): number => {
    for (let index = beats.length - 1; index >= 0; index -= 1) {
      if (slot >= beats[index]!.slot) return index;
    }
    return 0;
  };
  const step = ticksPerSlot(resolution);
  const triplet = isTripletGrid(resolution);

  /* Onsets, with how long each one sounds. A run of `"sustain"` belongs to the
     note in front of it, so it lengthens that note rather than adding one. */
  const onsets: { slot: number; durationTicks: number }[] = [];
  states.forEach((state, slot) => {
    if (state !== "onset") return;
    let length = 1;
    while (states[slot + length] === "sustain") length += 1;
    onsets.push({ slot, durationTicks: length * step });
  });

  const groups: BeamGroup[] = [];
  let run: { slot: number; durationTicks: number }[] = [];

  const flush = () => {
    if (run.length >= 2) {
      /*
       * One beam count for the group, taken from its longest note.
       *
       * Real engraving draws partial beams where members differ; that is a
       * notation editor's job and this is a guide. Taking the longest is the
       * conservative choice: it never claims a note is shorter than it is.
       */
      const levels = Math.min(
        ...run.map((entry) => beamLevels(entry.durationTicks, resolution)),
      );
      if (levels > 0) {
        groups.push({ slots: run.map((entry) => entry.slot), levels, triplet });
      }
    }
    run = [];
  };

  for (const onset of onsets) {
    const previous = run[run.length - 1];
    const sameBeat =
      previous !== undefined && beatOf(previous.slot) === beatOf(onset.slot);
    /*
     * A gap ends the run as surely as a beat line does. `previous.slot +
     * previous slots` is where the previous note stopped sounding; anything
     * after that is silence, and a beam may not be drawn over silence.
     */
    const contiguous =
      previous !== undefined &&
      previous.slot + previous.durationTicks / step === onset.slot;

    if (!sameBeat || !contiguous) flush();
    run.push(onset);
  }
  flush();

  return { groups, beats };
}

/** What a screen reader is told about one group (spec 13.20 §7). */
export function rhythmGroupLabel(group: BeamGroup): string {
  const value = group.levels === 1 ? "1/8" : group.levels === 2 ? "1/16" : "1/32";
  const triplet = group.triplet ? " üçleme" : "";
  return `Ritim grubu: ${group.slots.length} nota, ${value}${triplet}`;
}

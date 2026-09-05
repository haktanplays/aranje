/**
 * A meter and a grid, said in words someone can count (spec 13.20 §4, 2N-A).
 *
 * "4/4 · 1/16" is exact and it is also the private vocabulary of people who
 * already read music. Someone who plays by ear can see four beats in a bar and
 * sixteen places to put a note; they simply have no reason to know that the
 * second of those is written "1/16". So both readings are produced here, from
 * one function, and the screen shows them together:
 *
 *     4 ana vuruş · 16 adım
 *     4/4 · 1/16
 *
 * The technical line is never removed. A reader who is learning the notation
 * needs to see the two next to each other, and a reader who already knows it
 * would find its absence patronising.
 *
 * ## Beats and steps are different things
 *
 * A **beat** is what a foot taps. A **step** is a place on the grid where a
 * note can be written. They coincide only at 1/4 in x/4, and the whole point
 * of the plain reading is that they are not the same: "16 vuruş" would tell
 * someone their bar has sixteen beats in it, which is not true of any bar this
 * product can make.
 *
 * ## Where the beat count comes from
 *
 * From the bar's own feel (2V-D.2 §12), through `meterBeats`. 6/8 reads two
 * beats, 7/8 felt `2+2+3` reads three, and both come from the same list the
 * metronome clicks and the beat lines are drawn from — one answer, not three
 * that agree until they do not.
 *
 * This module used to say, correctly for its time, that 7/8 had no honest
 * beat count and describe the bar as "7 sekizlik · 14 adım" instead. The
 * Song Contract has a grouping field now, so the honest answer exists; a bar
 * that does not carry one gets the metre's ordinary feel, which the reader
 * can see and change rather than a number this file invented.
 */
import { meterBeats } from "@/lib/music/meter-beats";
import type { BeatGrouping } from "@/lib/music/rhythm-profile";
import {
  formatTimeSignature,
  resolutionLabel,
  slotCount,
  slotsPerFeltBeat,
  type OfferedResolution,
  type Resolution,
  type TimeSignature,
} from "@/lib/music/timing";

export type RhythmReading = {
  /** How many main beats the bar has. */
  readonly count: number;
  /** What to call them. Always "ana vuruş" — every metre has them now. */
  readonly unit: string;
  /** Places a note can be written in the bar. */
  readonly steps: number;
  /** True when the beats are all the same length. False in 5/8, 7/8, 9/8. */
  readonly evenBeats: boolean;
  /** "4 ana vuruş · 16 adım" */
  readonly plain: string;
  /** "4/4 · 1/16" */
  readonly technical: string;
};

/** True when every beat of this metre is the same length. */
export function hasEvenBeats(
  timeSignature: TimeSignature,
  resolution: Resolution,
  grouping?: BeatGrouping,
): boolean {
  const beats = meterBeats({ meter: timeSignature, resolution, grouping });
  return new Set(beats.map((beat) => beat.slots)).size <= 1;
}

export function readRhythm(
  timeSignature: TimeSignature,
  resolution: Resolution,
  grouping?: BeatGrouping,
): RhythmReading {
  const steps = slotCount(timeSignature, resolution);
  /*
   * The count is the number of beats the bar is actually felt in, and it
   * comes from the one list that answers that: at 1/16 in 6/8 there are
   * twelve steps and two beats, and in 7/8 felt `2+2+3` there are fourteen
   * steps and three.
   */
  const beats = meterBeats({ meter: timeSignature, resolution, grouping });
  const count = Math.max(1, beats.length);

  return {
    count,
    unit: "ana vuruş",
    steps,
    evenBeats: new Set(beats.map((beat) => beat.slots)).size <= 1,
    plain: `${count} ana vuruş · ${steps} adım`,
    technical: `${formatTimeSignature(timeSignature)} · ${resolutionLabel(resolution)}`,
  };
}

/** Both lines, for a control that has room for one string. */
export function rhythmSummary(
  timeSignature: TimeSignature,
  resolution: Resolution,
  grouping?: BeatGrouping,
): string {
  const reading = readRhythm(timeSignature, resolution, grouping);
  return `${reading.plain} (${reading.technical})`;
}

/**
 * The grid, said as a grid (2T §3.1).
 *
 * `readRhythm` describes a *bar*: how many beats it has and how many places
 * there are to write in it. That is the right thing under a bar and the wrong
 * thing beside a grid control, where the question is not "how big is this
 * bar" but "how finely am I writing".
 *
 * The founder read "1/16" beside "4/4" and "132 BPM" and asked why 1/16 was
 * not making the tempo 4/4 — which is not a gap in their musical knowledge,
 * it is three numbers on one screen with nothing saying they answer different
 * questions. So this says the one thing that separates them:
 *
 *     Izgara: 16'lık · Her vuruşta 4 adım
 *
 * The meter is the bar's shape, the BPM is how fast the beat goes, and the
 * grid is how finely a beat is divided. Only the third is what this control
 * changes, and now it says so.
 */
export type GridReading = {
  /** "16'lık", "sekizlik triole" */
  readonly name: string;
  /** How many grid steps fall inside one felt beat. */
  readonly stepsPerBeat: number;
  /** "Izgara: 16'lık · Her vuruşta 4 adım" */
  readonly plain: string;
  /** "Izgara · 16'lık" — the chip's width; `plain` is what is read aloud. */
  readonly short: string;
  /** "1/16" — never removed, never the only thing shown. */
  readonly technical: string;
};

/** Beginner-first names for the grids, with the notation beside each. */
export const GRID_NAMES: Readonly<Record<OfferedResolution, string>> = {
  4: "Vuruş",
  8: "Yarım vuruş",
  12: "Sekizlik triole",
  16: "Çeyrek vuruş",
  24: "On altılık triole",
  32: "Çok ince",
};

/** What each grid writes, in note values a reader can look up. */
export const GRID_VALUE_NAMES: Readonly<Record<OfferedResolution, string>> = {
  4: "dörtlük",
  8: "sekizlik",
  12: "sekizlik triole",
  16: "16'lık",
  24: "16'lık triole",
  32: "32'lik",
};

/**
 * What a reader is told about this bar's grid.
 *
 * The parameter is an **offered** grid on purpose (2V-B.4 Completion §5): a
 * bar stored on a lattice has no reading of its own, and a caller that handed
 * one straight in would be asking this to name a grid nobody counts. They ask
 * `readingResolution(bar)` first, and the type says so.
 */
export function readGrid(
  timeSignature: TimeSignature,
  resolution: OfferedResolution,
): GridReading {
  const stepsPerBeat = Math.round(
    slotCount(timeSignature, resolution) /
      Math.max(1, slotCount(timeSignature, resolution) / slotsPerFeltBeat(timeSignature, resolution)),
  );
  const name = GRID_VALUE_NAMES[resolution];
  return {
    name,
    stepsPerBeat,
    plain: `Izgara: ${name} · Her vuruşta ${stepsPerBeat} adım`,
    /*
     * The chip has room for the answer and not the explanation (2T-B §5), so
     * the short form is what is drawn and `plain` is what a screen reader is
     * given. Two forms of one sentence, never two different sentences.
     */
    short: `Izgara · ${name}`,
    technical: resolutionLabel(resolution),
  };
}

export type GridChoice = {
  readonly resolution: OfferedResolution;
  /** "Çeyrek vuruş" */
  readonly name: string;
  /** "1/16" */
  readonly technical: string;
  /** "Çeyrek vuruş — 1/16" */
  readonly label: string;
};

/**
 * The grid options a sheet offers, each carrying both names.
 *
 * The plain name first, because it is the one a reader who does not read
 * notation can act on; the notation second, because it is the one they will
 * meet everywhere else and hiding it would leave them unable to look anything
 * up. Neither is ever shown without the other.
 */
export function gridChoices(
  timeSignature: TimeSignature,
  /* Offered grids only: a picker never lists a lattice (§5). */
  available: readonly OfferedResolution[],
): readonly GridChoice[] {
  return available
    .filter((resolution) => {
      try {
        slotCount(timeSignature, resolution);
        return true;
      } catch {
        return false;
      }
    })
    .map((resolution) => ({
      resolution,
      name: GRID_NAMES[resolution],
      technical: resolutionLabel(resolution),
      label: `${GRID_NAMES[resolution]} — ${resolutionLabel(resolution)}`,
    }));
}

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
 * ## What is not invented
 *
 * In 7/8 there is no honest beat count. Whether it is felt 2+2+3, 3+2+2 or
 * 2+3+2 is a property of the music, and the Song Contract has no field for it
 * (spec 5.5) — so nothing here guesses. The bar is described in the unit it is
 * actually counted in: "7 sekizlik · 14 adım". 6/8 does have an answer, and it
 * comes from `slotsPerFeltBeat` in the timing core rather than from a rule
 * restated here, because "the beat in compound time is the dotted note" is
 * already that function's job.
 */
import {
  formatTimeSignature,
  resolutionLabel,
  slotCount,
  slotsPerFeltBeat,
  type Resolution,
  type TimeSignature,
} from "@/lib/music/timing";

export type RhythmReading = {
  /** How many of them: beats in a meter that has them, note values otherwise. */
  readonly count: number;
  /** What to call them: "ana vuruş", or the meter's own note value. */
  readonly unit: string;
  /** Places a note can be written in the bar. */
  readonly steps: number;
  /** True when the meter has a beat a foot can tap. */
  readonly hasFeltBeat: boolean;
  /** "4 ana vuruş · 16 adım" */
  readonly plain: string;
  /** "4/4 · 1/16" */
  readonly technical: string;
};

/**
 * The name of the note value a meter counts in, for the meters that have no
 * felt beat to offer instead.
 *
 * Only the denominators the contract allows are named. An unnamed one would
 * mean the meter table grew without this being looked at, and inventing a word
 * for it is worse than saying the number.
 */
const NOTE_VALUE_NAMES: Readonly<Record<number, string>> = {
  2: "ikilik",
  4: "dörtlük",
  8: "sekizlik",
  16: "onaltılık",
};

/** True when a foot has something to tap: x/4, and compound x/8. */
export function hasFeltBeat(timeSignature: readonly [number, number]): boolean {
  const [numerator, denominator] = timeSignature;
  if (denominator === 4) return true;
  return denominator === 8 && numerator % 3 === 0;
}

export function readRhythm(
  timeSignature: TimeSignature,
  resolution: Resolution,
): RhythmReading {
  const steps = slotCount(timeSignature, resolution);
  const felt = hasFeltBeat(timeSignature);

  /*
   * The count comes out of the grid arithmetic, not out of the meter's
   * numerator: at 1/16 in 6/8 there are twelve steps and two beats, and only
   * the timing core knows that the beat there is three eighths long.
   */
  const perBeat = slotsPerFeltBeat(timeSignature, resolution);
  const count = felt
    ? Math.round(steps / perBeat)
    : timeSignature[0];
  const unit = felt
    ? "ana vuruş"
    : (NOTE_VALUE_NAMES[timeSignature[1]] ?? `1/${timeSignature[1]}`);

  return {
    count,
    unit,
    steps,
    hasFeltBeat: felt,
    plain: `${count} ${unit} · ${steps} adım`,
    technical: `${formatTimeSignature(timeSignature)} · ${resolutionLabel(resolution)}`,
  };
}

/** Both lines, for a control that has room for one string. */
export function rhythmSummary(
  timeSignature: TimeSignature,
  resolution: Resolution,
): string {
  const reading = readRhythm(timeSignature, resolution);
  return `${reading.plain} (${reading.technical})`;
}

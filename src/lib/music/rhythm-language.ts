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
  /** "1/16" — never removed, never the only thing shown. */
  readonly technical: string;
};

/** Beginner-first names for the grids, with the notation beside each. */
export const GRID_NAMES: Readonly<Record<Resolution, string>> = {
  4: "Vuruş",
  8: "Yarım vuruş",
  12: "Sekizlik triole",
  16: "Çeyrek vuruş",
  24: "On altılık triole",
  32: "Çok ince",
};

/** What each grid writes, in note values a reader can look up. */
export const GRID_VALUE_NAMES: Readonly<Record<Resolution, string>> = {
  4: "dörtlük",
  8: "sekizlik",
  12: "sekizlik triole",
  16: "16'lık",
  24: "16'lık triole",
  32: "32'lik",
};

export function readGrid(
  timeSignature: TimeSignature,
  resolution: Resolution,
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
    technical: resolutionLabel(resolution),
  };
}

export type GridChoice = {
  readonly resolution: Resolution;
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
  available: readonly Resolution[],
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

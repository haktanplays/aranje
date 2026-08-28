/**
 * The written rhythm vocabulary, in exact ticks (2T §4).
 *
 * Until this file the app could *place* notes on a grid but could not *name*
 * what it had placed. A tab draws stems, beams, dots and tuplet brackets, and
 * every one of those is a claim about a note's written value — so something
 * has to be able to look at a duration in ticks and say "dotted eighth" or
 * "sixteenth triplet" or "this is not a single written value".
 *
 * ## Why ticks, and why they are exact
 *
 * `TICKS_PER_WHOLE` is 768, which is divisible by every value below:
 *
 *   whole 768 · half 384 · quarter 192 · eighth 96 · 16th 48 · 32nd 24
 *   dotted: ×3/2 — 576, 288, 144, 72, 36
 *   triplets: ×2/3 — eighth 64, 16th 32
 *
 * Every one is a whole number. Nothing here rounds, and nothing downstream
 * has to: a dotted sixteenth is 72 ticks, not 71.999. That is what makes
 * "float drift kabul edilmez" a property of the arithmetic rather than a
 * promise about how carefully it is used.
 *
 * ## What is deliberately not modelled
 *
 * A value that is not one of these — five sixteenths, say — is not a written
 * note value at all; it is a tie between two of them. `noteValueOf` returns
 * null for it rather than picking the nearest, because rounding a duration to
 * something a stem can draw is how a score starts lying about the music.
 * `splitIntoValues` is the honest answer: the list of values that tie together
 * to make it.
 */
import { TICKS_PER_WHOLE } from "@/lib/music/timing";

/** The undotted, untupleted values, longest first. */
export const BASE_VALUES = ["whole", "half", "quarter", "eighth", "16th", "32nd"] as const;

export type BaseValue = (typeof BASE_VALUES)[number];

/** How a value is stretched or squeezed away from its plain form. */
export type ValueModifier = "plain" | "dotted" | "triplet";

export type NoteValue = {
  readonly base: BaseValue;
  readonly modifier: ValueModifier;
  readonly ticks: number;
};

/** Ticks in the plain form of each base value. */
export const BASE_TICKS: Readonly<Record<BaseValue, number>> = {
  whole: TICKS_PER_WHOLE,
  half: TICKS_PER_WHOLE / 2,
  quarter: TICKS_PER_WHOLE / 4,
  eighth: TICKS_PER_WHOLE / 8,
  "16th": TICKS_PER_WHOLE / 16,
  "32nd": TICKS_PER_WHOLE / 32,
};

/**
 * How many beams a value carries, which is what the tab actually draws.
 *
 * A dot does not change the beam count and neither does a tuplet: a dotted
 * eighth is still one beam, and a sixteenth triplet is still two. The dot and
 * the bracket are drawn beside the beams, not instead of them.
 */
export const BEAMS: Readonly<Record<BaseValue, number>> = {
  whole: 0,
  half: 0,
  quarter: 0,
  eighth: 1,
  "16th": 2,
  "32nd": 3,
};

/** A whole and a half have no stem to hang a beam from. */
export function hasStem(base: BaseValue): boolean {
  return base !== "whole";
}

function ticksOf(base: BaseValue, modifier: ValueModifier): number {
  const plain = BASE_TICKS[base];
  if (modifier === "dotted") return (plain * 3) / 2;
  if (modifier === "triplet") return (plain * 2) / 3;
  return plain;
}

/**
 * Every value the vocabulary can write, longest first.
 *
 * Triplets stop at the eighth because the grids do: 12 and 24 are the eighth
 * and sixteenth triplet grids, and there is no 48. A triplet finer than that
 * would be a value nothing could place.
 */
export const NOTE_VALUES: readonly NoteValue[] = BASE_VALUES.flatMap((base) =>
  (["plain", "dotted", "triplet"] as const)
    .filter((modifier) => {
      if (modifier !== "triplet") return true;
      return base === "eighth" || base === "16th";
    })
    .map((modifier) => ({ base, modifier, ticks: ticksOf(base, modifier) })),
)
  .filter((value) => Number.isInteger(value.ticks))
  .sort((a, b) => b.ticks - a.ticks);

/**
 * The single written value of a duration, or null when it has none.
 *
 * Null is a real answer and the common one for tied music. A caller that
 * wants something drawable for every duration asks `splitIntoValues`.
 */
export function noteValueOf(ticks: number): NoteValue | null {
  if (!Number.isInteger(ticks) || ticks <= 0) return null;
  return NOTE_VALUES.find((value) => value.ticks === ticks) ?? null;
}

/**
 * The values a duration ties together, longest first.
 *
 * Greedy from the longest value down, which is what a copyist does and what
 * produces the conventional reading: a five-sixteenth note is a quarter tied
 * to a sixteenth, not five sixteenths in a row.
 *
 * Returns an empty list for a duration no combination can reach — which,
 * given a 32nd is the shortest value, means anything not a multiple of 24
 * ticks. Those exist (a 16th triplet is 32) so the search is not a simple
 * division; it is a walk over the vocabulary.
 */
export function splitIntoValues(ticks: number): readonly NoteValue[] {
  if (!Number.isInteger(ticks) || ticks <= 0) return [];
  const parts: NoteValue[] = [];
  let left = ticks;
  while (left > 0) {
    const next = NOTE_VALUES.find((value) => value.ticks <= left);
    if (!next) return [];
    parts.push(next);
    left -= next.ticks;
  }
  return parts;
}

/** "Noktalı sekizlik", for a reader rather than for a stem. */
export function valueLabel(value: NoteValue): string {
  const name: Readonly<Record<BaseValue, string>> = {
    whole: "birlik",
    half: "ikilik",
    quarter: "dörtlük",
    eighth: "sekizlik",
    "16th": "on altılık",
    "32nd": "otuz ikilik",
  };
  if (value.modifier === "dotted") return `noktalı ${name[value.base]}`;
  if (value.modifier === "triplet") return `${name[value.base]} triole`;
  return name[value.base];
}

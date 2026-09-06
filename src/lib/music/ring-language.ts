/**
 * "Ne kadar çınlasın?" — how long a note rings, in this bar's own beat
 * (2V-D.2 §7, §8).
 *
 * ## The sentence that was wrong in 6/8
 *
 * `duration-language.ts` already asks a beginner for a verb rather than a
 * note value, and that stays. What it could not do is name the beat: its
 * technical reading is built from `PPQ * 4 / ticks`, which spells a quarter
 * and a sixteenth and has no word for a **dotted** quarter. So in 6/8 — where
 * the beat a foot taps *is* the dotted quarter — the app could say "1 vuruş"
 * and could not say what that beat was, and anything that hardcoded
 * "1/4 = 1 vuruş" was simply wrong there.
 *
 * Every label here is therefore derived from the bar's own beat unit, taken
 * from `meterBeats`. In 4/4 a beat is a quarter and the option reads
 * "Bir ana vuruş — dörtlük"; in 6/8 the same option reads "Bir ana vuruş —
 * noktalı dörtlük", because that is what one beat of a 6/8 is. Nothing in
 * this file knows the number 4.
 *
 * ## Three questions, three rows, never one control
 *
 * §8's rule, and the reason `RingQuestion` is one of three ids rather than a
 * single list of everything a note can be asked:
 *
 * - **`ring`** — how long this note sounds. What this module answers.
 * - **`spacing`** — when the *next* note starts. A separate, advanced
 *   question; by default the next onset follows the duration, and a reader
 *   who never opens it never meets it.
 * - **`connection`** — what joins this note to the one before it. Hammer-on,
 *   pull-off, slide, bend, vibrato live here and **never** in the ring
 *   picker, because "1/4" in a slide row read as "slide over four beats" and
 *   that misreading is what the split exists to prevent.
 *
 * A caller that renders these in one row is contradicted by
 * `RING_QUESTION`'s own text; a caller that puts a technique in the ring list
 * is contradicted by `ringOptions` never producing one.
 */
import { meterBeats } from "@/lib/music/meter-beats";
import { noteValueOf, valueLabel } from "@/lib/music/note-value";
import type { BeatGrouping } from "@/lib/music/rhythm-profile";
import {
  ticksPerSlot,
  type Resolution,
  type TimeSignature,
} from "@/lib/music/timing";

export const RING_QUESTION_IDS = ["ring", "spacing", "connection"] as const;

export type RingQuestionId = (typeof RING_QUESTION_IDS)[number];

export type RingQuestion = {
  readonly id: RingQuestionId;
  /** The heading of its own row. Three rows, three headings. */
  readonly question: string;
  /** One line under it. */
  readonly hint: string;
  /** True for the one row a beginner is shown by default. */
  readonly primary: boolean;
};

/**
 * The three rows, in the order they are read.
 *
 * `spacing` is not hidden, it is *second* and it is marked as the advanced
 * one — a reader who wants a note to ring past the next attack has a real
 * musical reason and should be able to find it without being told to.
 */
export const RING_QUESTIONS: readonly RingQuestion[] = [
  {
    id: "ring",
    question: "Ne kadar çınlasın?",
    hint: "Bu notanın sesi ne kadar sürsün.",
    primary: true,
  },
  {
    id: "spacing",
    question: "Sonraki nota ne zaman gelsin?",
    hint: "Normalde bu notanın süresi kadar sonra. Değiştirmek isteğe bağlı.",
    primary: false,
  },
  {
    id: "connection",
    question: "Önceki notaya nasıl bağlansın?",
    hint: "Bağlama, kaydırma, büküm. Süreyle ilgisi yok.",
    primary: false,
  },
];

export function ringQuestion(id: RingQuestionId): RingQuestion {
  const found = RING_QUESTIONS.find((question) => question.id === id);
  if (!found) throw new Error(`unknown ring question: ${id}`);
  return found;
}

export type RingOption = {
  /** Stable across metres, so a caller can remember a preference. */
  readonly id: string;
  /** The first line: what a player would say. Never a fraction. */
  readonly label: string;
  /**
   * The second line: the exact note value, when this length has a name.
   *
   * Null when it does not — a length of five sixteenths is real, playable and
   * has no single written value, and inventing one would be worse than a
   * blank second line.
   */
  readonly value: string | null;
  readonly ticks: number;
};

/** What the bar being written in is, for the options to be derived from. */
export type RingContext = {
  readonly meter: TimeSignature;
  readonly resolution: Resolution;
  readonly grouping?: BeatGrouping;
};

/**
 * How long one main beat of this bar lasts, in ticks.
 *
 * The **first** beat's length, not an average: in a 7/8 felt `2+2+3` the
 * beats differ, and "one beat" on a picker has to mean something a reader can
 * point at. The first is the one they count from.
 */
export function mainBeatTicks(context: RingContext): number {
  const beats = meterBeats(context);
  const first = beats[0];
  if (!first) return ticksPerSlot(context.resolution);
  return first.slots * ticksPerSlot(context.resolution);
}

/** The written name of a length, or null when it has no single one. */
export function lengthName(ticks: number): string | null {
  const value = noteValueOf(ticks);
  return value ? valueLabel(value) : null;
}

/**
 * The ring lengths on offer, longest first, in this bar's own beat.
 *
 * Multiples and divisions of the **main beat**, so every label is something
 * a player counts. A beginner in 6/8 is offered half a beat and one beat and
 * two beats, and the second lines read "noktalı sekizlik", "noktalı dörtlük"
 * and "noktalı yarım" — none of which this file spelled out, and all of which
 * are exactly right.
 *
 * Fractional results are dropped rather than rounded. A third of a beat in
 * 4/4 is 64 ticks and real; a third of a beat in a metre whose beat is not
 * divisible by three is not a tick and is not offered.
 */
export function ringOptions(context: RingContext): readonly RingOption[] {
  const beat = mainBeatTicks(context);
  const candidates: { id: string; label: string; ticks: number }[] = [
    { id: "four_beats", label: "Dört ana vuruş", ticks: beat * 4 },
    { id: "two_beats", label: "İki ana vuruş", ticks: beat * 2 },
    { id: "one_beat", label: "Bir ana vuruş", ticks: beat },
    { id: "half_beat", label: "Yarım ana vuruş", ticks: beat / 2 },
    { id: "third_beat", label: "Vuruşun üçte biri", ticks: beat / 3 },
    { id: "quarter_beat", label: "Vuruşun dörtte biri", ticks: beat / 4 },
  ];

  return candidates
    .filter((candidate) => Number.isInteger(candidate.ticks) && candidate.ticks > 0)
    .map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
      value: lengthName(candidate.ticks),
      ticks: candidate.ticks,
    }));
}

/**
 * The two lines for one length, as the panel shows them.
 *
 * Always two, never one string with a separator in it: the panel puts them on
 * different lines at different weights, and a caller that joined them would
 * be making a layout decision inside a language module.
 */
export function ringReading(
  ticks: number,
  context: RingContext,
): { readonly label: string; readonly value: string | null } {
  const beat = mainBeatTicks(context);
  const beats = beat > 0 ? ticks / beat : 0;
  const label =
    beats === 1
      ? "Bir ana vuruş"
      : beats === 0.5
        ? "Yarım ana vuruş"
        : Number.isInteger(beats)
          ? `${beats} ana vuruş`
          : `${beats.toFixed(2)} ana vuruş`;
  return { label, value: lengthName(ticks) };
}

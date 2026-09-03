/**
 * A fast run of notes inside a time the reader already has (2V-B.3, "Hızlı dizi").
 *
 * ## Three things that are not the same thing
 *
 * The founder's reference is a `9–10–9` played faster than the notes around
 * it, and getting it right depends entirely on not confusing three separate
 * facts about it:
 *
 * - `9 → 10 → 9` is a **pitch sequence**: which frets, in which order.
 * - hammer-on and pull-off are a **performance connection**: how the notes are
 *   joined by the left hand.
 * - being faster is **local rhythm density**: more onsets inside the same
 *   interval of musical time.
 *
 * They are independent. A hammer-on does not make anything faster; a fast run
 * does not have to be slurred. This module produces the third one — onsets and
 * durations inside a span that does not change — and says which connection the
 * fretboard implies, so the two can be chosen separately.
 *
 * ## What must not move
 *
 * The span. Everything here divides an interval the caller already owns: the
 * measure does not lengthen, the following note keeps its tick, the phrase
 * boundary does not change, and the bar's own grid is a question for
 * `rhythm-availability`, not for this file. Musical time is fixed; only the
 * density inside it goes up.
 *
 * ## Not a special case for one riff
 *
 * `9–10–9` is the acceptance fixture, not the feature. What is implemented is
 * sequence insertion of *n* notes into a span — two, three or four, any frets,
 * on any string — and the fixture is one input to it.
 */

/** How a sequence decides how much time it gets. */
export const SEQUENCE_SPANS = ["next_note", "half_beat", "beat"] as const;
export type SequenceSpan = (typeof SEQUENCE_SPANS)[number];

export const SEQUENCE_SPAN_LABELS: Readonly<Record<SequenceSpan, string>> = {
  next_note: "Sonraki notaya kadar",
  half_beat: "Yarım vuruşa sığdır",
  beat: "Bir vuruşa sığdır",
};

/** How it is played. Two words, no technique jargon. */
export const SEQUENCE_PERFORMANCE = ["separate", "connected"] as const;
export type SequencePerformance = (typeof SEQUENCE_PERFORMANCE)[number];

export const SEQUENCE_PERFORMANCE_LABELS: Readonly<
  Record<SequencePerformance, string>
> = {
  separate: "Tek tek çal",
  connected: "Bağlı çal",
};

/** How many notes the flow offers. Two, three, four — and no free number. */
export const SEQUENCE_COUNTS = [2, 3, 4] as const;
export type SequenceCount = (typeof SEQUENCE_COUNTS)[number];

/** One step of the sequence, on the fretboard the reader is looking at. */
export type SequenceStep = {
  readonly stringIndex: number;
  readonly fret: number;
};

/**
 * What joining two steps would mean on a guitar.
 *
 * Derived, never guessed. On one string a higher fret is a hammer-on and a
 * lower fret is a pull-off — that is not a preference, it is what the left
 * hand does. Anything else has no single answer, and the flow says so in a
 * sentence rather than picking one.
 */
export type StepConnection = "hammer_on" | "pull_off" | "ambiguous";

export function connectionBetween(
  from: SequenceStep,
  to: SequenceStep,
): StepConnection {
  if (from.stringIndex !== to.stringIndex) return "ambiguous";
  if (to.fret > from.fret) return "hammer_on";
  if (to.fret < from.fret) return "pull_off";
  return "ambiguous";
}

/** Why a connection could not be decided, in the reader's own words. */
export const AMBIGUOUS_CONNECTION_TEXT =
  "Aynı perde ya da farklı tel: burada bağlamanın ne olacağı tek bir cevaba inmiyor, onu sen seçmelisin.";

/**
 * The one-line explanation shown while the sequence is being made.
 *
 * The rule it is there to teach is the one this whole feature rests on, and it
 * is one sentence rather than two technical panels: the time does not grow,
 * the notes get closer together.
 */
export function densityExplanation(count: number): string {
  return `Aynı süreye ${count} nota sığar; ölçünün uzunluğu değişmez.`;
}

/** One note of the planned sequence, in the atomic terms the Song uses. */
export type SequenceNote = {
  /** Ticks from the start of the section. Explicit, never implied by a slot. */
  readonly timeTicks: number;
  /** This note's own length. Explicit, so nothing has to infer it. */
  readonly durationTicks: number;
  readonly stringIndex: number;
  readonly fret: number;
  /**
   * The connection *into* this note, when the reader asked for one.
   *
   * On the first note it is always absent: something has to be struck for
   * anything to be slurred to. That is also what makes the playback claim
   * true — a picking attack on the first note only, and the existing
   * expression path for the rest.
   */
  readonly connection?: Exclude<StepConnection, "ambiguous">;
};

export type SequencePlan = {
  readonly notes: readonly SequenceNote[];
  /** The interval the sequence occupies. Equal to the span it was given. */
  readonly startTicks: number;
  readonly spanTicks: number;
  /** The shortest note in the plan: what `rhythm-availability` is asked about. */
  readonly stepTicks: number;
  /**
   * Set when "Bağlı çal" was asked for and the fretboard could not answer.
   *
   * The plan is still returned, unconnected: the reader hears the run and is
   * shown the sentence, rather than being handed a refusal or a guess.
   */
  readonly ambiguousAt: readonly number[];
};

export type SequencePlanResult =
  | { readonly ok: true; readonly plan: SequencePlan }
  | { readonly ok: false; readonly reason: SequenceRefusal };

export type SequenceRefusal =
  | "no_span"
  | "too_few_steps"
  | "uneven_span"
  | "span_too_short";

/**
 * The shortest note this app will place, in ticks.
 *
 * A 1/32 at PPQ 192 is 24 ticks and is the finest grid the schema has. Below
 * it there is no grid to write on, so a plan that asked for one would be a
 * promise the format cannot keep.
 */
export const MIN_STEP_TICKS = 24;

/**
 * Divide a span into equal notes.
 *
 * Equal by default and by design in this round: unequal timing inside a
 * sequence is a Pro concern and belongs under "Ayrıntılar", not in a beginner
 * flow whose entire promise is "listen and apply".
 */
export function planNoteSequence(input: {
  readonly startTicks: number;
  readonly spanTicks: number;
  readonly steps: readonly SequenceStep[];
  readonly performance: SequencePerformance;
}): SequencePlanResult {
  const { performance, spanTicks, startTicks, steps } = input;
  if (spanTicks <= 0) return { ok: false, reason: "no_span" };
  if (steps.length < 2) return { ok: false, reason: "too_few_steps" };
  if (spanTicks % steps.length !== 0) return { ok: false, reason: "uneven_span" };

  const stepTicks = spanTicks / steps.length;
  if (stepTicks < MIN_STEP_TICKS) return { ok: false, reason: "span_too_short" };

  const ambiguousAt: number[] = [];
  const notes = steps.map((step, index) => {
    const previous = steps[index - 1];
    const connection =
      performance === "connected" && previous
        ? connectionBetween(previous, step)
        : null;
    if (connection === "ambiguous") ambiguousAt.push(index);
    return {
      timeTicks: startTicks + index * stepTicks,
      durationTicks: stepTicks,
      stringIndex: step.stringIndex,
      fret: step.fret,
      ...(connection === "hammer_on" || connection === "pull_off"
        ? { connection }
        : {}),
    };
  });

  return {
    ok: true,
    plan: { notes, startTicks, spanTicks, stepTicks, ambiguousAt },
  };
}

/**
 * How much time a chosen span option is worth, in ticks.
 *
 * `next_note` is the only one that needs the music: it is the distance to
 * whatever comes next, which is exactly the interval the reader pointed at.
 */
export function spanTicksFor(input: {
  readonly span: SequenceSpan;
  readonly beatTicks: number;
  readonly toNextNoteTicks: number | null;
}): number | null {
  const { beatTicks, span, toNextNoteTicks } = input;
  if (span === "beat") return beatTicks;
  if (span === "half_beat") return beatTicks % 2 === 0 ? beatTicks / 2 : null;
  return toNextNoteTicks !== null && toNextNoteTicks > 0 ? toNextNoteTicks : null;
}

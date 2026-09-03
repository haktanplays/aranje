/**
 * Grid, measure, phrase and selection — four things, said apart (2V-B.3 §13).
 *
 * The app had been using one word for several of these, and the confusion is
 * not cosmetic. It is why a musical idea could be treated as ending where the
 * screen ended:
 *
 * - **Grid** — the window of time currently on the screen. A camera position.
 *   It has no musical meaning at all and changes when the reader scrolls.
 * - **Measure** — the meter's division of time. Musical, fixed, and the thing
 *   bar lines are drawn for.
 * - **Phrase** — a stretch of music that is one idea. It may be shorter than a
 *   measure, longer than a measure, and longer than the screen.
 * - **Selection** — a temporary tick range the reader is holding. It is not a
 *   phrase, it does not have to line up with one, and it may cross one.
 *
 * The rule that follows, and the reason this file exists: **a phrase is never
 * split or rewritten at a grid boundary.** What the renderer gets when a
 * phrase runs off the screen is not two phrases; it is one phrase and a mark
 * saying it carries on.
 *
 * ## Not a phrase editor
 *
 * There is no UI here and none is asked for this round. What is here is the
 * model and the interval helpers a renderer needs, so that the assumption
 * "grid = phrase" has nowhere left to live.
 */
import type { Phrase } from "@/lib/song/schema";

/** A window of musical time, in section ticks. `to` is exclusive. */
export type TickWindow = {
  readonly fromTicks: number;
  readonly toTicks: number;
};

/**
 * What a renderer draws for one phrase inside one window.
 *
 * The identity is the phrase's, not the fragment's: two fragments of the same
 * phrase carry the same `phraseId` and the same `phraseStartTicks`. That is
 * what makes "this is the same idea, continued" expressible rather than a
 * coincidence of two adjacent boxes.
 */
export type PhraseFragment = {
  readonly phraseId: string;
  readonly name?: string;
  /** The phrase's own range, unclipped — the thing that never changes. */
  readonly phraseStartTicks: number;
  readonly phraseEndTicks: number;
  /** The part of it inside this window. */
  readonly fromTicks: number;
  readonly toTicks: number;
  /** It began before this window: draw an opening continuation mark. */
  readonly continuesBefore: boolean;
  /** It goes on past this window: draw a closing one. */
  readonly continuesAfter: boolean;
};

const overlaps = (phrase: Phrase, window: TickWindow): boolean =>
  phrase.startTicks < window.toTicks && phrase.endTicks > window.fromTicks;

/**
 * The phrases visible in a window, clipped for drawing and marked for reading.
 *
 * Clipping is a *rendering* fact and is confined to `fromTicks`/`toTicks`. The
 * phrase's own range travels with the fragment untouched, so nothing
 * downstream can mistake "the part I can see" for "the phrase".
 */
export function phraseFragments(
  phrases: readonly Phrase[] | undefined,
  window: TickWindow,
): PhraseFragment[] {
  if (!phrases || window.toTicks <= window.fromTicks) return [];
  return phrases
    .filter((phrase) => overlaps(phrase, window))
    .sort((left, right) => left.startTicks - right.startTicks)
    .map((phrase) => ({
      phraseId: phrase.id,
      ...(phrase.name === undefined ? {} : { name: phrase.name }),
      phraseStartTicks: phrase.startTicks,
      phraseEndTicks: phrase.endTicks,
      fromTicks: Math.max(phrase.startTicks, window.fromTicks),
      toTicks: Math.min(phrase.endTicks, window.toTicks),
      continuesBefore: phrase.startTicks < window.fromTicks,
      continuesAfter: phrase.endTicks > window.toTicks,
    }));
}

/** The phrase a moment belongs to, or null. Half-open, like every range here. */
export function phraseAt(
  phrases: readonly Phrase[] | undefined,
  ticks: number,
): Phrase | null {
  return (
    phrases?.find((phrase) => ticks >= phrase.startTicks && ticks < phrase.endTicks) ??
    null
  );
}

/**
 * How many measures a phrase touches, given where the bar lines are.
 *
 * The answer is allowed to be more than one, and that is the whole point: a
 * model in which it could not would be a model in which a phrase is a measure
 * wearing a different name.
 */
export function measuresTouched(
  phrase: Phrase,
  barStartTicks: readonly number[],
  totalTicks: number,
): number {
  let count = 0;
  for (const [index, start] of barStartTicks.entries()) {
    const end = barStartTicks[index + 1] ?? totalTicks;
    if (phrase.startTicks < end && phrase.endTicks > start) count += 1;
  }
  return count;
}

/**
 * Does a range cross out of the phrase it starts in?
 *
 * Asked so that a selection *may* — the reader is allowed to hold music across
 * a phrase boundary, and something that silently clamped it to one phrase
 * would be deciding what they meant. What this is for is telling them.
 */
export function crossesPhraseBoundary(
  phrases: readonly Phrase[] | undefined,
  range: TickWindow,
): boolean {
  const start = phraseAt(phrases, range.fromTicks);
  const last = phraseAt(phrases, Math.max(range.fromTicks, range.toTicks - 1));
  if (start === null && last === null) return false;
  return start?.id !== last?.id;
}

/** Two phrases that overlap are a contradiction; this is how a caller asks. */
export function overlappingPhrases(phrases: readonly Phrase[]): boolean {
  const sorted = [...phrases].sort((left, right) => left.startTicks - right.startTicks);
  return sorted.some((phrase, index) => {
    const next = sorted[index + 1];
    return next !== undefined && next.startTicks < phrase.endTicks;
  });
}

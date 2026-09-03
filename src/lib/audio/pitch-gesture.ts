/**
 * What a bend or a written slide does to the pitch, in production (2V-C.1 §5, §6).
 *
 * ## Why this file exists rather than a second copy of the eval one
 *
 * The four bend shapes and the four slide shapes were measured under
 * `eval/expression-benchmark` before anybody committed to them. That code
 * called the production planner's own stage maths, but it lived outside the
 * app and nothing shippable could reach it. Moving it here — and having the
 * benchmark import *this* — is what keeps the thing that was listened to and
 * the thing that ships the same function. There is no second scheduler and no
 * second synth: this produces `PitchPoint[]` for the voice pool the app
 * already has.
 *
 * ## The four bends differ in two places and share everything else
 *
 * Where the pitch starts, and whether it comes back. That is the whole of it,
 * which is why one function answers all four instead of four functions
 * drifting apart:
 *
 * - `bend` rises to the target and **stays there**. The note ends bent.
 * - `bend_release` rises, holds, and returns to the written pitch.
 * - `prebend` is already at the target when the string is struck: no rise to
 *   hear, because the hand did the work before the pick did.
 * - `prebend_release` starts bent and comes down.
 *
 * The target is exact. A half bend arrives at +100 cents and a full one at
 * +200, never at 97 or 205, because the corners are the numbers and only the
 * shape between them is eased.
 *
 * ## Vibrato on a bend is part of the bend
 *
 * It is not a second gesture layered on: a hand arrives at the target and
 * *then* shakes, and a model that let the two be independent could express
 * "shake first, then arrive", which no hand does. So it is a field inside the
 * bend and it starts after the target is reached.
 *
 * ## Legacy is not routed through here
 *
 * `bend_half` / `bend_full` written before this contract keep calling
 * `bendAutomation`, untouched. This file is only ever reached by a note that
 * carries an explicit `pitchGesture`.
 */
import { bendStages, type PitchPoint } from "@/lib/audio/automation";
import { desiredGlideSeconds, transitionPoints } from "@/lib/audio/legato-chain";
import { expressionPresets } from "@/lib/audio/expression";
import type { BendGesture, PitchGesture } from "@/lib/song/schema";

const round = (value: number): number => Math.round(value * 1e6) / 1e6;

const CENTS_PER_SEMITONE = 100;

/** How far a slide-in starts from, and a slide-out ends at, by default. */
export const DEFAULT_SLIDE_IN_SEMITONES = 2;
export const DEFAULT_SLIDE_OUT_SEMITONES = 3;

/** The share of the note a written slide-in or slide-out may occupy. */
const OPEN_SLIDE_MAX_FRACTION = 0.4;

/** Fast away from the start, controlled as it arrives. */
const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

/** Gentle at both ends, so the return does not snap. */
const easeInOut = (t: number): number =>
  t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);

/** True when the string is already bent at the moment it is struck. */
export function startsBent(kind: BendGesture["kind"]): boolean {
  return kind === "prebend" || kind === "prebend_release";
}

/** True when the pitch comes back to where it was written. */
export function returnsToWritten(kind: BendGesture["kind"]): boolean {
  return kind === "bend_release" || kind === "prebend_release";
}

/**
 * The pitch of a bend across a note of this length.
 *
 * `timeScale` is the practice-speed factor: at half speed the gesture is
 * twice as long in real time, so its floors and ceilings stretch with it.
 */
export function bendGestureAutomation(
  gesture: BendGesture,
  durationSeconds: number,
  options: { readonly timeScale?: number } = {},
): PitchPoint[] {
  const timeScale = options.timeScale ?? 1;
  const preset = expressionPresets.bend;
  const stages = bendStages(durationSeconds, timeScale);
  const target = gesture.targetCents;
  const points: PitchPoint[] = [];

  if (startsBent(gesture.kind)) {
    points.push({ timeSeconds: 0, cents: target, curve: "step" });
  } else {
    points.push({ timeSeconds: 0, cents: 0, curve: "step" });
    if (stages.settleSeconds > 0) {
      points.push({
        timeSeconds: round(stages.settleSeconds),
        cents: 0,
        curve: "linear",
      });
    }
    for (let step = 1; step <= preset.curvePoints; step += 1) {
      const t = step / preset.curvePoints;
      points.push({
        timeSeconds: round(stages.settleSeconds + stages.riseSeconds * t),
        cents: round(target * easeOut(t)),
        curve: "linear",
      });
    }
  }

  const reachedAt = startsBent(gesture.kind) ? 0 : stages.reachedAtSeconds;
  const releaseSeconds = returnsToWritten(gesture.kind) ? stages.releaseSeconds : 0;
  /*
   * Where the hold ends. Never before the target is reached: on a note too
   * short to hold anything, this collapses to the arrival rather than going
   * negative and writing automation backwards.
   */
  const holdEnd = Math.max(reachedAt, durationSeconds - releaseSeconds);

  if (gesture.vibrato && holdEnd > reachedAt) {
    const { depthCents, rateHz } = gesture.vibrato;
    const delay = preset.top.startDelaySeconds * timeScale;
    const from = reachedAt + delay;
    if (from < holdEnd) {
      points.push({ timeSeconds: round(from), cents: target, curve: "linear" });
      const step = 1 / (rateHz * preset.top.pointsPerCycle * (1 / timeScale));
      for (let time = step; time <= holdEnd - from + 1e-9; time += step) {
        points.push({
          timeSeconds: round(from + time),
          cents: round(
            target + depthCents * Math.sin((2 * Math.PI * rateHz * time) / timeScale),
          ),
          curve: "sine",
        });
      }
    }
  }

  points.push({ timeSeconds: round(holdEnd), cents: target, curve: "linear" });

  if (returnsToWritten(gesture.kind)) {
    for (let step = 1; step <= preset.curvePoints; step += 1) {
      const t = step / preset.curvePoints;
      points.push({
        timeSeconds: round(holdEnd + releaseSeconds * t),
        cents: round(target * (1 - easeInOut(t))),
        curve: "linear",
      });
    }
  }

  return points;
}

/**
 * The pitch of a slide into or out of a note that has no written partner.
 *
 * The distance is approximate on purpose. A slide-in from below is a hand
 * starting somewhere lower, not a fret the player wrote down, and inventing
 * that fret would put a note on the staff nobody played.
 */
export function openSlideAutomation(
  gesture: Extract<PitchGesture, { kind: "slide_in" | "slide_out" }>,
  durationSeconds: number,
): PitchPoint[] {
  const isIn = gesture.kind === "slide_in";
  const semitones =
    gesture.approxSemitones ??
    (isIn ? DEFAULT_SLIDE_IN_SEMITONES : DEFAULT_SLIDE_OUT_SEMITONES);
  const away = semitones * CENTS_PER_SEMITONE;
  const travel = Math.min(
    desiredGlideSeconds(semitones),
    durationSeconds * OPEN_SLIDE_MAX_FRACTION,
  );

  if (isIn) {
    const from = gesture.from === "below" ? -away : away;
    return transitionPoints("slide", 0, round(travel), from, 0).map((point) => ({
      timeSeconds: round(point.timeSeconds),
      cents: round(point.cents),
      curve: point.curve,
    }));
  }

  const to = gesture.to === "down" ? -away : away;
  const startsAt = Math.max(0, durationSeconds - travel);
  return [
    { timeSeconds: 0, cents: 0, curve: "step" as const },
    ...transitionPoints("slide", round(startsAt), round(durationSeconds), 0, to).map(
      (point) => ({
        timeSeconds: round(point.timeSeconds),
        cents: round(point.cents),
        curve: point.curve,
      }),
    ),
  ];
}

/** Either family, by kind. One entry point for the planner to call. */
export function pitchGestureAutomation(
  gesture: PitchGesture,
  durationSeconds: number,
  options: { readonly timeScale?: number } = {},
): PitchPoint[] {
  if (gesture.kind === "slide_in" || gesture.kind === "slide_out") {
    return openSlideAutomation(gesture, durationSeconds);
  }
  return bendGestureAutomation(gesture, durationSeconds, options);
}

/**
 * Where the pitch is, in cents, at a moment inside the note.
 *
 * This is what makes a bend survive a tie, a pause and a loop wrap: the
 * continuation path asks "what was this string doing when we stopped" and
 * gets an answer from the same automation the note was scheduled with, rather
 * than from a remembered number that could disagree with it.
 *
 * Between two points the reading follows the curve the earlier point named,
 * so a `step` really does hold until the next one — a prebend read a
 * millisecond in is already at its target, which is the whole gesture.
 */
export function centsAt(
  points: readonly PitchPoint[],
  timeSeconds: number,
): number {
  if (points.length === 0) return 0;
  const first = points[0]!;
  if (timeSeconds <= first.timeSeconds) return first.cents;

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    if (timeSeconds > point.timeSeconds) continue;
    const previous = points[index - 1]!;
    if (point.curve === "step") return previous.cents;
    const span = point.timeSeconds - previous.timeSeconds;
    if (span <= 0) return point.cents;
    const t = (timeSeconds - previous.timeSeconds) / span;
    return round(previous.cents + (point.cents - previous.cents) * t);
  }
  return points[points.length - 1]!.cents;
}

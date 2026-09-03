/**
 * Bend and slide candidates, for rendering only (2P-A §10, §11).
 *
 * None of this is reachable from the product. Nothing here is written to a
 * Song, offered in a sheet, sent to the Copilot or saved in a project file;
 * these are shapes handed straight to a render so two renders can be
 * compared. The current production behaviour is one of the candidates, and
 * it is produced by calling the production planner rather than by
 * re-implementing it — a "baseline" that is a copy would prove nothing.
 *
 * The candidate model is deliberately more expressive than today's contract:
 * a kind, a target in cents, an optional explicit curve, and an optional
 * vibrato that begins *after* the target is reached. That shape is the
 * proposal `EXPRESSION-CONTRACT-V2.md` argues for, exercised here before
 * anybody commits to it.
 */
import { bendAutomation, type PitchPoint } from "@/lib/audio/expression-plan";
import {
  bendGestureAutomation,
  openSlideAutomation,
} from "@/lib/audio/pitch-gesture";
import { desiredGlideSeconds, transitionPoints } from "@/lib/audio/legato-chain";
import type { Articulation } from "@/lib/song/schema";

const round = (value: number): number => Math.round(value * 1e6) / 1e6;

/* ------------------------------------------------------------------- bend */

export type BendKind = "bend" | "bend_release" | "prebend" | "prebend_release";

export type BendCandidate = {
  readonly kind: BendKind;
  readonly targetCents: number;
  /** Normalised time (0..1) to cents. Empty means "use the standard shape". */
  readonly points?: readonly { normalizedTime: number; cents: number }[];
  readonly vibrato?: {
    /** A hand arrives before it shakes. False would be the wrong gesture. */
    readonly startAfterTarget: boolean;
    readonly depthCents: number;
    readonly rateHz: number;
  };
};

/**
 * The shape of a bend, as automation points on a note of this length.
 *
 * Delegates to the production module. When these curves were measured they
 * lived here; they now live in `@/lib/audio/pitch-gesture` because the app
 * ships them, and the benchmark calls that rather than keeping a twin which
 * could drift from what a listener actually hears (2V-C.1 §5).
 */
export function bendCandidateAutomation(
  candidate: BendCandidate,
  durationSeconds: number,
): PitchPoint[] {
  if (candidate.points && candidate.points.length > 0) {
    return candidate.points.map((point, index) => ({
      timeSeconds: round(point.normalizedTime * durationSeconds),
      cents: round(point.cents),
      curve: index === 0 ? ("step" as const) : ("linear" as const),
    }));
  }
  return bendGestureAutomation(
    {
      kind: candidate.kind,
      targetCents: candidate.targetCents,
      ...(candidate.vibrato
        ? {
            vibrato: {
              startAfterTarget: true as const,
              depthCents: candidate.vibrato.depthCents,
              rateHz: candidate.vibrato.rateHz,
            },
          }
        : {}),
    },
    durationSeconds,
  );
}

/** Today's production bend, through the production planner. Not a copy. */
export function productionBendAutomation(
  articulation: Articulation,
  durationSeconds: number,
): PitchPoint[] {
  return bendAutomation(durationSeconds, articulation);
}

/* ------------------------------------------------------------------ slide */

export type SlideKind =
  | "legato"
  | "shift"
  | "slide_in_below"
  | "slide_in_above"
  | "slide_out_down"
  | "slide_out_up";

export type SlideCandidate = {
  readonly kind: SlideKind;
  /** Where the hand ends up, relative to the written note. */
  readonly intervalSemitones: number;
  /**
   * Only for `shift`: how loud the arrival is, as a fraction of an ordinary
   * onset. Not a guess — the render sweeps a small set and reports each.
   */
  readonly targetAttack?: number;
  /**
   * Only for `slide_in` / `slide_out`: how far away the gesture starts or
   * ends. Approximate on purpose — the contract must not invent a fret the
   * player never wrote (see `EXPRESSION-CONTRACT-V2.md` §2).
   */
  readonly approxSemitones?: number;
};

/**
 * The pitch travel of a slide candidate.
 *
 * `legato` and `shift` share their travel exactly: the difference between
 * them is whether the target is *struck*, not how the hand gets there.
 * Rendering them with different curves would make the listening test about
 * two things at once.
 */
export function slideCandidateAutomation(
  candidate: SlideCandidate,
  durationSeconds: number,
): PitchPoint[] {
  const semitoneToCents = 100;

  if (candidate.kind === "slide_in_below" || candidate.kind === "slide_in_above") {
    return openSlideAutomation(
      {
        kind: "slide_in",
        from: candidate.kind === "slide_in_below" ? "below" : "above",
        ...(candidate.approxSemitones === undefined
          ? {}
          : { approxSemitones: candidate.approxSemitones }),
      },
      durationSeconds,
    );
  }

  if (candidate.kind === "slide_out_down" || candidate.kind === "slide_out_up") {
    return openSlideAutomation(
      {
        kind: "slide_out",
        to: candidate.kind === "slide_out_down" ? "down" : "up",
        ...(candidate.approxSemitones === undefined
          ? {}
          : { approxSemitones: candidate.approxSemitones }),
      },
      durationSeconds,
    );
  }

  // legato and shift: the hand travels into the target and arrives on time.
  const travel = Math.min(
    desiredGlideSeconds(candidate.intervalSemitones),
    durationSeconds * 0.6,
  );
  const from = -candidate.intervalSemitones * semitoneToCents;
  return transitionPoints("slide", 0, round(travel), from, 0).map((point) => ({
    timeSeconds: round(point.timeSeconds),
    cents: round(point.cents),
    curve: point.curve,
  }));
}

/**
 * Attack levels the shift-slide candidate is rendered at.
 *
 * Not one number chosen by taste: a small set, rendered separately, so the
 * listening test can say which one sounds like a hand rather than like a
 * second pick stroke. `1` is an ordinary onset and is included as the
 * upper bound of the question.
 */
export const SHIFT_ATTACK_LEVELS = [0.35, 0.6, 1] as const;

/* --------------------------------------------------------------- timbre */

export type TimbreCandidate =
  /** What ships: one sample, moved by playbackRate. */
  | { readonly kind: "single_sample" }
  /**
   * The same, plus a short deterministic noise burst under the travel.
   *
   * No external sample. The noise is seeded from the fixture's own name and
   * the seed never reaches a Song.
   */
  | {
      readonly kind: "fret_noise";
      readonly gain: number;
      readonly seconds: number;
      readonly filterHz: number;
    }
  /**
   * Two neighbouring samples crossfaded under one logical voice.
   *
   * "One voice" here is a musical statement, not a graph statement: it uses
   * **two** physical buffer sources and the render reports both counts.
   */
  | { readonly kind: "crossfade"; readonly overlapSeconds: number };

/** The noise candidates, quiet enough that the question is movement, not effect. */
export const FRET_NOISE_CANDIDATES: readonly TimbreCandidate[] = [
  { kind: "fret_noise", gain: 0.045, seconds: 0.09, filterHz: 2600 },
  { kind: "fret_noise", gain: 0.09, seconds: 0.13, filterHz: 3200 },
];

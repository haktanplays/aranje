/**
 * The primitives a pitch or gain curve is made of (2V-C.1 §5).
 *
 * They live in their own module because two things now build automation —
 * the planner, for everything the legacy enum can say, and `pitch-gesture`,
 * for everything it cannot — and neither should have to import the other to
 * name a point. `expression-plan` re-exports all of this, so every call site
 * written before the split still reads from where it always did.
 */
import { expressionPresets } from "@/lib/audio/expression";

/** Rounded so a plan compares equal across runs without float noise. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export type AutomationCurve = "step" | "linear" | "sine";

export type PitchPoint = {
  /** Seconds from the note's own start. */
  timeSeconds: number;
  /** Deviation from the written pitch. 0 is the pitch as written. */
  cents: number;
  curve: AutomationCurve;
};

export type GainPoint = { timeSeconds: number; value: number };

export type BendStages = {
  settleSeconds: number;
  riseSeconds: number;
  holdSeconds: number;
  releaseSeconds: number;
  /** When the target pitch is first reached, from the note's start. */
  reachedAtSeconds: number;
};

/**
 * How long each stage lasts.
 *
 * The rise and the release scale with the note but are clamped into a range a
 * hand can actually do. When the note is too short to hold all three, they are
 * squeezed **proportionally** — deterministic, and never producing a negative
 * hold or automation that runs off the end of the note.
 *
 * `timeScale` is the practice-speed factor: at half speed the musical gesture
 * is twice as long, so its real-time floors and ceilings stretch with it.
 */
export function bendStages(
  durationSeconds: number,
  timeScale = 1,
): BendStages {
  const preset = expressionPresets.bend;

  let settle = Math.min(
    preset.settleSeconds * timeScale,
    durationSeconds * preset.settleMaxFraction,
  );
  let rise = Math.min(
    preset.riseMaxSeconds * timeScale,
    Math.max(preset.riseMinSeconds * timeScale, durationSeconds * preset.riseFraction),
  );
  let release = Math.min(
    preset.releaseMaxSeconds * timeScale,
    Math.max(
      preset.releaseMinSeconds * timeScale,
      durationSeconds * preset.releaseFraction,
    ),
  );

  const needed = settle + rise + release;
  if (needed > durationSeconds && needed > 0) {
    const squeeze = durationSeconds / needed;
    settle *= squeeze;
    rise *= squeeze;
    release *= squeeze;
  }

  const hold = Math.max(0, durationSeconds - settle - rise - release);

  return {
    settleSeconds: round(settle),
    riseSeconds: round(rise),
    holdSeconds: round(hold),
    releaseSeconds: round(release),
    reachedAtSeconds: round(settle + rise),
  };
}


/**
 * The value of an automation timeline at a moment (2V-C.1 §7).
 *
 * The one rule for reading a curve, so a bend that is up when the transport
 * pauses resumes at the pitch it was actually at rather than at a number
 * remembered somewhere else. Between two points the reading follows the curve
 * the *later* point names, so a `step` really does hold until the instant it
 * lands — which is what makes a prebend read a millisecond in already at its
 * target, and that is the whole gesture.
 *
 * Generic over the values so one implementation serves pitch and gain; two
 * copies of this rule is exactly how a resumed voice comes to disagree with
 * the note it is resuming.
 */
export function valueAt(
  points: readonly { readonly timeSeconds: number; readonly curve?: string }[],
  values: readonly number[],
  elapsed: number,
): number {
  if (points.length === 0) return 0;
  const first = points[0]!;
  if (elapsed <= first.timeSeconds) return values[0]!;

  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    if (point.timeSeconds < elapsed) continue;
    const previous = points[index - 1]!;
    /* A step holds what came before it until the instant it lands. */
    if (point.curve === "step") return values[index - 1]!;
    const span = point.timeSeconds - previous.timeSeconds;
    if (span <= 0) return values[index]!;
    const ratio = (elapsed - previous.timeSeconds) / span;
    return values[index - 1]! + (values[index]! - values[index - 1]!) * ratio;
  }
  return values[values.length - 1]!;
}

/**
 * How long each part of a written gesture lasts (2V-C.2 §6, §11).
 *
 * Separate from `bendStages` on purpose. That function shapes the legacy
 * `bend_half` / `bend_full` enum, which was accepted, is in old projects, and
 * must keep sounding exactly as it does — so it is not the place to answer a
 * complaint about the *new* `bend_release` gesture. The two now differ in one
 * respect and share everything else: this one reserves a stretch at the end
 * where the note is back at the written pitch and is simply heard being it.
 *
 * ## The measurement this exists to answer
 *
 * The shipped release on a 1.149s note took 0.138s to fall 200 cents, against
 * 0.211s to rise the same 200 — a hand that lets go half again as fast as it
 * pushed — and reached the written pitch at the note's final sample. So there
 * was nothing after the fall. A listener asked "did it come back?" could only
 * answer "it was falling when it stopped", which is what the founder said in
 * different words.
 *
 * Two changes, both measurable: the release is at least as slow as the rise,
 * and it finishes early enough to leave a rest. Everything else about the
 * gesture — where the pick lands, how the rise is eased, where the target is
 * reached — is untouched, because nothing said those were wrong.
 */
import { expressionPresets } from "@/lib/audio/expression";

/** Rounded so a plan compares equal across runs without float noise. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export type BendReleaseStages = {
  settleSeconds: number;
  riseSeconds: number;
  holdSeconds: number;
  releaseSeconds: number;
  /** The stretch at the written pitch after the release, before the note ends. */
  restSeconds: number;
  /** When the target pitch is first reached, from the note's start. */
  reachedAtSeconds: number;
  /** When the descent begins. Never earlier than the arrival. */
  releaseStartsAtSeconds: number;
  /** When the written pitch is reached again. Never later than the note. */
  returnedAtSeconds: number;
};

/**
 * The five stages of a bend that comes back.
 *
 * `timeScale` is the practice-speed factor: at half speed the musical gesture
 * is twice as long, so the floors and ceilings stretch with it and the
 * *ratios* between the stages are the same at every rate — which is what
 * keeps a slowed-down bend the same gesture rather than a different one.
 *
 * When the note cannot hold all five, they are squeezed by one shared factor.
 * That is deterministic, it keeps the character, and it is the reason the
 * hold can reach zero but never goes negative and no stage is ever written
 * past the end of the note.
 */
export function bendReleaseStages(
  durationSeconds: number,
  timeScale = 1,
): BendReleaseStages {
  const preset = expressionPresets.bend;
  const shape = preset.release;

  let settle = Math.min(
    preset.settleSeconds * timeScale,
    durationSeconds * preset.settleMaxFraction,
  );
  let rise =
    clamp(
      (durationSeconds * preset.riseFraction) / timeScale,
      preset.riseMinSeconds,
      preset.riseMaxSeconds,
    ) * timeScale;
  /* A relaxing hand is never quicker than a pushing one. */
  let release =
    clamp(rise / timeScale * shape.ratioToRise, shape.minSeconds, shape.maxSeconds) *
    timeScale;
  let rest =
    clamp(
      (durationSeconds * shape.restFraction) / timeScale,
      shape.restMinSeconds,
      shape.restMaxSeconds,
    ) * timeScale;

  const needed = settle + rise + release + rest;
  if (needed > durationSeconds && needed > 0) {
    const squeeze = durationSeconds / needed;
    settle *= squeeze;
    rise *= squeeze;
    release *= squeeze;
    rest *= squeeze;
  }

  const hold = Math.max(0, durationSeconds - settle - rise - release - rest);
  const reachedAt = settle + rise;
  const releaseStartsAt = reachedAt + hold;

  return {
    settleSeconds: round(settle),
    riseSeconds: round(rise),
    holdSeconds: round(hold),
    releaseSeconds: round(release),
    restSeconds: round(rest),
    reachedAtSeconds: round(reachedAt),
    releaseStartsAtSeconds: round(releaseStartsAt),
    returnedAtSeconds: round(releaseStartsAt + release),
  };
}

/**
 * The voice leaving, under a slide-out (2V-C.2 §11).
 *
 * A slide-out has no note to arrive at: the hand keeps moving while the
 * string is let go. Played at full gain to the last sample — which is what
 * the trace found — it is a whammy dive cut with scissors, and it is the
 * reason the founder asked for this to be improved.
 *
 * So the exit fades, and the entry does not. That asymmetry is the point,
 * not an oversight: a slide-in lands *into* the body of a note that then goes
 * on sounding, while a slide-out is the sound going away. Mirroring one ramp
 * across both would give the entry a fade it should not have, or the exit
 * none.
 *
 * It does not fade to silence. The note is still stopping on its own, and a
 * ramp that reached zero early would cut the tail before the string did.
 */
export function slideOutGain(
  gain: number,
  durationSeconds: number,
  travelStartsAt: number,
): { timeSeconds: number; value: number }[] {
  const startsAt = clamp(travelStartsAt, 0, durationSeconds);
  return [
    { timeSeconds: 0, value: round(gain) },
    { timeSeconds: round(startsAt), value: round(gain) },
    {
      timeSeconds: round(durationSeconds),
      value: round(gain * expressionPresets.slide.outFadeToFraction),
    },
  ];
}

/**
 * How one note hands a string to the next (2V-C.4 §7, §8).
 *
 * ## What it replaces, and why
 *
 * 2V-C.3 gave the shift slide a source that faded to a fixed fraction of its
 * level across the travel and stopped at exactly the target's onset. Measured
 * at the event level that is perfect: overlap zero, gap zero, the target
 * struck at its own pitch at its own moment. Measured in the rendered
 * waveform it is a hole. The source's release runs out about 6 ms after the
 * onset; the target's recording needs between 3 and 31 ms to reach half its
 * attack. In between there is a dip to a fiftieth of the surrounding energy,
 * about 14 ms wide, and that is what "iki ses arasında minik bir boşluk"
 * sounds like.
 *
 * The fix is not a different fade shape. It is that the source should not
 * stop at the onset at all. A finger arriving at a fret does not silence the
 * string it arrives on, and the pick that follows does not silence the sound
 * that was already there: the old vibration decays *through* the new attack.
 * So the source is given a short tail past the onset, at the target's pitch,
 * fading to nothing as the target gets loud.
 *
 * ## Why the tail is not one number
 *
 * Because the thing it has to cover is not one number. The guitar pack's E4
 * is half-loud after 3 ms and its A3 after 31 ms, so a tail long enough for
 * the second would sit on top of the first. The overlap is therefore derived
 * from the target's own measured attack, and bounded at both ends: never
 * shorter than the source's own release (or it would stop before it had
 * bridged anything) and never longer than a small fraction of the target's
 * note (or a fast passage would have every note playing under the next).
 *
 * ## What it deliberately does not do
 *
 * It does not move the target. The onset the reader wrote is the onset that
 * sounds, at the pitch that is written, and nothing here starts a buffer
 * early to fill a gap — the recordings were measured and have no leading
 * silence to skip, so there would be nothing to gain and a rhythm to lose.
 * It adds no transient, no second sample and no gain spike: the target's
 * attack is the card's subject and faking it would answer the question by
 * deleting it. And it never leaves two voices at full level together — the
 * source is already well down before the overlap starts, and with several
 * strings sliding at once the ceiling is on their sum.
 */
import { expressionPresets } from "@/lib/audio/expression";

/** How long a stopped voice takes to fall silent. Measured, not assumed. */
export const SOURCE_RELEASE_SECONDS = 0.008;

/** The overlap never goes outside these, whatever the recording does. */
export const MIN_OVERLAP_SECONDS = 0.012;
export const MAX_OVERLAP_SECONDS = 0.045;

/** The most of the target's own note the overlap may cover. */
export const MAX_OVERLAP_FRACTION = 0.35;

/**
 * The most the sources may sum to at the moment the target is struck.
 *
 * With one string this never binds. With three sliding together it does, and
 * that is the point: each voice is quiet, but three quiet voices under one
 * chord attack are not quiet, and headroom is a property of the sum.
 */
export const MAX_SOURCE_SUM = 1.4;

/** The level the source is at when the target arrives, before and after. */
export const SLOW_ATTACK_SECONDS = 0.03;

export type HandoffInput = {
  /** The source note's own level, before any of this. */
  readonly sourceGain: number;
  /** Seconds from the source's onset to the target's. Always positive. */
  readonly handoverSeconds: number;
  /** How long the hand is on its way, ending at the target's onset. */
  readonly travelSeconds: number;
  /** How long the target's recording takes to become audible (§5). */
  readonly targetAttackSeconds: number;
  /** The target's own written length, so a short note is not buried. */
  readonly targetDurationSeconds: number;
  /** How many strings are handing over at this moment. One, unless a shape. */
  readonly voiceCount: number;
};

export type GainPoint = { readonly timeSeconds: number; readonly value: number };

export type HandoffEnvelope = {
  /** When the source starts coming down, from its own onset. */
  readonly fadeStartSeconds: number;
  /** Its level at the target's onset, as a fraction of `sourceGain`. */
  readonly onsetFraction: number;
  /** Its level there, absolute. */
  readonly gainAtTargetOnset: number;
  /** How far past the target's onset the source keeps sounding. */
  readonly overlapSeconds: number;
  /** The source's total length, from its own onset. */
  readonly endSeconds: number;
  /** The whole thing, ready for the voice. Ends at silence, so it cannot click. */
  readonly points: readonly GainPoint[];
};

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * The one policy every re-struck connection uses.
 *
 * Single notes and shape slides share it rather than each having their own,
 * because they are the same gesture — L21 and L24 came back with the same
 * sentence, and two fades tuned separately would drift into two sounds.
 * A shape's strings differ only where they genuinely differ: each reads its
 * own recording's attack, and the ceiling on their sum is shared.
 */
export function handoffEnvelope(input: HandoffInput): HandoffEnvelope {
  const handover = Math.max(0, input.handoverSeconds);
  const travel = clamp(input.travelSeconds, 0, handover);
  const fadeStart = round(handover - travel);

  /*
   * How far down the source is when the target lands.
   *
   * A recording that is loud almost at once needs less bridging than one
   * that creeps up, so the fraction moves with the attack rather than being
   * the same everywhere. Both ends come from the preset, so the character of
   * the gesture stays one decision in one place.
   */
  const preset = expressionPresets.slide;
  const span = Math.max(1e-6, SLOW_ATTACK_SECONDS);
  const lean = clamp(input.targetAttackSeconds / span, 0, 1);
  const base =
    preset.handoverGainFraction +
    (preset.handoverSlowFraction - preset.handoverGainFraction) * lean;

  /* Several strings handing over at once share the ceiling, not each get it. */
  const voices = Math.max(1, Math.round(input.voiceCount));
  const onsetFraction = round(Math.min(base, MAX_SOURCE_SUM / voices));

  /*
   * The tail covers the target's rise plus the source's own release, because
   * a source that merely reached the onset would still be falling silent in
   * the milliseconds the dip is in.
   */
  const wanted = input.targetAttackSeconds + SOURCE_RELEASE_SECONDS;
  const roomInTarget = Math.max(0, input.targetDurationSeconds) * MAX_OVERLAP_FRACTION;
  const overlap = round(
    Math.min(clamp(wanted, MIN_OVERLAP_SECONDS, MAX_OVERLAP_SECONDS), roomInTarget),
  );

  const end = round(handover + overlap);
  const gainAtTargetOnset = round(input.sourceGain * onsetFraction);

  /*
   * Four points: held, held to the departure, down to the handover level at
   * the onset, out to silence across the overlap. The last one is zero
   * rather than a small number, so the voice ends where the waveform is
   * already at nothing and there is no step to hear.
   */
  const points: GainPoint[] = [
    { timeSeconds: 0, value: round(input.sourceGain) },
    { timeSeconds: fadeStart, value: round(input.sourceGain) },
    { timeSeconds: round(handover), value: gainAtTargetOnset },
  ];
  if (end > handover) points.push({ timeSeconds: end, value: 0 });

  return {
    fadeStartSeconds: fadeStart,
    onsetFraction,
    gainAtTargetOnset,
    overlapSeconds: overlap,
    endSeconds: end,
    points,
  };
}

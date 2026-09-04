/**
 * Where a shift slide actually happens (2V-C.2 §9).
 *
 * ## What was wrong
 *
 * A shift slide is two struck notes with one hand movement between them: the
 * first is picked, the hand slides, and the second is picked again — at the
 * new fret, having already got there. C.1 modelled it as an ordinary onset
 * carrying the travel on its own automation, which sounds reasonable written
 * down and is the wrong event order. It struck the **target's** buffer at the
 * **source's** pitch, at the target's written moment, and slid up from there.
 * So the note the reader wrote arrived roughly 190 ms late, the source note
 * never moved at all, and the "re-strike" landed on the wrong pitch.
 *
 * ## What it is instead
 *
 * The travel belongs to the source note, because that is when the hand moves.
 * The source is extended to the target's onset — a sliding hand does not lift
 * the string — and its pitch leaves late enough to be heard as itself first,
 * arriving at the target's pitch exactly as the target is struck. The target
 * is then an ordinary onset at its own pitch and its own time.
 *
 * Two voices, both already in the pool, both real notes the reader wrote.
 * Nothing here adds an onset to the song, a scheduler, a synth or a click:
 * this rewrites two entries of a plan that already existed.
 *
 * ## What it will not do
 *
 * If the source note is already part of a legato chain, it is being played by
 * that chain and is not this pass's to rewrite. The slide keeps its refusal
 * from the planner and the two notes are struck plainly, which is what
 * falling back has always sounded like. Silently doing both would give one
 * string two owners.
 */
import { handoffGain } from "@/lib/audio/gesture-shape";
import { transitionPoints } from "@/lib/audio/legato-chain";
import type { ExpressiveNotePlan } from "@/lib/audio/expression-plan";
import type { PitchPoint } from "@/lib/audio/automation";

const CENTS_PER_SEMITONE = 100;

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export type ShiftSlideLink = {
  /** Index into the plan of the note that is struck second. */
  readonly targetIndex: number;
  /** Index of the note the hand starts from. */
  readonly sourceIndex: number;
  /** Semitones from the source's pitch to the target's. */
  readonly intervalSemitones: number;
  /** How long the hand is allowed to be on its way. */
  readonly travelSeconds: number;
};

/**
 * Move each link's travel into its source note.
 *
 * Mutates the array it is given, which is the plan being assembled and is not
 * yet anyone else's. Returns the links it actually applied, so a caller can
 * tell an applied slide from a skipped one without re-deriving the reason.
 */
export function applyShiftSlides(
  planned: ExpressiveNotePlan[],
  links: readonly ShiftSlideLink[],
  chained: ReadonlySet<number>,
): ShiftSlideLink[] {
  const applied: ShiftSlideLink[] = [];

  for (const link of links) {
    const source = planned[link.sourceIndex];
    const target = planned[link.targetIndex];
    if (!source || !target) continue;
    /* The source belongs to a chain: that voice already owns this string. */
    if (chained.has(link.sourceIndex) || chained.has(link.targetIndex)) continue;

    /* The hand holds the string down until it arrives, so the source sounds
       right up to the moment the target is struck — never past it. */
    const handover = round(target.startSeconds - source.startSeconds);
    if (handover <= 0) continue;
    const travel = Math.min(link.travelSeconds, handover);
    const leaves = round(handover - travel);

    const climb = link.intervalSemitones * CENTS_PER_SEMITONE;
    const points: PitchPoint[] = transitionPoints(
      "slide",
      leaves,
      round(handover),
      0,
      climb,
    ).map((point) => ({
      timeSeconds: round(point.timeSeconds),
      cents: round(point.cents),
      curve: point.curve,
    }));

    planned[link.sourceIndex] = {
      ...source,
      expressive: true,
      durationSeconds: round(handover),
      /*
       * The old vibration handed over rather than cut (2V-C.3 §4).
       *
       * Measured at full level at the exact sample the target's attack began,
       * which puts a step in the waveform between two full-amplitude events.
       * The source now decays across its travel, the way a string does when a
       * finger arrives on it.
       */
      gainEnvelope: handoffGain(source.gain, round(handover), leaves),
      /* Held as itself first, then travelling. The leading point is what
         makes the departure late rather than immediate. */
      pitchAutomation:
        leaves > 0
          ? [{ timeSeconds: 0, cents: 0, curve: "step" as const }, ...points]
          : points,
    };
    applied.push(link);
  }

  return applied;
}

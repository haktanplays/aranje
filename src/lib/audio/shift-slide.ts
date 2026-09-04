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
 *
 * ## Where the source now stops (2V-C.4)
 *
 * Not at the target's onset any more. C.2 and C.3 both ended it exactly
 * there, which is right about the event and wrong about the sound: the
 * source's release runs out a few milliseconds later while the target's
 * recording is still climbing, and the rendered waveform dips into the hole
 * between them. So the source keeps a short measured tail past the onset, at
 * the target's pitch, fading out as the target gets loud. How long is
 * `handoffEnvelope`'s decision and depends on the recording the target will
 * play; nothing about the target's own onset, pitch or duration moves.
 */
import { handoffEnvelope } from "@/lib/audio/handoff-envelope";
import { transitionPoints } from "@/lib/audio/legato-chain";
import type { ExpressiveNotePlan } from "@/lib/audio/expression-plan";
import { DEFAULT_ATTACK_SECONDS } from "@/lib/audio/sample-onset";
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
 * How long the target's recording takes to become audible, by plan index.
 *
 * Supplied rather than looked up, because which recording a note plays is a
 * property of the track's pack and the planner is the thing that knows the
 * track. A link with no entry falls back to the shared default, which is a
 * usable handoff rather than none.
 */
export type TargetAttackSeconds = (targetIndex: number) => number;

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
  attackFor: TargetAttackSeconds = () => DEFAULT_ATTACK_SECONDS,
): ShiftSlideLink[] {
  const applied: ShiftSlideLink[] = [];

  /*
   * A shape hands over as one hand (2V-C.4 §11).
   *
   * Its strings play different recordings with different attacks, so left to
   * themselves they would each take their own tail and stop up to thirty
   * milliseconds apart. Both targets are ringing throughout either way, but a
   * chord whose strings are released at different moments is not one hand
   * letting go, so the group shares the longest attack among them and every
   * string is handed over on the same schedule. Each still *reads* its own
   * recording — it is the group's answer that is shared, not the question.
   *
   * The count is shared for a second reason: three quiet voices under one
   * chord attack are not quiet, and the ceiling belongs on their sum.
   */
  const groups = new Map<number, { voices: number; attack: number }>();
  for (const link of links) {
    const target = planned[link.targetIndex];
    if (!target) continue;
    const found = groups.get(target.timeTicks) ?? { voices: 0, attack: 0 };
    groups.set(target.timeTicks, {
      voices: found.voices + 1,
      attack: Math.max(found.attack, attackFor(link.targetIndex)),
    });
  }

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

    const group = groups.get(target.timeTicks);
    const envelope = handoffEnvelope({
      sourceGain: source.gain,
      handoverSeconds: round(handover),
      travelSeconds: travel,
      targetAttackSeconds: group?.attack ?? attackFor(link.targetIndex),
      targetDurationSeconds: target.durationSeconds,
      voiceCount: group?.voices ?? 1,
    });

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

    /*
     * The tail stays where the hand arrived. Holding the target's pitch
     * through the overlap is what makes the tail part of the target's sound
     * rather than a second note underneath it — and it is the reason the
     * overlap does not beat: both voices are at the same pitch.
     */
    if (envelope.endSeconds > handover) {
      points.push({
        timeSeconds: envelope.endSeconds,
        cents: round(climb),
        curve: "linear",
      });
    }

    planned[link.sourceIndex] = {
      ...source,
      expressive: true,
      durationSeconds: envelope.endSeconds,
      /*
       * The old vibration handed over rather than cut (2V-C.3 §4, 2V-C.4 §8).
       *
       * C.3 measured it at full level at the exact sample the target's attack
       * began — a step between two full-amplitude events — and fixed that by
       * fading it across the travel. C.4 measured what was left: it still
       * ended at the onset, and the target was not loud yet. It now fades
       * *through* the target's attack instead, reaching silence when the
       * target has taken the note.
       */
      gainEnvelope: [...envelope.points],
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

/**
 * What was still sounding when the transport stopped (2V-B.1 §6).
 *
 * Pause used to be `stopAll()`, and resume used to be `transport.start()`.
 * Between those two lines a held chord, a vibrato and a slide simply ceased
 * to exist: the transport never re-fires an event whose onset is behind the
 * playhead, so anything struck before the pause came back as silence. What
 * the reader heard was a bar that emptied itself on every pause.
 *
 * This module answers the question that fixes it, and answers it **without
 * touching audio**: given the plan the engine is already playing, the tempo
 * timeline it is already on, and the tick the transport stopped at, which
 * voices were mid-flight and where exactly was each one?
 *
 * ## Why it is pure
 *
 * The same numbers have to be right in three places — the live engine, the
 * offline renderer and a test that has neither — and "the slide resumed from
 * the pitch it had reached" is a claim about a number, not about a node. So
 * there is no Tone here, no context, no scheduler and no clock: a plan in,
 * a plan out. `ExpressionRuntime.resumeAt` is the only thing that turns the
 * answer into sound, and it is handed exactly what this returns.
 *
 * ## What a continuation is, and is not
 *
 * It is **the rest of a sound that already started**. Every voice it
 * describes is marked `continuation`, and the two rules that follow from that
 * word are enforced here rather than left to the caller:
 *
 * - A note whose onset is *exactly* the resume tick is excluded. The
 *   transport will fire it itself, and a continuation for it would be a
 *   second attack on the same note.
 * - No auxiliary transient is ever produced. The click of a finger leaving a
 *   string belongs to the moment the finger left; manufacturing one at the
 *   resume would put a pick attack in the middle of a note that never
 *   stopped, which is the exact defect the legato chain exists to avoid.
 *   A hammer-on chain resumed mid-flight is therefore one primary voice and
 *   nothing else — and the finger landings still ahead of the playhead are
 *   not re-created either. That is a stated limit, not an oversight.
 *
 * ## The timeline is frozen
 *
 * Every seconds value here is read off the **musical** timeline the plan was
 * built on, not off the audio clock. `elapsedSeconds` is how far into its own
 * sound each voice had got; the automation it carries is rebased so that time
 * zero is the moment playback resumes. Nothing here knows or cares what the
 * audio context's `now()` will be when that happens.
 */
import type {
  ExpressionPlan,
  ExpressiveNotePlan,
  GainPoint,
  PitchPoint,
} from "@/lib/audio/expression-plan";
import type { LegatoChain } from "@/lib/audio/legato-chain";
import { secondsAtTicks, type TempoMap } from "@/lib/audio/tempo";
import type { PlaybackWindow } from "@/lib/playback/selection-playback";

/**
 * One sound that was in the air, and where it had got to.
 *
 * Deliberately the same shape whether it came from a single expressive note
 * or from a whole legato chain: the pool restores both through one path, so
 * a chain cannot pick up a second code route and quietly grow an attack.
 */
export type ContinuationVoice = {
  /** The note's id, or the chain's. Stable across repeated calls. */
  readonly id: string;
  readonly trackId: string;
  /** Which shape it came from, for evidence that names what it restored. */
  readonly kind: "note" | "chain";
  /** The pitch the source buffer is played at. A chain uses its source's. */
  readonly sourcePitch: string;
  /** When it was struck, on the frozen musical timeline. */
  readonly onsetSeconds: number;
  /** How far into its own sound the pause happened. Always > 0. */
  readonly elapsedSeconds: number;
  /** What is left of it. Always > 0. */
  readonly remainingSeconds: number;
  /**
   * Where the pitch actually was, in cents against `sourcePitch`.
   *
   * This is the whole point of the module. A slide paused halfway is not at
   * its source pitch and not at its target: it is at the interpolated value
   * the automation had reached, and resuming from either end would be
   * audible as a jump.
   */
  readonly currentCents: number;
  /** The level it actually had, before the track's own trim. */
  readonly currentGain: number;
  /** Future pitch automation only, rebased so 0 is the resume moment. */
  readonly pitchAutomation: readonly PitchPoint[];
  /** Future level automation only, rebased the same way. */
  readonly gainEnvelope: readonly GainPoint[];
  /** Carried across the pause: a palm mute is still muted afterwards. */
  readonly filterPreset?: "palm_mute" | "dead";
  /** Carried so evidence can name the technique that was interrupted. */
  readonly articulation?: string;
  /** Always true. A continuation is never a new attack. */
  readonly continuation: true;
};

export type ContinuationPlan = {
  readonly pausedTicks: number;
  readonly pausedSeconds: number;
  readonly voices: readonly ContinuationVoice[];
};

/** Nothing was sounding. Its own value so callers never build one. */
export const NO_CONTINUATION: ContinuationPlan = {
  pausedTicks: 0,
  pausedSeconds: 0,
  voices: [],
};

/**
 * Read an automation timeline at a moment inside it.
 *
 * Exactly the interpolation the voice pool performs on the audio param, so
 * the number here and the number in the ear are the same number: point zero
 * is always a `setValueAtTime`, a `step` point holds the previous value until
 * it lands, and everything else is a linear ramp from the point before it.
 * `sine` is written out as a run of ramps by the planner, so it needs no case
 * of its own — reading it as linear between its own points *is* reading the
 * sine.
 */
function valueAt(
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

/** The part of a timeline still ahead, moved so the resume moment is zero. */
function rebasePitch(
  points: readonly PitchPoint[],
  elapsed: number,
  current: number,
): PitchPoint[] {
  const ahead = points
    .filter((point) => point.timeSeconds > elapsed)
    .map((point) => ({
      timeSeconds: point.timeSeconds - elapsed,
      cents: point.cents,
      curve: point.curve,
    }));
  /* Where it is now, stated first, so the resumed voice starts where the
     paused one stopped rather than at whatever the next point says. */
  return [{ timeSeconds: 0, cents: current, curve: "step" as const }, ...ahead];
}

function rebaseGain(
  points: readonly GainPoint[],
  elapsed: number,
  current: number,
): GainPoint[] {
  const ahead = points
    .filter((point) => point.timeSeconds > elapsed)
    .map((point) => ({ timeSeconds: point.timeSeconds - elapsed, value: point.value }));
  return [{ timeSeconds: 0, value: current }, ...ahead];
}

/**
 * A chain's pitch travel as one timeline against its source pitch.
 *
 * Each transition already writes its points in cumulative cents from the
 * chain's own start, which is what makes this a concatenation rather than a
 * calculation: the planner did the arithmetic, and repeating it here would be
 * a second answer to a question that already has one.
 */
function chainPitchPoints(chain: LegatoChain): PitchPoint[] {
  const points: PitchPoint[] = [{ timeSeconds: 0, cents: 0, curve: "step" }];
  for (const transition of chain.transitions) {
    for (const point of transition.points) {
      points.push({
        timeSeconds: point.timeSeconds,
        cents: point.cents,
        curve: point.curve,
      });
    }
  }
  return points;
}

/**
 * A chain's level as one timeline.
 *
 * The pool holds the level a transition arrived with until the finger lands,
 * then ramps down to what the gesture leaves behind; this writes the same two
 * points per transition, in the same order, from the same `levelAfter`.
 */
function chainGainPoints(chain: LegatoChain): GainPoint[] {
  const points: GainPoint[] = [{ timeSeconds: 0, value: chain.gain }];
  let carried = 1;
  for (const transition of chain.transitions) {
    points.push({ timeSeconds: transition.atSeconds, value: chain.gain * carried });
    carried *= transition.levelAfter;
    points.push({
      timeSeconds: transition.arrivesAtSeconds,
      value: chain.gain * carried,
    });
  }
  return points;
}

function withinWindow(
  window: PlaybackWindow | null | undefined,
  trackId: string,
  onsetTicks: number,
): boolean {
  if (!window) return true;
  return (
    window.trackIds.includes(trackId) &&
    onsetTicks >= window.startTicks &&
    onsetTicks < window.endTicks
  );
}

function noteVoice(
  note: ExpressiveNotePlan,
  pausedSeconds: number,
): ContinuationVoice | null {
  /* A strummed chord is one written onset and several real strikes; the one
     that has not been struck yet is not sounding, so it is not continued. */
  const onsetSeconds = note.startSeconds + (note.strumOffsetSeconds ?? 0);
  const endSeconds = onsetSeconds + note.durationSeconds;
  if (onsetSeconds >= pausedSeconds || endSeconds <= pausedSeconds) return null;

  const elapsed = pausedSeconds - onsetSeconds;
  const cents = valueAt(
    note.pitchAutomation,
    note.pitchAutomation.map((point) => point.cents),
    elapsed,
  );
  const gain =
    note.gainEnvelope.length === 0
      ? note.gain
      : valueAt(
          note.gainEnvelope,
          note.gainEnvelope.map((point) => point.value),
          elapsed,
        );

  return {
    id: note.id,
    trackId: note.trackId,
    kind: "note",
    sourcePitch: note.pitch,
    onsetSeconds,
    elapsedSeconds: elapsed,
    remainingSeconds: endSeconds - pausedSeconds,
    currentCents: cents,
    currentGain: gain,
    pitchAutomation: rebasePitch(note.pitchAutomation, elapsed, cents),
    gainEnvelope: rebaseGain(note.gainEnvelope, elapsed, gain),
    ...(note.filterPreset === undefined ? {} : { filterPreset: note.filterPreset }),
    ...(note.articulation === undefined ? {} : { articulation: note.articulation }),
    continuation: true,
  };
}

function chainVoice(
  chain: LegatoChain,
  pausedSeconds: number,
): ContinuationVoice | null {
  if (chain.startSeconds >= pausedSeconds || chain.endSeconds <= pausedSeconds) {
    return null;
  }
  const elapsed = pausedSeconds - chain.startSeconds;
  const pitchPoints = chainPitchPoints(chain);
  const gainPoints = chainGainPoints(chain);
  const cents = valueAt(
    pitchPoints,
    pitchPoints.map((point) => point.cents),
    elapsed,
  );
  const gain = valueAt(
    gainPoints,
    gainPoints.map((point) => point.value),
    elapsed,
  );

  return {
    id: chain.chainId,
    trackId: chain.trackId,
    kind: "chain",
    sourcePitch: chain.sourcePitch,
    onsetSeconds: chain.startSeconds,
    elapsedSeconds: elapsed,
    remainingSeconds: chain.endSeconds - pausedSeconds,
    currentCents: cents,
    currentGain: gain,
    pitchAutomation: rebasePitch(pitchPoints, elapsed, cents),
    gainEnvelope: rebaseGain(gainPoints, elapsed, gain),
    continuation: true,
  };
}

/**
 * Cut a continuation at the end of the window it is being restored into.
 *
 * A voice with nothing left inside the window is not restored at all: putting
 * it back to release immediately would be an attack the reader never wrote.
 */
function clampRemaining(
  voice: ContinuationVoice | null,
  cap: number | null,
): ContinuationVoice | null {
  if (!voice || cap === null) return voice;
  if (cap <= 0) return null;
  if (voice.remainingSeconds <= cap) return voice;
  return { ...voice, remainingSeconds: cap };
}

/**
 * Which voices were in the air at `pausedTicks`, and where each one was.
 *
 * The plan and the tempo map are the **same** ones the engine is playing, not
 * copies built for this: a continuation derived from a second plan would be a
 * second opinion about what the music is.
 *
 * `window` is the selection currently being auditioned, when one is. A resume
 * inside a selection may only restore voices the selection itself started —
 * restoring a note from another track, or from outside the chosen bars, would
 * put music on the resume that the reader had asked not to hear.
 */
export function activeVoicesAt(
  plan: ExpressionPlan,
  tempo: TempoMap,
  pausedTicks: number,
  window?: PlaybackWindow | null,
): ContinuationPlan {
  const pausedSeconds = secondsAtTicks(tempo, pausedTicks);
  const voices: ContinuationVoice[] = [];
  /*
   * A continuation may not outlive the window it belongs to (2V-B.3 §5).
   *
   * Without this the resumed voice keeps its natural length, and it is only
   * the controller's `stopAll` at the wrap that happens to cut it. That made
   * the truth about "when does this stop" live in two places, one of which
   * does not exist for an offline render — so a rendered pass and a live pass
   * could disagree about a tail crossing the selection's end.
   */
  const remainingCap =
    window == null ? null : secondsAtTicks(tempo, window.endTicks) - pausedSeconds;

  for (const note of plan.notes) {
    /* Chain members are rendered by their chain, so continuing them here
       would sound the same string twice. */
    if (note.chainRole !== undefined) continue;
    /* Exactly at the resume tick is the transport's own event, not ours. */
    if (note.timeTicks >= pausedTicks) continue;
    if (!withinWindow(window, note.trackId, note.timeTicks)) continue;
    const voice = clampRemaining(noteVoice(note, pausedSeconds), remainingCap);
    if (voice) voices.push(voice);
  }

  for (const chain of plan.chains) {
    if (chain.startTicks >= pausedTicks) continue;
    if (!withinWindow(window, chain.trackId, chain.startTicks)) continue;
    const voice = clampRemaining(chainVoice(chain, pausedSeconds), remainingCap);
    if (voice) voices.push(voice);
  }

  /* Deterministic order, so two calls with the same input are the same
     answer down to the array — which is what the repeated-call test asks. */
  voices.sort((left, right) =>
    left.onsetSeconds === right.onsetSeconds
      ? left.id.localeCompare(right.id)
      : left.onsetSeconds - right.onsetSeconds,
  );

  return { pausedTicks, pausedSeconds, voices };
}

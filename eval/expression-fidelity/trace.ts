/**
 * What the four unhappy cards actually do, measured (2V-C.2 §3).
 *
 * The brief's rule is that no curve is touched before the wrong thing is
 * shown. So this reads the *production* plan — the same `buildExpressionPlan`
 * the app schedules from — and writes down the moments that decide whether a
 * gesture is a guitar movement or an effect: when the pitch leaves, when it
 * arrives, how long it sits there, when it comes back, and whether any of
 * that happens outside the note it belongs to.
 *
 * Nothing here asserts. It reports, and the tests next door assert against
 * what it reports.
 */
import { buildExpressionPlan, type ExpressiveNotePlan } from "@/lib/audio/expression-plan";
import { centsAt } from "@/lib/audio/pitch-gesture";
import type { Song } from "@/lib/song/schema";

export type Trace = {
  readonly id: string;
  readonly startSeconds: number;
  readonly durationSeconds: number;
  /** The first pitch the listener hears, in cents from written. */
  readonly firstCents: number;
  readonly lastCents: number;
  /** When the pitch first stops being where it started. */
  readonly departsAtSeconds: number | null;
  /** When it first reaches its furthest point, and what that point is. */
  readonly peakCents: number;
  readonly arrivesAtSeconds: number | null;
  /** How long it stays within a cent of that furthest point. */
  readonly plateauSeconds: number;
  /** When it leaves the peak again, if it ever does. */
  readonly releaseStartsAtSeconds: number | null;
  /** How far the last automation point is past the end of the note. */
  readonly overrunSeconds: number;
  readonly points: number;
  readonly gainPoints: number;
  readonly expressive: boolean;
  readonly fallbackReason: string | null;
};

const EPS = 1e-6;

export function traceNote(plan: ExpressiveNotePlan, id: string): Trace {
  const points = plan.pitchAutomation;
  const cents = points.map((point) => point.cents);
  const first = cents[0] ?? 0;
  const peak = cents.reduce((far, value) => (Math.abs(value) > Math.abs(far) ? value : far), 0);

  let departs: number | null = null;
  let arrives: number | null = null;
  let releaseStarts: number | null = null;
  let plateauFrom: number | null = null;
  let plateauTo: number | null = null;

  for (const point of points) {
    if (departs === null && Math.abs(point.cents - first) > 0.5) departs = point.timeSeconds;
    const atPeak = Math.abs(point.cents - peak) <= 1;
    if (atPeak) {
      if (arrives === null) arrives = point.timeSeconds;
      if (plateauFrom === null) plateauFrom = point.timeSeconds;
      plateauTo = point.timeSeconds;
    } else if (plateauFrom !== null && releaseStarts === null && arrives !== null) {
      releaseStarts = plateauTo;
    }
  }

  const last = points.at(-1)?.timeSeconds ?? 0;
  return {
    id,
    startSeconds: plan.startSeconds,
    durationSeconds: plan.durationSeconds,
    firstCents: first,
    lastCents: cents.at(-1) ?? 0,
    departsAtSeconds: departs,
    peakCents: peak,
    arrivesAtSeconds: arrives,
    plateauSeconds:
      plateauFrom === null || plateauTo === null ? 0 : round(plateauTo - plateauFrom),
    releaseStartsAtSeconds: releaseStarts,
    overrunSeconds: round(Math.max(0, last - plan.durationSeconds)),
    points: points.length,
    gainPoints: plan.gainEnvelope.length,
    expressive: plan.expressive,
    fallbackReason: plan.fallbackReason ?? null,
  };
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** Every expressive note of a song, traced, in the order they sound. */
export function traceSong(song: Song, options: { practicePercent?: number } = {}): Trace[] {
  const plan = buildExpressionPlan(
    song,
    options.practicePercent === undefined ? {} : { practicePercent: options.practicePercent },
  );
  return plan.notes
    .filter((note) => note.expressive || note.fallbackReason !== undefined)
    .map((note, index) => traceNote(note, `${note.trackId}#${index}@${note.timeTicks}`));
}

/** The pitch actually heard at a series of moments inside a note. */
export function sampleCents(
  plan: ExpressiveNotePlan,
  count: number,
): { readonly atSeconds: number; readonly cents: number }[] {
  const out: { atSeconds: number; cents: number }[] = [];
  for (let index = 0; index <= count; index += 1) {
    const at = (plan.durationSeconds * index) / count;
    out.push({ atSeconds: round(at), cents: round(centsAt(plan.pitchAutomation, at)) });
  }
  return out;
}

export const TRACE_EPSILON = EPS;

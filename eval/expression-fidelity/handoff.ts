/**
 * What happens where the two voices meet (2V-C.3 §3).
 *
 * The founder said the struck slide "biraz kusurlu duruyor". That is a
 * sentence about a moment — the handoff — and not about the travel, which the
 * same card confirmed arrives on time. So this measures the moment: how long
 * the two voices sound together, at what levels, whether either is still
 * moving when the other starts, and whether the level jumps.
 *
 * It reads the production plan. Nothing here asserts and nothing here claims
 * anything about how it sounds; those are two different jobs and this is the
 * first one.
 */
import { buildExpressionPlan, type ExpressiveNotePlan } from "@/lib/audio/expression-plan";
import { centsAt } from "@/lib/audio/pitch-gesture";
import { valueAt } from "@/lib/audio/automation";
import type { Song } from "@/lib/song/schema";

const round = (value: number): number => Math.round(value * 1e6) / 1e6;

/** The gain a note is at, this many seconds into itself. */
function gainAt(note: ExpressiveNotePlan, elapsed: number): number {
  if (note.gainEnvelope.length === 0) return note.gain;
  return valueAt(
    note.gainEnvelope,
    note.gainEnvelope.map((point) => point.value),
    elapsed,
  );
}

export type Handoff = {
  readonly sourceId: string;
  readonly targetId: string;
  /** When the source starts, in song seconds. */
  readonly sourceStart: number;
  readonly targetStart: number;
  /** When the source's own sound ends. */
  readonly sourceEnd: number;
  /** How long both are sounding at once. Zero is a hard cut. */
  readonly overlapSeconds: number;
  /** The source's level at the moment the target is struck. */
  readonly sourceGainAtHandover: number;
  /** The target's level at its own first sample. */
  readonly targetGainAtOnset: number;
  /** The source's level relative to the target's, at the handover. */
  readonly overlapRatio: number;
  /** Where the source's pitch is when the target is struck, in cents. */
  readonly sourceCentsAtHandover: number;
  /** The interval the travel was supposed to cover, in cents. */
  readonly travelCents: number;
  /** How far short of the target the source stops, in cents. */
  readonly arrivalErrorCents: number;
  /** The target's own first pitch. Anything but 0 is the wrong pitch. */
  readonly targetFirstCents: number;
  /** Silence between the source ending and the target starting, in seconds. */
  readonly gapSeconds: number;
  /** How many notes are struck across the pair. */
  readonly attacks: number;
};

/**
 * Every shift-slide handoff in a song, measured.
 *
 * A pair is found by the shape of the plan rather than by asking the Song
 * again: a note whose pitch automation ends away from zero, immediately
 * followed on the same string by one that starts flat.
 */
export function handoffs(song: Song): Handoff[] {
  const plan = buildExpressionPlan(song);
  const out: Handoff[] = [];
  const byStart = [...plan.notes].sort((a, b) => a.startSeconds - b.startSeconds);

  for (const source of byStart) {
    const last = source.pitchAutomation.at(-1);
    if (!last || Math.abs(last.cents) < 1) continue;
    /* A travelling source ends bent away from its own written pitch. */
    const sourceEnd = round(source.startSeconds + source.durationSeconds);
    const target = byStart.find(
      (note) =>
        note !== source &&
        note.position?.stringIndex === source.position?.stringIndex &&
        Math.abs(note.startSeconds - sourceEnd) < 0.02 &&
        note.chainRole === undefined,
    );
    if (!target) continue;

    const overlap = round(Math.max(0, sourceEnd - target.startSeconds));
    const sourceGain = round(gainAt(source, source.durationSeconds));
    const targetGain = round(gainAt(target, 0));

    out.push({
      sourceId: source.id,
      targetId: target.id,
      sourceStart: source.startSeconds,
      targetStart: target.startSeconds,
      sourceEnd,
      overlapSeconds: overlap,
      sourceGainAtHandover: sourceGain,
      targetGainAtOnset: targetGain,
      overlapRatio: targetGain === 0 ? 0 : round(sourceGain / targetGain),
      sourceCentsAtHandover: round(centsAt(source.pitchAutomation, source.durationSeconds)),
      travelCents: round(last.cents),
      arrivalErrorCents: round(
        Math.abs(last.cents - centsAt(source.pitchAutomation, source.durationSeconds)),
      ),
      targetFirstCents: round(centsAt(target.pitchAutomation, 0)),
      gapSeconds: round(Math.max(0, target.startSeconds - sourceEnd)),
      /* Both are ordinary onsets: two picks unless one belongs to a chain. */
      attacks:
        (source.chainRole === "target" ? 0 : 1) + (target.chainRole === "target" ? 0 : 1),
    });
  }

  return out;
}

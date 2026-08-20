/**
 * Practice speed (spec 13.8, phase 2E).
 *
 * One number, and one rule about it: the song's `bpm` is the tempo the piece
 * is written at and never changes, and this scales what playback runs at.
 *
 *     effectiveBpm = song.bpm * practiceRate
 *
 * Two things this deliberately is not:
 *
 * - **It is not part of the song.** It is never written into the Song
 *   Contract, never part of the song's fingerprint, and never part of a
 *   copilot request. Two musicians practising the same song at different
 *   speeds are working on the same song.
 * - **It is not a second tempo system.** There is one transport and one
 *   scheduler; this decides what tempo that transport runs at, and everything
 *   expressed in ticks — the playhead, the active bar, the loop edges, the
 *   metronome — follows from that alone.
 *
 * The arithmetic goes through whole percent rather than a float multiplier, so
 * a step is exact and 132 at 75% is 99 rather than 98.99999999999999.
 */
import { practiceRateLimits } from "@/lib/limits";

/** The multiplier itself: 1 is the song's own tempo. */
export type PracticeRate = number;

export const DEFAULT_PRACTICE_PERCENT = practiceRateLimits.defaultPercent;
export const DEFAULT_PRACTICE_RATE: PracticeRate =
  practiceRateLimits.defaultPercent / 100;

/** Snap to the step and clamp to the bounds. Anything unreadable becomes 100%. */
export function clampPercent(percent: number): number {
  if (!Number.isFinite(percent)) return practiceRateLimits.defaultPercent;
  const snapped =
    Math.round(percent / practiceRateLimits.stepPercent) *
    practiceRateLimits.stepPercent;
  return Math.min(
    practiceRateLimits.maxPercent,
    Math.max(practiceRateLimits.minPercent, snapped),
  );
}

/** One step up or down, never past the bounds. */
export function stepPercent(percent: number, direction: 1 | -1): number {
  return clampPercent(
    clampPercent(percent) + direction * practiceRateLimits.stepPercent,
  );
}

export function isDefaultPercent(percent: number): boolean {
  return clampPercent(percent) === practiceRateLimits.defaultPercent;
}

/** The multiplier for a whole-percent setting. */
export function rateOf(percent: number): PracticeRate {
  return clampPercent(percent) / 100;
}

/**
 * What the transport actually runs at.
 *
 * A fractional result is kept as it is — 132 at 85% really is 112.2 BPM, and
 * rounding it here would make the sound and the number on screen disagree.
 * Formatting is the interface's job.
 */
export function effectiveBpm(songBpm: number, percent: number): number {
  return (songBpm * clampPercent(percent)) / 100;
}

/** At most one decimal, and no trailing `.0`. */
export function formatBpm(bpm: number): string {
  const rounded = Math.round(bpm * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

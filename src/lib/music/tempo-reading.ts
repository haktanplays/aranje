/**
 * What the stored BPM number means, said out loud (2V-D.2 §13).
 *
 * ## Measured before anything was written
 *
 * The question the brief asks first is which note value the stored tempo
 * counts per minute, and whether playback and export agree. They do, and it is
 * the quarter:
 *
 * - `audio/tempo.ts` computes `secondsPerTick = 60 / (bpm * PPQ)`, and PPQ is
 *   ticks per **quarter**, so a tick is a quarter's worth divided by PPQ.
 * - `export/midi` writes `60_000_000 / bpm` microseconds per quarter.
 *
 * Those are the same statement. So there is nothing here to migrate, and this
 * module deliberately does **not** change what a stored number means. It only
 * says what it already means, in the places a reader would otherwise have to
 * guess — which is the actual defect: a 6/8 song at 132 does not have 132 of
 * anything a player counts.
 *
 * ## Two numbers, one of them derived
 *
 * `Tempo: 132 dörtlük/dk` is the stored fact. `6/8 ana vuruşu: 88/dk` is the
 * same tempo expressed in the beat the player taps, and it is derived here
 * rather than stored — a second stored tempo would be a second answer, and
 * the first time they disagreed nobody would know which one the music used.
 *
 * ## What it refuses to say
 *
 * A single felt-beat tempo for a metre whose beats are different lengths.
 * 7/8 felt `2+2+3` has no beats-per-minute: two of its beats are a quarter
 * long and one is a dotted quarter, so any single number would be an average
 * of two things a player never plays. It says so instead.
 */
import { meterBeats } from "@/lib/music/meter-beats";
import type { BeatGrouping } from "@/lib/music/rhythm-profile";
import {
  PPQ,
  ticksPerSlot,
  type Resolution,
  type TimeSignature,
} from "@/lib/music/timing";

/** The note value the stored BPM counts. One place, so nothing may differ. */
export const BPM_UNIT_TICKS = PPQ;

/** What that note value is called, for the line a reader sees. */
export const BPM_UNIT_LABEL = "dörtlük";

export type TempoReading = {
  /** The stored number, unchanged. */
  readonly bpm: number;
  /** "Tempo: 132 dörtlük/dk" — the canonical fact, never hidden. */
  readonly canonical: string;
  /**
   * "6/8 ana vuruşu: 88/dk", or null.
   *
   * Null in two cases, and they are different: a metre whose felt beat *is*
   * the quarter has nothing to add, and a metre with uneven beats has no
   * single answer. `unevenBeats` tells them apart.
   */
  readonly feltBeat: string | null;
  /** True when the beats differ in length, so no single felt tempo exists. */
  readonly unevenBeats: boolean;
};

/**
 * How many of the metre's main beats go past in a minute.
 *
 * Null when the beats are not all the same length — see the header. The
 * arithmetic is one line and it is the whole of the conversion: a beat that
 * lasts `n` quarters happens `bpm / n` times a minute.
 */
export function feltBeatsPerMinute(input: {
  readonly bpm: number;
  readonly meter: TimeSignature;
  readonly resolution: Resolution;
  readonly grouping?: BeatGrouping;
}): number | null {
  const beats = meterBeats(input as Parameters<typeof meterBeats>[0]);
  if (beats.length === 0) return null;
  const step = ticksPerSlot(input.resolution);
  const lengths = new Set(beats.map((beat) => beat.slots * step));
  if (lengths.size !== 1) return null;
  const quartersPerBeat = [...lengths][0]! / BPM_UNIT_TICKS;
  return input.bpm / quartersPerBeat;
}

/** Both lines a tempo control shows, from one stored number. */
export function readTempo(input: {
  readonly bpm: number;
  readonly meter: TimeSignature;
  readonly resolution: Resolution;
  readonly grouping?: BeatGrouping;
}): TempoReading {
  const canonical = `Tempo: ${round(input.bpm)} ${BPM_UNIT_LABEL}/dk`;
  const perMinute = feltBeatsPerMinute(input);
  const [numerator, denominator] = input.meter;

  if (perMinute === null) {
    return { bpm: input.bpm, canonical, feltBeat: null, unevenBeats: true };
  }
  /*
   * Nothing to add when the beat already *is* the quarter: showing "4/4 ana
   * vuruşu: 132/dk" beside "Tempo: 132 dörtlük/dk" is the same number twice,
   * and two lines saying one thing is how a reader learns to stop reading.
   */
  if (perMinute === input.bpm) {
    return { bpm: input.bpm, canonical, feltBeat: null, unevenBeats: false };
  }
  return {
    bpm: input.bpm,
    canonical,
    feltBeat: `${numerator}/${denominator} ana vuruşu: ${round(perMinute)}/dk`,
    unevenBeats: false,
  };
}

/** Whole numbers where the tempo is one, one decimal where it is not. */
function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

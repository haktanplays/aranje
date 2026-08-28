/**
 * Headroom on the way out (2T §10).
 *
 * ## What was measured, before anything was changed
 *
 * The founder heard the guitar as "firing a gun" — a hard, brittle transient
 * rather than a picked string. The temptation is to lengthen an attack
 * envelope until it stops sounding like that, which would be treating a
 * symptom nobody had located. `eval/chord-audio/artifacts/HEADROOM.json`,
 * rendered offline through the production chain in 2O-B.1, had already
 * located it:
 *
 *   six-note chord, tracks at 0 dB      peak  +5.15 dBFS   1576 clipped
 *   two guitars, twelve notes            peak  +4.17 dBFS    644 clipped
 *   six notes, hard panned               peak  +2.16 dBFS     18 clipped
 *   six notes at −6 dB (the template)    peak  −0.85 dBFS      0 clipped
 *
 * The master was a unity `Gain` wired straight to the destination, with
 * nothing between it and the speaker. Samples sum linearly, so ordinary
 * material — a full chord, or a second guitar — went over full scale and the
 * conversion to output clipped it. Clipping *is* a hard transient: it is a
 * square edge where a decaying string should be. And the template mix, which
 * does not clip, has eight tenths of a decibel to spare, which is not
 * headroom, it is luck.
 *
 * ## Why a trim alone is not the answer
 *
 * Trimming the master by the worst case would need about −5 dB, and would
 * spend it on every quiet passage as well — paying for the pathological case
 * out of the common one. So there are two stages, and they do different jobs:
 *
 * - **Headroom** is a fixed, linear trim. It changes no timbre and no
 *   dynamics; it only moves everything down so the ceiling is reachable.
 * - **The ceiling** catches what is still above it after that. It should be
 *   doing nothing at all on ordinary material — a limiter that is always
 *   working is a compressor nobody asked for.
 *
 * ## What this file does and does not claim
 *
 * It claims the measured clipping. It does not claim the guitar now sounds
 * organic: that is a judgement about timbre, it needs ears, and §10 is
 * explicit that only Haktan's physical listening can settle it. What can be
 * said without ears is that a square edge at the output is gone.
 */

/**
 * The fixed trim, in dB.
 *
 * −3 rather than −5: it clears the template mix's real peak with two and a
 * half decibels to spare and leaves the pathological cases to the ceiling,
 * which is what a ceiling is for. Larger would make every ordinary passage
 * quieter to buy protection the ceiling already provides.
 */
export const MASTER_HEADROOM_DB = -3;

/**
 * Where the ceiling sits, in dBFS.
 *
 * Below zero rather than at it, because a sample-peak ceiling at 0 still lets
 * the true peak between samples go over on conversion — the inter-sample
 * overshoot that makes an otherwise clean mix crackle on a phone's DAC.
 */
export const MASTER_CEILING_DB = -1;

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}

/** The linear gain the master runs at. */
export function masterGain(): number {
  return dbToGain(MASTER_HEADROOM_DB);
}

/**
 * What a measured peak becomes after the headroom stage, before the ceiling.
 *
 * Used by the acceptance measurement to state the improvement in the same
 * units the baseline was stated in, rather than asserting one.
 */
export function afterHeadroomDbfs(peakDbfs: number): number {
  return peakDbfs + MASTER_HEADROOM_DB;
}

/**
 * True when a peak would still be over the ceiling after the trim — which is
 * to say, when the ceiling has work to do.
 *
 * On the four measured cases this is false for the template mix and true for
 * the dense and two-guitar ones, which is exactly the division of labour the
 * two stages are meant to have.
 */
export function needsCeiling(peakDbfs: number): boolean {
  return afterHeadroomDbfs(peakDbfs) > MASTER_CEILING_DB;
}

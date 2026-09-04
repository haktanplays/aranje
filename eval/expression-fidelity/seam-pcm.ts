/**
 * What the rendered waveform does where two notes meet (2V-C.4 §3).
 *
 * ## Why this exists
 *
 * 2V-C.3 measured the shift slide's seam at the **event** level and found it
 * adjacent: overlap 0 s, gap 0 s, arrival error 0 cents, target struck at its
 * own pitch and its own moment. Every one of those numbers is still true.
 *
 * The founder then listened and said "there is a tiny gap between the two
 * sounds". Both can be right, because they are claims about different things:
 * a scheduler saying two events abut says nothing about whether the *energy*
 * abuts. One voice can be fading while the other's attack has not yet risen,
 * and the arithmetic of when they were told to start does not notice.
 *
 * So this reads the actual PCM the production offline renderer produced and
 * measures the energy across the seam. Nothing here re-reads an automation
 * list; nothing here synthesises a waveform; there is no second engine.
 *
 * ## What it can and cannot claim
 *
 * It measures an acoustic valley: how far the short-time energy dips between
 * two notes, how long it stays down, and whether the waveform jumps. It
 * **cannot** claim a human hears a gap or does not — that is what the
 * listening cards are for. What it provides is a number that can be compared
 * before and after a change, and a gate that fails when a real hole opens.
 *
 * ## Why one threshold was not enough
 *
 * The first real run settled that. A legato slide's seam holds 0.81 of the
 * energy around it; a written rest holds 0. But two ordinary picked notes,
 * the same note struck twice with nothing written between them, hold 0.086 —
 * because the first one is releasing while the second's attack is still
 * rising, which is simply what a picked instrument does. A single floor that
 * calls a legato slide continuous therefore calls normal playing broken.
 *
 * So a seam is measured against what *kind* of seam it is, and the classes
 * below carry the limits. The one rule that keeps this from being fitted to
 * whatever numbers came out: a seam with a connection written across it must
 * be measurably better than the same two notes with no connection written at
 * all. That is the weakest thing "connected" can mean, and the unconnected
 * re-strike is a fixture, so the comparison is a measurement rather than a
 * taste.
 */

/** Below this a frame is digital silence rather than a quiet sound. */
export const SILENCE_FLOOR = 1e-4;

/**
 * How far below its neighbours a dip has to go to count as a valley.
 *
 * Relative rather than absolute, because a quiet passage's seam is quiet on
 * both sides and an absolute threshold would call all of it a gap. Absolute
 * silence is checked separately: a run of frames under `SILENCE_FLOOR` is a
 * hole whatever the surrounding level is.
 */
export const VALLEY_RATIO_FLOOR = 0.25;

export type SeamWindow = {
  /** Seconds either side of the seam that the analysis covers. */
  readonly radiusSeconds: number;
  /** Short-time window, in seconds. */
  readonly frameSeconds: number;
};

export const DEFAULT_WINDOW: SeamWindow = {
  radiusSeconds: 0.12,
  frameSeconds: 0.002,
};

export type SeamMeasurement = {
  readonly seamSeconds: number;
  readonly sampleRate: number;
  /** Short-time RMS per frame across the window, oldest first. */
  readonly rms: readonly number[];
  /** Peak magnitude per frame. */
  readonly peak: readonly number[];
  /** Seconds of the first frame, so a caller can place the others. */
  readonly firstFrameSeconds: number;
  readonly frameSeconds: number;

  /** Median RMS of the frames before the seam. */
  readonly beforeMedianRms: number;
  /** Median RMS of the frames after it. */
  readonly afterMedianRms: number;
  /** The quietest frame anywhere in the window. */
  readonly minRms: number;
  /** When that frame is, in seconds. */
  readonly minRmsSeconds: number;
  /** `minRms` over the smaller of the two medians. 1 is no dip at all. */
  readonly valleyRatio: number;

  /** The last frame before the seam with real energy in it, in seconds. */
  readonly sourceLastEnergySeconds: number | null;
  /** The first frame after the seam with real energy in it, in seconds. */
  readonly targetFirstEnergySeconds: number | null;
  /** Silence between those two. Zero when they touch. */
  readonly silentSeconds: number;

  /** Frames under the absolute floor, consecutively, around the seam. */
  readonly silentFrames: number;
  /** The largest sample-to-sample jump in the window. A click's signature. */
  readonly maxStep: number;
  /** Where that jump is, in seconds. */
  readonly maxStepSeconds: number;
  /** When the loudest frame after the seam happens — the target's transient. */
  readonly targetPeakSeconds: number | null;
  readonly targetPeak: number;

  readonly clipped: number;
  readonly invalid: number;
};

/** One mono view of however many channels were rendered. */
function mono(channels: readonly Float32Array[]): Float32Array {
  const first = channels[0];
  if (!first) return new Float32Array(0);
  if (channels.length === 1) return first;
  const out = new Float32Array(first.length);
  for (let index = 0; index < out.length; index += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[index] ?? 0;
    out[index] = sum / channels.length;
  }
  return out;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

/**
 * Measure the seam at `seamSeconds` in this rendered audio.
 *
 * Pure and total: an empty buffer, a seam outside the audio, or a window
 * wider than the recording all come back as a measurement rather than an
 * exception, because a harness that throws in one case reports nothing about
 * the others.
 */
export function measureSeam(
  channels: readonly Float32Array[],
  sampleRate: number,
  seamSeconds: number,
  window: SeamWindow = DEFAULT_WINDOW,
): SeamMeasurement {
  const samples = mono(channels);
  const frameLength = Math.max(1, Math.round(window.frameSeconds * sampleRate));
  const radius = Math.max(frameLength, Math.round(window.radiusSeconds * sampleRate));
  const seamIndex = Math.round(seamSeconds * sampleRate);
  const from = Math.max(0, seamIndex - radius);
  const to = Math.min(samples.length, seamIndex + radius);

  const rms: number[] = [];
  const peak: number[] = [];
  let clipped = 0;
  let invalid = 0;
  let maxStep = 0;
  let maxStepAt = from;

  for (let start = from; start + frameLength <= to; start += frameLength) {
    let sumSquares = 0;
    let framePeak = 0;
    for (let index = start; index < start + frameLength; index += 1) {
      const sample = samples[index] ?? 0;
      if (!Number.isFinite(sample)) {
        invalid += 1;
        continue;
      }
      const size = Math.abs(sample);
      if (size >= 0.999) clipped += 1;
      if (size > framePeak) framePeak = size;
      sumSquares += sample * sample;
      if (index > from) {
        const step = Math.abs(sample - (samples[index - 1] ?? 0));
        if (step > maxStep) {
          maxStep = step;
          maxStepAt = index;
        }
      }
    }
    rms.push(Math.sqrt(sumSquares / frameLength));
    peak.push(framePeak);
  }

  const firstFrameSeconds = from / sampleRate;
  const frameAt = (index: number) => firstFrameSeconds + index * window.frameSeconds;
  const seamFrame = Math.max(
    0,
    Math.min(rms.length, Math.round((seamSeconds - firstFrameSeconds) / window.frameSeconds)),
  );

  const before = rms.slice(0, seamFrame);
  const after = rms.slice(seamFrame);
  const beforeMedian = median(before);
  const afterMedian = median(after);
  let minRms = 0;
  let minRmsAt = firstFrameSeconds;
  rms.forEach((value, index) => {
    if (index === 0 || value < minRms) {
      minRms = value;
      minRmsAt = frameAt(index);
    }
  });
  const floor = Math.min(beforeMedian, afterMedian);

  /*
   * The last real energy before the seam, and the first after it. "Real"
   * means above the absolute floor: a frame at 1e-6 is silence with rounding
   * in it, and calling that continuity is how a gap hides behind a ratio.
   */
  let sourceLast: number | null = null;
  for (let index = seamFrame - 1; index >= 0; index -= 1) {
    if ((rms[index] ?? 0) > SILENCE_FLOOR) {
      sourceLast = frameAt(index) + window.frameSeconds;
      break;
    }
  }
  let targetFirst: number | null = null;
  for (let index = seamFrame; index < rms.length; index += 1) {
    if ((rms[index] ?? 0) > SILENCE_FLOOR) {
      targetFirst = frameAt(index);
      break;
    }
  }

  /* Consecutive dead frames spanning the seam. */
  let silentFrames = 0;
  for (let index = seamFrame; index < rms.length; index += 1) {
    if ((rms[index] ?? 0) > SILENCE_FLOOR) break;
    silentFrames += 1;
  }
  for (let index = seamFrame - 1; index >= 0; index -= 1) {
    if ((rms[index] ?? 0) > SILENCE_FLOOR) break;
    silentFrames += 1;
  }

  let targetPeak = 0;
  let targetPeakAt: number | null = null;
  for (let index = seamFrame; index < peak.length; index += 1) {
    if ((peak[index] ?? 0) > targetPeak) {
      targetPeak = peak[index] ?? 0;
      targetPeakAt = frameAt(index);
    }
  }

  return {
    seamSeconds,
    sampleRate,
    rms,
    peak,
    firstFrameSeconds,
    frameSeconds: window.frameSeconds,
    beforeMedianRms: round(beforeMedian),
    afterMedianRms: round(afterMedian),
    minRms: round(minRms),
    minRmsSeconds: round(minRmsAt),
    valleyRatio: floor === 0 ? 0 : round(minRms / floor),
    sourceLastEnergySeconds: sourceLast === null ? null : round(sourceLast),
    targetFirstEnergySeconds: targetFirst === null ? null : round(targetFirst),
    silentSeconds:
      sourceLast === null || targetFirst === null
        ? 0
        : round(Math.max(0, targetFirst - sourceLast)),
    silentFrames,
    maxStep: round(maxStep),
    maxStepSeconds: round(maxStepAt / sampleRate),
    targetPeakSeconds: targetPeakAt === null ? null : round(targetPeakAt),
    targetPeak: round(targetPeak),
    clipped,
    invalid,
  };
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export type SeamVerdict = {
  readonly ok: boolean;
  /** Every reason it is not ok. Empty when it is. */
  readonly problems: readonly string[];
};

/**
 * Whether this seam has a hole in it.
 *
 * Two independent tests, on purpose. **Absolute**: any run of frames under
 * the silence floor is a hole, however quiet the music around it. **Relative**:
 * a dip far below both neighbours is a hole even when it is not silent,
 * because a note that drops to a twentieth of its surroundings and comes back
 * is what a gap sounds like. A single threshold tuned on one fixture would
 * pass the other kind.
 */
export function seamVerdict(
  seam: SeamMeasurement,
  limits: {
    readonly maxSilentSeconds?: number;
    readonly minValleyRatio?: number;
    readonly maxStep?: number;
  } = {},
): SeamVerdict {
  const maxSilent = limits.maxSilentSeconds ?? 0;
  const minValley = limits.minValleyRatio ?? VALLEY_RATIO_FLOOR;
  const maxStep = limits.maxStep ?? 0.5;
  const problems: string[] = [];

  if (seam.silentSeconds > maxSilent) {
    problems.push(`silence of ${seam.silentSeconds}s across the seam`);
  }
  if (seam.valleyRatio < minValley) {
    problems.push(`energy dips to ${seam.valleyRatio} of its surroundings`);
  }
  if (seam.maxStep > maxStep) {
    problems.push(`sample jump of ${seam.maxStep}`);
  }
  if (seam.clipped > 0) problems.push(`${seam.clipped} clipped samples`);
  if (seam.invalid > 0) problems.push(`${seam.invalid} non-finite samples`);
  /* A window with no energy at all is not a continuous seam; it is nothing,
     and a ratio computed from two zeroes would report it as perfect. */
  if (seam.beforeMedianRms <= SILENCE_FLOOR && seam.afterMedianRms <= SILENCE_FLOOR) {
    problems.push("no sound on either side of the seam");
  }

  return { ok: problems.length === 0, problems };
}

/**
 * What kind of seam this is, which is what decides how it must behave.
 *
 * - `joined` — nothing is struck across it. A legato slide, a hammer-on, a
 *   pull-off, one note held. The string never stops, so the energy must not
 *   dip much.
 * - `connected` — the target *is* struck, and a connection is written. A
 *   shift slide, a shape shift. A new attack is expected, so the seam cannot
 *   be asked to look like a held note; what it must do is beat `restrike`,
 *   because otherwise writing the connection changed nothing.
 * - `restrike` — the same two notes with nothing written between them. The
 *   reference, not a target. Gated only on silence, clicks and clipping: its
 *   valley is the number the connected classes have to improve on.
 * - `broken` — a written rest. The analyzer has to find this hole. If it ever
 *   stops finding it, it is finding nothing.
 */
export type SeamClass = "joined" | "connected" | "restrike" | "broken";

export type SeamLimits = {
  readonly maxSilentSeconds?: number;
  readonly minValleyRatio?: number;
  readonly maxStep?: number;
};

/**
 * The limits per class.
 *
 * `joined` uses the plain valley floor. `connected` sits below it because a
 * struck target has a real attack in it and cannot hold a held note's energy
 * — but well above the 0.086 an unconnected re-strike measured, which is the
 * only thing that makes the number mean anything. `restrike` has no valley
 * floor at all, so it can never be quietly relaxed to let something else
 * through. `broken` has no limits because it is asserted the other way round.
 */
export const SEAM_CLASS_LIMITS: Readonly<Record<SeamClass, SeamLimits>> = {
  joined: { minValleyRatio: VALLEY_RATIO_FLOOR },
  connected: { minValleyRatio: 0.2 },
  restrike: { minValleyRatio: 0 },
  broken: {},
};

/** Whether a seam of this class should come back ok. */
export function expectsContinuity(seamClass: SeamClass): boolean {
  return seamClass !== "broken";
}

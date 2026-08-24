/**
 * Measuring pitch and attack in rendered audio (2P-A §12).
 *
 * Evaluation only, no new runtime dependency, and deliberately modest about
 * what it can do. Two jobs:
 *
 *  - **F0 over time**, so "did the bend actually reach +200 cents, and when"
 *    is a number rather than an impression.
 *  - **Transient energy**, so "does the target get struck again" is a number
 *    rather than an argument.
 *
 * The pitch tracker is normalised autocorrelation with parabolic
 * interpolation — the core of YIN without its cumulative-mean normalisation.
 * It is validated against synthetic tones before it is pointed at anything
 * real (see `analysis.test.ts`), and it reports its own confidence so an
 * unvoiced frame can be dropped rather than turned into a pitch that was
 * never there.
 *
 * It is monophonic. On a chord it would lock onto one partial and call it the
 * note; that is why chord fixtures are measured through **isolated renders**
 * of one string rather than through this.
 */

/** One analysis frame. `hz` is null when the frame was not voiced enough. */
export type PitchFrame = {
  readonly timeSeconds: number;
  readonly hz: number | null;
  /** Peak of the normalised autocorrelation, 0..1. */
  readonly confidence: number;
  readonly rms: number;
};

export type PitchTrackOptions = {
  readonly sampleRate: number;
  /** Analysis window, in seconds. Long enough for two periods of the lowest f0. */
  readonly windowSeconds?: number;
  readonly hopSeconds?: number;
  readonly minHz?: number;
  readonly maxHz?: number;
  /** Below this normalised correlation the frame is called unvoiced. */
  readonly minConfidence?: number;
  /** Below this RMS the frame is silence, whatever the correlation says. */
  readonly minRms?: number;
};

const DEFAULTS = {
  windowSeconds: 0.06,
  hopSeconds: 0.01,
  minHz: 60,
  maxHz: 1400,
  minConfidence: 0.72,
  minRms: 0.0015,
};

function rmsOf(samples: Float32Array, from: number, length: number): number {
  let sum = 0;
  for (let index = from; index < from + length; index += 1) {
    const value = samples[index] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum / Math.max(1, length));
}

/**
 * The fundamental of one window, or null.
 *
 * Normalised autocorrelation over the lag range the caller allows, then a
 * parabolic fit around the winning lag so the answer is not quantised to
 * whole samples — at 44.1 kHz a whole-sample lag near 440 Hz is already
 * about 17 cents wide, which is coarser than anything worth measuring here.
 */
export function fundamentalOf(
  samples: Float32Array,
  from: number,
  length: number,
  options: { sampleRate: number; minHz: number; maxHz: number },
): { hz: number | null; confidence: number } {
  const minLag = Math.floor(options.sampleRate / options.maxHz);
  const maxLag = Math.min(Math.floor(options.sampleRate / options.minHz), length - 1);
  if (maxLag <= minLag) return { hz: null, confidence: 0 };

  let energy = 0;
  for (let index = 0; index < length; index += 1) {
    const value = samples[from + index] ?? 0;
    energy += value * value;
  }
  if (energy <= 0) return { hz: null, confidence: 0 };

  /** Normalised correlation at one lag. Cached, because it is asked twice. */
  const cache = new Map<number, number>();
  const scoreAt = (lag: number): number => {
    if (lag < 1 || lag >= length) return -1;
    const cached = cache.get(lag);
    if (cached !== undefined) return cached;
    let correlation = 0;
    let lagEnergy = 0;
    const span = length - lag;
    for (let index = 0; index < span; index += 1) {
      const a = samples[from + index] ?? 0;
      const b = samples[from + index + lag] ?? 0;
      correlation += a * b;
      lagEnergy += b * b;
    }
    const norm = Math.sqrt(energy * lagEnergy);
    const score = norm > 0 ? correlation / norm : 0;
    cache.set(lag, score);
    return score;
  };

  let bestLag = -1;
  let bestScore = -1;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const score = scoreAt(lag);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  if (bestLag < 0 || bestScore <= 0) return { hz: null, confidence: 0 };

  /*
   * Octave guard.
   *
   * Autocorrelation is just as happy at twice the period, and on a plucked
   * string the second peak is often the taller one. If a lag near half the
   * winner scores nearly as well, the shorter one is the fundamental.
   */
  const half = Math.round(bestLag / 2);
  if (half >= minLag && scoreAt(half) > bestScore * 0.9) bestLag = half;

  /** Sub-sample peak position, by fitting a parabola to three scores. */
  const interpolate = (lag: number): number => {
    const before = scoreAt(lag - 1);
    const at = scoreAt(lag);
    const after = scoreAt(lag + 1);
    const denominator = before - 2 * at + after;
    const shift = denominator === 0 ? 0 : (0.5 * (before - after)) / denominator;
    return lag + Math.max(-1, Math.min(1, shift));
  };

  /*
   * Measure across as many periods as the window holds.
   *
   * One period resolves to whatever half a sample is worth at that pitch,
   * and at the bottom of a guitar's range that was costing four cents. The
   * k-th repeat of the same waveform sits at k periods, so finding *that*
   * peak and dividing by k divides the error by k as well. The search is
   * narrow — a quarter of a period either side — so it cannot wander onto a
   * neighbouring peak and report a different note.
   */
  const furthest = Math.floor(length * 0.75);
  const periods = Math.max(1, Math.floor(furthest / bestLag));
  let refined = interpolate(bestLag);
  if (periods > 1) {
    const target = bestLag * periods;
    const room = Math.max(1, Math.floor(bestLag / 4));
    let peak = -1;
    let peakScore = -1;
    for (let lag = target - room; lag <= Math.min(furthest, target + room); lag += 1) {
      const score = scoreAt(lag);
      if (score > peakScore) {
        peakScore = score;
        peak = lag;
      }
    }
    if (peak > 0 && peakScore > bestScore * 0.5) refined = interpolate(peak) / periods;
  }

  return { hz: options.sampleRate / refined, confidence: bestScore };
}

/** F0 over the whole signal, frame by frame. */
export function trackPitch(
  samples: Float32Array,
  options: PitchTrackOptions,
): readonly PitchFrame[] {
  const settings = { ...DEFAULTS, ...options };
  const window = Math.round(settings.windowSeconds * settings.sampleRate);
  const hop = Math.round(settings.hopSeconds * settings.sampleRate);
  const frames: PitchFrame[] = [];

  for (let start = 0; start + window <= samples.length; start += hop) {
    const rms = rmsOf(samples, start, window);
    if (rms < settings.minRms) {
      frames.push({
        timeSeconds: start / settings.sampleRate,
        hz: null,
        confidence: 0,
        rms,
      });
      continue;
    }
    const found = fundamentalOf(samples, start, window, {
      sampleRate: settings.sampleRate,
      minHz: settings.minHz,
      maxHz: settings.maxHz,
    });
    frames.push({
      timeSeconds: start / settings.sampleRate,
      // An unvoiced frame is reported as unvoiced, never as a guessed pitch.
      hz: found.confidence >= settings.minConfidence ? found.hz : null,
      confidence: found.confidence,
      rms,
    });
  }

  return frames;
}

export const centsBetween = (hz: number, referenceHz: number): number =>
  1200 * Math.log2(hz / referenceHz);

/** Cents relative to a reference, for every voiced frame. */
export function centsTrack(
  frames: readonly PitchFrame[],
  referenceHz: number,
): readonly { timeSeconds: number; cents: number }[] {
  return frames
    .filter((frame): frame is PitchFrame & { hz: number } => frame.hz !== null)
    .map((frame) => ({
      timeSeconds: frame.timeSeconds,
      cents: centsBetween(frame.hz, referenceHz),
    }));
}

/* ------------------------------------------------------------- transients */

export type EnergyWindow = {
  readonly timeSeconds: number;
  readonly peak: number;
  readonly rms: number;
};

/** Short-window energy, for reading an attack rather than a note. */
export function energyWindows(
  samples: Float32Array,
  sampleRate: number,
  windowMs = 5,
): readonly EnergyWindow[] {
  const window = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  const out: EnergyWindow[] = [];
  for (let start = 0; start + window <= samples.length; start += window) {
    let peak = 0;
    let sum = 0;
    for (let index = start; index < start + window; index += 1) {
      const value = samples[index] ?? 0;
      peak = Math.max(peak, Math.abs(value));
      sum += value * value;
    }
    out.push({
      timeSeconds: start / sampleRate,
      peak,
      rms: Math.sqrt(sum / window),
    });
  }
  return out;
}

/**
 * How much of a new attack there is at a given moment.
 *
 * The ratio of the energy just after the moment to the energy just before it.
 * A legato transition leaves this near or below one — nothing was struck. A
 * restrike pushes it well above one, because a pick or a finger puts energy
 * into a string that was already decaying.
 *
 * It is a ratio on purpose: absolute levels depend on the note, the preset
 * and the mix, and none of those is what the question is about.
 */
export function attackRatioAt(
  samples: Float32Array,
  sampleRate: number,
  atSeconds: number,
  spanMs = 12,
): { before: number; after: number; ratio: number } {
  const span = Math.max(1, Math.round((spanMs / 1000) * sampleRate));
  const at = Math.round(atSeconds * sampleRate);
  const beforeStart = Math.max(0, at - span);
  const before = rmsOf(samples, beforeStart, Math.min(span, samples.length - beforeStart));
  const afterStart = Math.min(samples.length - 1, at);
  const after = rmsOf(samples, afterStart, Math.min(span, samples.length - afterStart));
  return { before, after, ratio: before > 0 ? after / before : after > 0 ? Infinity : 0 };
}

/**
 * Spectral centroid of one window, in Hz — "how bright is this moment".
 *
 * A plain DFT over a modest window. It is O(n²) and that is fine: it runs on
 * a few thousand samples of a few dozen fixtures, in an eval script.
 */
export function spectralCentroid(
  samples: Float32Array,
  from: number,
  length: number,
  sampleRate: number,
  bins = 256,
): number {
  let weighted = 0;
  let total = 0;
  for (let bin = 1; bin < bins; bin += 1) {
    const hz = (bin * sampleRate) / (2 * bins);
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < length; index += 1) {
      const angle = (2 * Math.PI * bin * index) / (2 * bins);
      const value = samples[from + index] ?? 0;
      real += value * Math.cos(angle);
      imaginary -= value * Math.sin(angle);
    }
    const magnitude = Math.sqrt(real * real + imaginary * imaginary);
    weighted += hz * magnitude;
    total += magnitude;
  }
  return total > 0 ? weighted / total : 0;
}

/** Energy in one frequency band, for reading fret noise against the note. */
export function bandEnergy(
  samples: Float32Array,
  from: number,
  length: number,
  sampleRate: number,
  lowHz: number,
  highHz: number,
  bins = 256,
): number {
  let total = 0;
  for (let bin = 1; bin < bins; bin += 1) {
    const hz = (bin * sampleRate) / (2 * bins);
    if (hz < lowHz || hz > highHz) continue;
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < length; index += 1) {
      const angle = (2 * Math.PI * bin * index) / (2 * bins);
      const value = samples[from + index] ?? 0;
      real += value * Math.cos(angle);
      imaginary -= value * Math.sin(angle);
    }
    total += Math.sqrt(real * real + imaginary * imaginary);
  }
  return total;
}

/**
 * Deterministic noise, for the fret-noise candidate (2P-A §11).
 *
 * A 32-bit xorshift seeded from a benchmark identity, so the same candidate
 * renders the same samples on every run and two runs can be compared at all.
 * The seed never touches a Song: it is derived from the fixture name here,
 * in eval code, and nowhere else.
 */
export function seededNoise(seed: number, length: number): Float32Array {
  let state = seed >>> 0 || 0x9e3779b9;
  const out = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    // 0..1 → −1..1
    out[index] = (state / 0xffffffff) * 2 - 1;
  }
  return out;
}

/** A stable 32-bit seed from a fixture name. Benchmark identity, not song data. */
export function seedFrom(name: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

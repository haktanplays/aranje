/**
 * What a rendered clip actually contains (2W §5).
 *
 * The founder is going to be asked "does this sound right", and that question
 * is only worth asking if there is a sound. A clip that renders to silence,
 * or to a wall of clipping, or to `NaN`, would still draw a play button and
 * still collect an answer — and the answer would be about nothing.
 *
 * So every rendered take is measured before it is offered, by this function,
 * and the numbers go into the manifest. Pure: it takes sample data and
 * returns numbers, which is why the same checks run in a browser harness and
 * in a unit test over synthetic buffers.
 */

/** The threshold above which a sample counts as clipped. */
const CLIP_CEILING = 0.999;

/** Below this peak there is nothing to listen to. */
const SILENCE_FLOOR = 1e-4;

export type ClipAudit = {
  readonly frames: number;
  readonly seconds: number;
  readonly peak: number;
  readonly rms: number;
  /** Samples at or beyond full scale. Zero is the only acceptable answer. */
  readonly clipped: number;
  /** Samples that are not finite numbers. Zero is the only acceptable one. */
  readonly invalid: number;
  readonly silent: boolean;
};

export function auditClip(
  channels: readonly Float32Array[],
  sampleRate: number,
): ClipAudit {
  let peak = 0;
  let sumSquares = 0;
  let count = 0;
  let clipped = 0;
  let invalid = 0;

  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      const sample = channel[index] ?? 0;
      if (!Number.isFinite(sample)) {
        invalid += 1;
        continue;
      }
      const size = Math.abs(sample);
      if (size > peak) peak = size;
      if (size >= CLIP_CEILING) clipped += 1;
      sumSquares += sample * sample;
      count += 1;
    }
  }

  const frames = channels[0]?.length ?? 0;
  return {
    frames,
    seconds: sampleRate > 0 ? frames / sampleRate : 0,
    peak,
    rms: count > 0 ? Math.sqrt(sumSquares / count) : 0,
    clipped,
    invalid,
    silent: peak < SILENCE_FLOOR,
  };
}

/** Why a rendered take must not be offered, or null when it is fine. */
export function clipFault(
  audit: ClipAudit,
  bounds: { readonly minSeconds: number; readonly maxSeconds: number },
): string | null {
  if (audit.invalid > 0) return "geçersiz örnek";
  if (audit.silent) return "sessiz";
  if (audit.clipped > 0) return "kırpılma";
  if (audit.seconds < bounds.minSeconds) return "çok kısa";
  if (audit.seconds > bounds.maxSeconds) return "çok uzun";
  return null;
}

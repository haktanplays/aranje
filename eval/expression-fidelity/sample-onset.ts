/**
 * Where a recorded note actually starts (2V-C.4 §5).
 *
 * The seam measurement pointed here. In a shift slide the source's energy
 * ends a few milliseconds after the notated onset and the target's does not
 * arrive for another fifteen — so before touching a fade curve, the question
 * is what the target buffer does in its own first frames.
 *
 * Two possibilities the round has to separate, because their fixes are not
 * the same one:
 *
 * 1. **Leading silence.** The file begins with digital silence, so a source
 *    that stops at the onset stops before anything replaces it. Skipping it
 *    is an offset, and an offset is cheap.
 * 2. **A slow attack.** The file begins at zero and rises, because that is
 *    what the recording of a struck string does. There is nothing to skip;
 *    starting the buffer later would only cut the attack off, and the fix
 *    has to be on the source's side.
 *
 * They look identical in a waveform view and identical in a seam measurement.
 * They are told apart here by measuring both: how long the head is *exactly*
 * zero, and how long it then takes to reach a tenth, a half and nine tenths
 * of its peak.
 *
 * Pure, so the same function reads a decoded pack buffer in a browser and a
 * hand-built ramp in a unit test.
 */

/** Anything at or under this is silence, not a very quiet sound. */
export const ONSET_FLOOR = 1e-4;

export type OnsetProfile = {
  readonly sampleRate: number;
  readonly durationSeconds: number;
  /** How long the head is exactly zero. Encoder padding shows up here. */
  readonly digitalSilenceSeconds: number;
  /** First sample that is not exactly zero. */
  readonly firstNonZeroSeconds: number | null;
  /** First sample above the floor — where the recording becomes a sound. */
  readonly firstEnergySeconds: number | null;
  /** Peak magnitude anywhere in the note, and when it happens. */
  readonly peak: number;
  readonly peakSeconds: number;
  /** When the envelope first passes a tenth, a half and nine tenths of peak. */
  readonly reach10Seconds: number | null;
  readonly reach50Seconds: number | null;
  readonly reach90Seconds: number | null;
};

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Profile the head of one decoded recording.
 *
 * `windowSeconds` bounds how much of the note is read: the attack is what
 * matters and a whole sustaining guitar note is a megabyte of samples that
 * cannot change the answer. The peak is therefore the peak *of the attack*,
 * which is what a note's audible arrival is measured against.
 */
export function profileOnset(
  samples: Float32Array,
  sampleRate: number,
  windowSeconds = 0.25,
): OnsetProfile {
  const limit = Math.min(samples.length, Math.max(1, Math.round(windowSeconds * sampleRate)));

  let firstNonZero: number | null = null;
  let firstEnergy: number | null = null;
  let peak = 0;
  let peakAt = 0;

  for (let index = 0; index < limit; index += 1) {
    const size = Math.abs(samples[index] ?? 0);
    if (firstNonZero === null && size > 0) firstNonZero = index;
    if (firstEnergy === null && size > ONSET_FLOOR) firstEnergy = index;
    if (size > peak) {
      peak = size;
      peakAt = index;
    }
  }

  /*
   * The rise is read off a short-time envelope rather than off single
   * samples. A waveform crosses any level dozens of times per cycle on its
   * way up, so the first sample over half the peak says almost nothing about
   * when the note reached half its loudness.
   */
  const frame = Math.max(1, Math.round(0.001 * sampleRate));
  const reach = (fraction: number): number | null => {
    const wanted = peak * fraction;
    for (let start = 0; start + frame <= limit; start += frame) {
      let framePeak = 0;
      for (let index = start; index < start + frame; index += 1) {
        const size = Math.abs(samples[index] ?? 0);
        if (size > framePeak) framePeak = size;
      }
      if (framePeak >= wanted) return round(start / sampleRate);
    }
    return null;
  };

  return {
    sampleRate,
    durationSeconds: round(samples.length / sampleRate),
    digitalSilenceSeconds: round((firstNonZero ?? limit) / sampleRate),
    firstNonZeroSeconds: firstNonZero === null ? null : round(firstNonZero / sampleRate),
    firstEnergySeconds: firstEnergy === null ? null : round(firstEnergy / sampleRate),
    peak: round(peak),
    peakSeconds: round(peakAt / sampleRate),
    reach10Seconds: peak === 0 ? null : reach(0.1),
    reach50Seconds: peak === 0 ? null : reach(0.5),
    reach90Seconds: peak === 0 ? null : reach(0.9),
  };
}

/**
 * What the profile says the fix is.
 *
 * Deliberately a small vocabulary rather than a number, because the number
 * would invite a threshold and the two cases want different work:
 * `leading_silence` is skippable, `slow_attack` is not, `both` needs the
 * skip and still leaves a rise to cover.
 */
export type OnsetShape = "leading_silence" | "slow_attack" | "both" | "immediate";

export function onsetShape(
  profile: OnsetProfile,
  silenceSeconds = 0.002,
  riseSeconds = 0.005,
): OnsetShape {
  const silent = profile.digitalSilenceSeconds >= silenceSeconds;
  /* From where the sound starts to where it is half its peak — the part a
     later start could not skip without cutting the attack itself. */
  const from = profile.firstEnergySeconds ?? 0;
  const slow = (profile.reach50Seconds ?? 0) - from >= riseSeconds;
  if (silent && slow) return "both";
  if (silent) return "leading_silence";
  if (slow) return "slow_attack";
  return "immediate";
}

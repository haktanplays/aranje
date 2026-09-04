/**
 * The analyzer, attacked (2V-C.4 §4).
 *
 * A gap detector that never reports a gap is a green light wired to nothing,
 * and one tuned on a single fixture is a green light wired to that fixture.
 * So these are the controls: cases where it must find nothing, cases where it
 * must find exactly the thing that was put there, and the two ways a
 * threshold can lie — a hole hiding under a ratio, and a ratio hiding under a
 * silence floor.
 *
 * Synthetic buffers here on purpose. The point is to test the *instrument*
 * against signals whose answer is known by construction; the instrument is
 * then pointed at real rendered audio elsewhere.
 */
import { describe, expect, it } from "vitest";

import {
  expectsContinuity,
  measureSeam,
  seamVerdict,
  SEAM_CLASS_LIMITS,
  SILENCE_FLOOR,
  type SeamMeasurement,
} from "./seam-pcm";

const RATE = 44100;

/** A steady tone, so "continuous" has something to look like. */
function tone(seconds: number, amplitude = 0.3, hz = 220): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let index = 0; index < out.length; index += 1) {
    out[index] = amplitude * Math.sin((2 * Math.PI * hz * index) / RATE);
  }
  return out;
}

/** Two tones with `gapSeconds` of digital silence between them. */
function withGap(gapSeconds: number, amplitude = 0.3): Float32Array {
  const half = tone(0.25, amplitude);
  const hole = new Float32Array(Math.round(gapSeconds * RATE));
  const out = new Float32Array(half.length * 2 + hole.length);
  out.set(half, 0);
  out.set(hole, half.length);
  out.set(half, half.length + hole.length);
  return out;
}

const seamOf = (buffer: Float32Array, seconds: number): SeamMeasurement =>
  measureSeam([buffer], RATE, seconds);

describe("123. the analyzer finds nothing where there is nothing to find", () => {
  it("passes an unbroken sustain", () => {
    const seam = seamOf(tone(0.5), 0.25);
    expect(seam.silentSeconds).toBe(0);
    expect(seam.valleyRatio).toBeGreaterThan(0.8);
    expect(seamVerdict(seam).ok).toBe(true);
  });

  it("passes an ordinary re-struck note, which dips but does not hole", () => {
    /* An attack after a decay: real music, and not a gap. */
    const out = new Float32Array(Math.round(0.5 * RATE));
    for (let index = 0; index < out.length; index += 1) {
      const seconds = index / RATE;
      const since = seconds < 0.25 ? seconds : seconds - 0.25;
      const envelope = 0.4 * Math.exp(-since * 4);
      out[index] = envelope * Math.sin((2 * Math.PI * 220 * index) / RATE);
    }
    const seam = seamOf(out, 0.25);
    expect(seam.silentSeconds).toBe(0);
    expect(seamVerdict(seam).ok).toBe(true);
  });
});

describe("124. the analyzer finds what was deliberately put there", () => {
  it.each([0.01, 0.02, 0.03])("measures an inserted %ss silence", (gap) => {
    const seam = seamOf(withGap(gap), 0.25 + gap / 2);
    /* Frame-quantised, so the measured length is within one frame. */
    expect(seam.silentSeconds).toBeGreaterThan(gap - seam.frameSeconds * 2);
    expect(seam.silentSeconds).toBeLessThan(gap + seam.frameSeconds * 2);
    const verdict = seamVerdict(seam);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("silence");
  });

  it("fails a real written rest, because a rest is a hole", () => {
    const seam = seamOf(withGap(0.1), 0.3);
    expect(seamVerdict(seam).ok).toBe(false);
  });

  it("catches a sample-to-sample discontinuity as a click", () => {
    /*
     * Two tones spliced at a *peak*: no silence at all, and a hard step.
     * Splicing at a zero crossing would produce no discontinuity at all,
     * which is exactly why guitarists and codecs both aim for one — so the
     * cut is placed deliberately where it does damage.
     */
    const out = tone(0.5);
    let at = Math.round(0.25 * RATE);
    for (let index = at; index < at + Math.round(RATE / 220); index += 1) {
      if (Math.abs(out[index] ?? 0) > Math.abs(out[at] ?? 0)) at = index;
    }
    for (let index = at; index < out.length; index += 1) out[index] = -(out[index] ?? 0);
    const seam = seamOf(out, at / RATE);
    expect(seam.silentSeconds).toBe(0);
    expect(seam.maxStep).toBeGreaterThan(0.3);
    const verdict = seamVerdict(seam, { maxStep: 0.2 });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("jump");
  });
});

describe("125. the two thresholds each catch what the other misses", () => {
  it("calls a deep dip a hole even when it never reaches silence", () => {
    /* Never silent — a twentieth of the surrounding level — and a gap. */
    const out = tone(0.5, 0.4);
    const from = Math.round(0.245 * RATE);
    const to = Math.round(0.265 * RATE);
    for (let index = from; index < to; index += 1) out[index] = (out[index] ?? 0) * 0.02;
    const seam = seamOf(out, 0.25);
    expect(seam.minRms).toBeGreaterThan(SILENCE_FLOOR);
    expect(seam.silentSeconds).toBe(0);
    expect(seam.valleyRatio).toBeLessThan(0.25);
    expect(seamVerdict(seam).ok).toBe(false);
  });

  it("calls a hole a hole even in music too quiet for a ratio to notice", () => {
    /* Both sides very quiet, so the ratio across the seam stays healthy —
       but there is real silence in the middle and that is still a gap. */
    const seam = seamOf(withGap(0.02, 0.004), 0.26);
    expect(seam.silentSeconds).toBeGreaterThan(0.01);
    expect(seamVerdict(seam).ok).toBe(false);
  });

  it("refuses to call an all-silent window continuous", () => {
    /* Two zeroes divide to a perfect ratio. That must not read as a pass. */
    const seam = seamOf(new Float32Array(RATE), 0.5);
    const verdict = seamVerdict(seam);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("no sound");
  });

  it("does not hide a very quiet passage under the floor", () => {
    const seam = seamOf(tone(0.5, 5e-4), 0.25);
    /* Quiet, but present: it must be measured rather than rounded away. */
    expect(seam.beforeMedianRms).toBeGreaterThan(SILENCE_FLOOR);
    expect(seamVerdict(seam).ok).toBe(true);
  });
});

describe("126. the analyzer answers rather than throwing", () => {
  it("survives an empty buffer", () => {
    const seam = measureSeam([], RATE, 0.1);
    expect(seam.rms).toHaveLength(0);
    expect(seamVerdict(seam).ok).toBe(false);
  });

  it("survives a seam outside the audio", () => {
    const seam = seamOf(tone(0.2), 5);
    expect(Number.isFinite(seam.valleyRatio)).toBe(true);
  });

  it("reports non-finite samples rather than propagating them", () => {
    const out = tone(0.3);
    out[Math.round(0.15 * RATE)] = Number.NaN;
    const seam = seamOf(out, 0.15);
    expect(seam.invalid).toBeGreaterThan(0);
    expect(seamVerdict(seam).ok).toBe(false);
  });

  it("reports clipping rather than averaging it away", () => {
    const out = tone(0.3, 1.5);
    const seam = seamOf(out, 0.15);
    expect(seam.clipped).toBeGreaterThan(0);
    expect(seamVerdict(seam).ok).toBe(false);
  });

  it("averages channels rather than reading only the first", () => {
    const left = tone(0.3, 0.4);
    const right = tone(0.3, 0.0);
    const both = measureSeam([left, right], RATE, 0.15);
    const onlyLeft = measureSeam([left], RATE, 0.15);
    expect(both.beforeMedianRms).toBeLessThan(onlyLeft.beforeMedianRms);
    expect(both.beforeMedianRms).toBeGreaterThan(0);
  });
});

describe("126b. the class limits stay honest", () => {
  it("never puts a valley floor on the re-strike reference", () => {
    /*
     * The reference is what the connected classes are measured against. A
     * floor on it could be raised until the reference itself moved, and then
     * "better than an unconnected re-strike" would mean whatever was
     * convenient.
     */
    expect(SEAM_CLASS_LIMITS.restrike.minValleyRatio).toBe(0);
  });

  it("asks less of a struck connection than of a held one, and more than nothing", () => {
    const joined = SEAM_CLASS_LIMITS.joined.minValleyRatio ?? 0;
    const connected = SEAM_CLASS_LIMITS.connected.minValleyRatio ?? 0;
    expect(connected).toBeLessThan(joined);
    /* 0.086 is what two ordinary picked notes measured with nothing written
       between them. A connection has to be better than that or it is not one. */
    expect(connected).toBeGreaterThan(0.086);
  });

  it("expects a hole only where one is written", () => {
    expect(expectsContinuity("broken")).toBe(false);
    for (const kind of ["joined", "connected", "restrike"] as const) {
      expect(expectsContinuity(kind)).toBe(true);
    }
  });

  it("lets a class relax the valley without relaxing silence or clicks", () => {
    /* The absolute tests are not per class on purpose: a hole and a click are
       wrong in every kind of seam, and only the valley is a matter of what is
       being played. */
    for (const limits of Object.values(SEAM_CLASS_LIMITS)) {
      expect(limits.maxSilentSeconds).toBeUndefined();
      expect(limits.maxStep).toBeUndefined();
    }
  });
});

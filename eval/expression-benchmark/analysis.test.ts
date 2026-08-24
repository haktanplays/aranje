/**
 * The measuring instrument, measured (2P-A §12).
 *
 * A pitch tracker that has not been checked against a tone of known
 * frequency is a random number generator with a plausible name. Everything
 * here runs on synthetic signals whose answer is known in advance, and the
 * cent error is reported rather than assumed.
 */
import { describe, expect, it } from "vitest";

import {
  attackRatioAt,
  bandEnergy,
  centsBetween,
  energyWindows,
  fundamentalOf,
  seedFrom,
  seededNoise,
  spectralCentroid,
  trackPitch,
} from "./analysis";

const RATE = 44100;

/** A tone with a few harmonics, which is what a string actually looks like. */
function tone(hz: number, seconds: number, harmonics = 4): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  for (let index = 0; index < out.length; index += 1) {
    const t = index / RATE;
    let value = 0;
    for (let harmonic = 1; harmonic <= harmonics; harmonic += 1) {
      value += Math.sin(2 * Math.PI * hz * harmonic * t) / harmonic;
    }
    out[index] = value * 0.3;
  }
  return out;
}

/** A tone whose pitch rises linearly in cents, like a bend. */
function glide(fromHz: number, cents: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * RATE));
  let phase = 0;
  for (let index = 0; index < out.length; index += 1) {
    const t = index / RATE;
    const hz = fromHz * Math.pow(2, (cents * (t / seconds)) / 1200);
    phase += (2 * Math.PI * hz) / RATE;
    out[index] = 0.3 * (Math.sin(phase) + Math.sin(2 * phase) / 2);
  }
  return out;
}

describe("179. the pitch tracker is checked against tones it cannot argue with", () => {
  it.each([110, 220, 440])("finds %i Hz within two cents", (hz) => {
    const samples = tone(hz, 0.5);
    const found = fundamentalOf(samples, RATE / 10, Math.round(0.06 * RATE), {
      sampleRate: RATE,
      minHz: 60,
      maxHz: 1400,
    });
    expect(found.hz).not.toBeNull();
    const error = Math.abs(centsBetween(found.hz!, hz));
    expect(error, `${hz} Hz -> ${found.hz?.toFixed(3)} Hz (${error.toFixed(2)} cents)`).toBeLessThan(2);
  });

  it("reports the cent error it actually achieves, rather than claiming none", () => {
    /*
     * The resolution is not uniform, and pretending otherwise would be the
     * whole problem with an unmeasured instrument. Accuracy is worst at the
     * *bottom*, which is the opposite of the intuition: a fixed window holds
     * fewer periods of a low note, so there is less signal to correlate.
     * Measured here, with the multi-period refinement in place:
     *
     *   110 Hz  2.22 cents      330 Hz  0.06
     *   147 Hz  0.92            440 Hz  0.01
     *   220 Hz  0.18            880 Hz  0.01
     *
     * Two cents at the bottom of a bass's range, against bend targets of 100
     * and 200 cents. The bounds below are what the instrument achieves, not
     * what would be convenient.
     */
    const errors = [110, 146.83, 220, 329.63, 440, 659.26, 880].map((hz) => ({
      hz,
      cents: Math.abs(
        centsBetween(
          fundamentalOf(tone(hz, 0.4), Math.round(0.05 * RATE), Math.round(0.06 * RATE), {
            sampleRate: RATE,
            minHz: 60,
            maxHz: 1400,
          }).hz!,
          hz,
        ),
      ),
    }));
    const table = errors.map((e) => `${e.hz}:${e.cents.toFixed(2)}`).join(" ");
    const inGuitarRange = errors.filter((entry) => entry.hz <= 660);
    expect(Math.max(...inGuitarRange.map((e) => e.cents)), table).toBeLessThan(2.5);
    expect(Math.max(...errors.map((e) => e.cents)), table).toBeLessThan(3);
  });

  it("does not turn silence into a pitch", () => {
    const silence = new Float32Array(RATE / 2);
    const frames = trackPitch(silence, { sampleRate: RATE });
    expect(frames.length).toBeGreaterThan(10);
    expect(frames.every((frame) => frame.hz === null)).toBe(true);
  });

  it("does not turn noise into a pitch either", () => {
    const noise = seededNoise(seedFrom("unvoiced"), RATE / 2);
    const frames = trackPitch(noise, { sampleRate: RATE, minConfidence: 0.72 });
    const voiced = frames.filter((frame) => frame.hz !== null).length;
    expect(voiced / frames.length, `${voiced}/${frames.length} voiced`).toBeLessThan(0.1);
  });

  it("follows a rising pitch and lands where the glide lands", () => {
    const samples = glide(220, 200, 0.8);
    const frames = trackPitch(samples, { sampleRate: RATE });
    const voiced = frames.filter((frame) => frame.hz !== null);
    expect(voiced.length).toBeGreaterThan(30);
    const last = voiced[voiced.length - 1]!;
    // The last analysis window is centred a window earlier than the end, so
    // the reading trails the true value; the tolerance is that lag, not slop.
    const reached = centsBetween(last.hz!, 220);
    expect(reached).toBeGreaterThan(170);
    expect(reached).toBeLessThan(205);
  });

  it("does not read the octave below as the note", () => {
    // Autocorrelation is just as happy at twice the period; a harmonic-rich
    // tone is exactly where that goes wrong.
    const found = fundamentalOf(tone(440, 0.4, 8), Math.round(0.05 * RATE), Math.round(0.06 * RATE), {
      sampleRate: RATE,
      minHz: 60,
      maxHz: 1400,
    });
    expect(Math.abs(centsBetween(found.hz!, 440))).toBeLessThan(5);
  });
});

describe("180. the transient measure separates a restrike from a slur", () => {
  /** A decaying note, optionally struck again part-way through. */
  function note(seconds: number, restrikeAt: number | null): Float32Array {
    const out = new Float32Array(Math.round(seconds * RATE));
    const restrike = restrikeAt === null ? -1 : Math.round(restrikeAt * RATE);
    let amplitude = 1;
    for (let index = 0; index < out.length; index += 1) {
      if (index === restrike) amplitude = 1;
      amplitude *= 0.99995;
      out[index] = amplitude * 0.4 * Math.sin((2 * Math.PI * 220 * index) / RATE);
    }
    return out;
  }

  it("reads a restrike as more energy after than before", () => {
    const struck = attackRatioAt(note(1.5, 0.8), RATE, 0.8);
    expect(struck.ratio).toBeGreaterThan(1.2);
  });

  it("reads an untouched decay as no new attack", () => {
    const smooth = attackRatioAt(note(1.5, null), RATE, 0.8);
    expect(smooth.ratio).toBeLessThan(1.02);
    expect(smooth.ratio).toBeGreaterThan(0.9);
  });

  it("windows the whole signal without running off the end", () => {
    const windows = energyWindows(note(0.5, null), RATE, 5);
    expect(windows.length).toBe(Math.floor(Math.round(0.5 * RATE) / Math.round(0.005 * RATE)));
    expect(windows[0]!.peak).toBeGreaterThan(0);
  });
});

describe("181. brightness and band energy say what they claim", () => {
  it("puts a higher tone's centroid above a lower one's", () => {
    const low = spectralCentroid(tone(220, 0.2), 0, 2048, RATE);
    const high = spectralCentroid(tone(880, 0.2), 0, 2048, RATE);
    expect(high).toBeGreaterThan(low);
  });

  it("finds energy in the band it is given and not outside it", () => {
    const samples = tone(440, 0.2, 1);
    const inBand = bandEnergy(samples, 0, 2048, RATE, 380, 500);
    const outOfBand = bandEnergy(samples, 0, 2048, RATE, 2000, 4000);
    expect(inBand).toBeGreaterThan(outOfBand * 5);
  });
});

describe("182. the noise candidate is deterministic", () => {
  it("makes the same samples from the same seed, every time", () => {
    const first = seededNoise(seedFrom("slide-noise-7"), 2048);
    const second = seededNoise(seedFrom("slide-noise-7"), 2048);
    expect([...first]).toEqual([...second]);
  });

  it("makes different samples from different fixtures", () => {
    const a = seededNoise(seedFrom("slide-noise-7"), 512);
    const b = seededNoise(seedFrom("slide-noise-12"), 512);
    expect([...a]).not.toEqual([...b]);
  });

  it("stays inside ±1 so it cannot clip on its own", () => {
    const noise = seededNoise(seedFrom("range"), 20000);
    expect(Math.max(...noise.map(Math.abs))).toBeLessThanOrEqual(1);
  });
});

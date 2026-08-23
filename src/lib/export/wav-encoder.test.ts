/**
 * The WAV byte layout, asserted as bytes (spec 13.19, 2M-A §5, §16).
 *
 * Everything here reads the actual header fields at their actual offsets. A
 * test that only checked "the encoder returned something" would pass for a
 * file no player could open, which is the one failure mode that matters for a
 * format whose entire job is being read by software nobody wrote.
 */
import { describe, expect, it } from "vitest";

import { audioExportLimits } from "@/lib/limits";
import {
  encodeWav,
  wavByteLength,
  wavDurationSeconds,
} from "@/lib/export/wav-encoder";

const RATE = audioExportLimits.sampleRate;

const view = (bytes: Uint8Array) =>
  new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));

const ok = (result: ReturnType<typeof encodeWav>) => {
  if (!result.ok) throw new Error(`encode refused: ${result.code}`);
  return result.bytes;
};

/** Interleaved 16-bit samples, read back as the numbers they encode. */
const samples = (bytes: Uint8Array): number[] => {
  const data = view(bytes);
  const out: number[] = [];
  for (let offset = 44; offset < bytes.length; offset += 2) {
    out.push(data.getInt16(offset, true));
  }
  return out;
};

const stereo = (left: number[], right: number[]) =>
  encodeWav({
    channels: [Float32Array.from(left), Float32Array.from(right)],
    sampleRate: RATE,
  });

describe("64. the WAV header says what the file is", () => {
  it("writes a canonical RIFF/WAVE PCM header", () => {
    const bytes = ok(stereo([0, 0.5], [0, -0.5]));
    const data = view(bytes);

    expect(ascii(bytes, 0, 4)).toBe("RIFF");
    expect(ascii(bytes, 8, 4)).toBe("WAVE");
    expect(ascii(bytes, 12, 4)).toBe("fmt ");
    expect(ascii(bytes, 36, 4)).toBe("data");

    expect(data.getUint32(16, true)).toBe(16); // PCM fmt chunk size
    expect(data.getUint16(20, true)).toBe(1); // PCM
    expect(data.getUint16(22, true)).toBe(2); // stereo
    expect(data.getUint32(24, true)).toBe(RATE);
    expect(data.getUint16(34, true)).toBe(16); // bit depth
  });

  it("states byte rate and block align consistently with the rest", () => {
    const bytes = ok(stereo([0, 0, 0], [0, 0, 0]));
    const data = view(bytes);
    const channels = data.getUint16(22, true);
    const bits = data.getUint16(34, true);

    expect(data.getUint16(32, true)).toBe(channels * (bits / 8));
    expect(data.getUint32(28, true)).toBe(RATE * channels * (bits / 8));
  });

  it("gives chunk sizes that agree with the file's real length", () => {
    // The single most common way a WAV breaks: a header that promises more
    // or less audio than the file carries.
    for (const frames of [1, 2, 1000]) {
      const silence = new Array<number>(frames).fill(0);
      const bytes = ok(stereo(silence, silence));
      const data = view(bytes);

      expect(data.getUint32(40, true)).toBe(frames * 2 * 2);
      expect(data.getUint32(4, true)).toBe(bytes.length - 8);
      expect(bytes.length).toBe(44 + frames * 2 * 2);
      expect(bytes.length).toBe(wavByteLength(frames, 2));
    }
  });

  it("agrees with the estimate the user was shown", () => {
    const frames = 4096;
    const silence = new Array<number>(frames).fill(0);
    expect(ok(stereo(silence, silence)).length).toBe(wavByteLength(frames, 2));
    expect(wavDurationSeconds(frames, RATE)).toBeCloseTo(frames / RATE, 10);
  });
});

describe("65. the WAV data is the audio it was given", () => {
  it("interleaves left and right in that order", () => {
    // Distinct values per channel: a swap would be invisible with equal ones.
    const bytes = ok(stereo([1, 0], [0, -1]));
    expect(samples(bytes)).toEqual([32767, 0, 0, -32768]);
  });

  it("carries silence as a valid file rather than an empty one", () => {
    const bytes = ok(stereo([0, 0, 0, 0], [0, 0, 0, 0]));
    expect(ascii(bytes, 0, 4)).toBe("RIFF");
    expect(samples(bytes)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("clamps both ends instead of wrapping", () => {
    /*
     * A renderer can hand back a sample slightly outside ±1. Wrapping would
     * turn a loud peak into a click in the *opposite* direction — the classic
     * way a mix that sounded fine acquires a crack on export.
     */
    const bytes = ok(stereo([2, -2, 1.0001], [-9, 9, -1.0001]));
    expect(samples(bytes)).toEqual([
      32767, -32768, -32768, 32767, 32767, -32768,
    ]);
  });

  it("maps the ends of the range to the ends of the type", () => {
    expect(samples(ok(stereo([1], [-1])))).toEqual([32767, -32768]);
    expect(samples(ok(stereo([0], [0])))).toEqual([0, 0]);
  });

  it("refuses a non-finite sample rather than silencing it", () => {
    // NaN means the render went wrong upstream. Writing a zero would hand
    // someone a file with a hole in it and no way to find out.
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      const result = stereo([0, bad], [0, 0]);
      expect(result.ok, String(bad)).toBe(false);
      if (!result.ok) expect(result.code).toBe("wav_non_finite_sample");
    }
  });
});

describe("66. the encoder is pure", () => {
  it("gives the same bytes five runs in a row", () => {
    const left = Array.from({ length: 512 }, (_, i) => Math.sin(i / 8));
    const right = Array.from({ length: 512 }, (_, i) => Math.cos(i / 8));
    const runs = Array.from({ length: 5 }, () =>
      [...ok(stereo(left, right))].join(","),
    );
    expect(new Set(runs).size).toBe(1);
  });

  it("does not touch the buffers it was handed", () => {
    const left = Float32Array.from([0.25, -0.25]);
    const right = Float32Array.from([1, -1]);
    const before = [[...left], [...right]];

    ok(encodeWav({ channels: [left, right], sampleRate: RATE }));

    expect([[...left], [...right]]).toEqual(before);
  });

  it("refuses the shapes it cannot honestly encode", () => {
    expect(encodeWav({ channels: [], sampleRate: RATE })).toEqual({
      ok: false,
      code: "wav_no_channels",
    });

    const mismatched = encodeWav({
      channels: [Float32Array.from([0, 0]), Float32Array.from([0])],
      sampleRate: RATE,
    });
    expect(!mismatched.ok && mismatched.code).toBe("wav_channel_length_mismatch");

    const tooMany = encodeWav({
      channels: [new Float32Array(1), new Float32Array(1), new Float32Array(1)],
      sampleRate: RATE,
    });
    expect(!tooMany.ok && tooMany.code).toBe("wav_unsupported_channel_count");

    for (const rate of [0, -1, Number.NaN]) {
      const bad = encodeWav({ channels: [new Float32Array(1)], sampleRate: rate });
      expect(!bad.ok && bad.code, String(rate)).toBe("wav_invalid_sample_rate");
    }
  });

  it("leaves no trailing byte and no partial frame", () => {
    for (const frames of [1, 7, 4097]) {
      const silence = new Array<number>(frames).fill(0);
      const bytes = ok(stereo(silence, silence));
      expect((bytes.length - 44) % 4).toBe(0);
      expect(bytes.length - 44).toBe(view(bytes).getUint32(40, true));
    }
  });
});

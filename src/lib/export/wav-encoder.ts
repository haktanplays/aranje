/**
 * A rendered buffer as a `.wav` file, and nothing else (spec 13.19, 2M-A §5).
 *
 * Pure by construction: bytes in, bytes out, no Web Audio, no Blob, no DOM.
 * That is what lets the format be tested for what it is — a byte layout —
 * rather than for whether a browser happened to accept it.
 *
 * The format is the narrow one every player on earth reads: RIFF/WAVE, PCM,
 * 16-bit signed little-endian, interleaved. No extensible header, no LIST
 * chunk, no metadata. An export that plays everywhere is worth more than one
 * that carries a title.
 */
import { audioExportLimits } from "@/lib/limits";

export type WavEncodeErrorCode =
  | "wav_no_channels"
  | "wav_channel_length_mismatch"
  | "wav_unsupported_channel_count"
  | "wav_non_finite_sample"
  | "wav_invalid_sample_rate";

export type WavEncodeResult =
  | { readonly ok: true; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly ok: false; readonly code: WavEncodeErrorCode };

const RIFF_HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;
const INT16_MAX = 32767;
const INT16_MIN = -32768;

/**
 * The size a PCM file of this shape will be, before encoding it.
 *
 * Derived from the four things that decide it — frames, channels, bit depth
 * and the fixed header — so the estimate the user is shown and the file they
 * receive cannot disagree. Tested against the real encoder for exactly that
 * reason.
 */
export function wavByteLength(frames: number, channels: number): number {
  return RIFF_HEADER_BYTES + frames * channels * BYTES_PER_SAMPLE;
}

/** How long a file of this many frames lasts, in seconds. */
export function wavDurationSeconds(frames: number, sampleRate: number): number {
  return sampleRate > 0 ? frames / sampleRate : 0;
}

/**
 * Float sample → 16-bit integer.
 *
 * Clamped at ±1 before scaling, because a renderer may hand back a sample
 * slightly outside the nominal range and letting it wrap would turn a loud
 * peak into a click in the opposite direction. Asymmetric scaling is
 * deliberate: −1 maps to −32768 and +1 to +32767, the actual ends of the
 * type, so full-scale audio survives the trip in both directions.
 */
function toInt16(sample: number): number {
  if (sample >= 1) return INT16_MAX;
  if (sample <= -1) return INT16_MIN;
  return Math.round(sample * (sample < 0 ? -INT16_MIN : INT16_MAX));
}

const writeAscii = (view: DataView, offset: number, text: string): void => {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
};

/**
 * Encode planar float channels as one interleaved PCM WAV.
 *
 * The input arrays are read and never written: a caller may hand over the
 * very buffers a renderer returned and keep using them afterwards.
 *
 * A non-finite sample is refused rather than silenced. `NaN` in a buffer
 * means the render went wrong somewhere upstream, and turning it into a zero
 * would hand the user a file with a hole in it and no way to know.
 */
export function encodeWav(input: {
  readonly channels: readonly ArrayLike<number>[];
  readonly sampleRate: number;
}): WavEncodeResult {
  const { channels, sampleRate } = input;

  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    return { ok: false, code: "wav_invalid_sample_rate" };
  }
  if (channels.length === 0) return { ok: false, code: "wav_no_channels" };
  if (channels.length > audioExportLimits.maxChannels) {
    return { ok: false, code: "wav_unsupported_channel_count" };
  }

  const frames = channels[0]!.length;
  for (const channel of channels) {
    if (channel.length !== frames) {
      return { ok: false, code: "wav_channel_length_mismatch" };
    }
  }

  const channelCount = channels.length;
  const dataBytes = frames * channelCount * BYTES_PER_SAMPLE;
  const bytes = new Uint8Array(RIFF_HEADER_BYTES + dataBytes);
  const view = new DataView(bytes.buffer);

  const byteRate = sampleRate * channelCount * BYTES_PER_SAMPLE;
  const blockAlign = channelCount * BYTES_PER_SAMPLE;

  /* RIFF chunk descriptor. */
  writeAscii(view, 0, "RIFF");
  // Everything after this field: the file minus "RIFF" and minus this size.
  view.setUint32(4, RIFF_HEADER_BYTES - 8 + dataBytes, true);
  writeAscii(view, 8, "WAVE");

  /* fmt subchunk: 16 bytes, PCM, no extension. */
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // 1 = PCM
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // bits per sample

  /* data subchunk. */
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = RIFF_HEADER_BYTES;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = channels[channel]![frame]!;
      if (!Number.isFinite(sample)) {
        return { ok: false, code: "wav_non_finite_sample" };
      }
      view.setInt16(offset, toInt16(sample), true);
      offset += BYTES_PER_SAMPLE;
    }
  }

  return { ok: true, bytes };
}

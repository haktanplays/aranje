/**
 * What an export will be, before it is one (spec 13.19, 2M-A §5, §7, §11).
 *
 * Pure: given a Song it says how long the audio will run, how big the file
 * will be, what it will be called and how many MIDI events it will carry.
 * The sheet shows these numbers before the work starts, and the work has to
 * produce exactly them — which is only true because both sides derive from
 * this one module rather than estimating separately.
 */
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { buildTempoMap } from "@/lib/audio/tempo";
import { audioExportLimits } from "@/lib/limits";
import { safeFileStem } from "@/lib/project/project-file-name";
import { wavByteLength } from "@/lib/export/wav-encoder";
import type { Song } from "@/lib/song/schema";

export const WAV_EXTENSION = ".wav";
export const WAV_MIME = "audio/wav";
export const MIDI_EXTENSION = ".mid";
export const MIDI_MIME = "audio/midi";

/** `<safe-title>.wav`, cleaned exactly the way a project file is. */
export function wavFileName(title: string): string {
  return `${safeFileStem(title)}${WAV_EXTENSION}`;
}

/** `<safe-title>.mid`. */
export function midiFileName(title: string): string {
  return `${safeFileStem(title)}${MIDI_EXTENSION}`;
}

export type RenderDuration = {
  /** Where the last bar ends: the song as written. */
  readonly notatedSeconds: number;
  /**
   * How far past that the last expressive gesture still runs.
   *
   * A bend or a legato chain planned across the final note can finish after
   * the bar line; the plan knows when, so the render does not have to guess.
   */
  readonly expressionSeconds: number;
  /** The engine's decay allowance, from the one central constant. */
  readonly tailSeconds: number;
  /** What the render is actually asked for. */
  readonly totalSeconds: number;
};

/**
 * How long to render.
 *
 * Derived, never guessed: notated end, plus however far the expression plan
 * still runs past it, plus the central tail that lets a sample decay instead
 * of being chopped. A fixed number in a component is exactly how the last
 * chord of somebody's song goes missing, so there isn't one.
 *
 * Always at the song's own tempo. Practice rate is a rehearsal aid and has no
 * business deciding how long an exported file is — or how fast it sounds.
 */
export function renderDuration(song: Song): RenderDuration {
  const notatedSeconds = buildTempoMap(song).totalSeconds;

  const expression = buildExpressionPlan(song);
  let expressionEnd = notatedSeconds;
  for (const note of expression.notes) {
    expressionEnd = Math.max(note.startSeconds + note.durationSeconds, expressionEnd);
  }

  const expressionSeconds = Math.max(0, expressionEnd - notatedSeconds);
  const tailSeconds = audioExportLimits.tailSeconds;
  return {
    notatedSeconds,
    expressionSeconds,
    tailSeconds,
    totalSeconds: notatedSeconds + expressionSeconds + tailSeconds,
  };
}

export type WavEstimate = {
  readonly seconds: number;
  readonly frames: number;
  readonly bytes: number;
  readonly sampleRate: number;
  readonly channels: number;
};

/**
 * How big the WAV will be.
 *
 * Frames from seconds and sample rate, bytes from frames, channels and bit
 * depth — the four things that actually decide it. The encoder's own
 * `wavByteLength` does the arithmetic, so the estimate and the file cannot
 * disagree about the header.
 */
export function estimateWav(song: Song): WavEstimate {
  const { totalSeconds } = renderDuration(song);
  const sampleRate = audioExportLimits.sampleRate;
  const channels = audioExportLimits.channels;
  const frames = Math.ceil(totalSeconds * sampleRate);
  return {
    seconds: totalSeconds,
    frames,
    bytes: wavByteLength(frames, channels),
    sampleRate,
    channels,
  };
}

/** A byte count in the units a person reads. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(0)} KB`;
  return `${(kib / 1024).toFixed(1)} MB`;
}

/** `3:07`, the way a player shows a length. */
export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

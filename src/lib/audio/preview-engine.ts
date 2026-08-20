/**
 * The candidate's own playback, and its lifetime.
 *
 * The phase 1B engine is reused as it is — there is no second scheduler here,
 * and none should ever be written. What this adds is the one rule a preview
 * brings with it: **two songs may not play at once.** A candidate and the song
 * it is a candidate for are different music, and hearing both would tell the
 * listener nothing about either.
 *
 * So starting a preview stops the song's own playback first, disposes any
 * preview that was already running, and only then builds a new engine. Every
 * way out — stopping, closing, rejecting, applying, leaving the screen —
 * arrives at `stop()`, which disposes.
 *
 * The engine is injected so this can be tested without an audio context. The
 * real caller passes the real controller.
 */
import type { Song } from "@/lib/song/schema";

export type PreviewPlayback = {
  seekToBar(barKey: string): void;
  play(): Promise<void>;
  dispose(): void;
  /** The candidate is practised at the same speed as the song (spec 13.8). */
  setPracticePercent(percent: number): void;
};

export type PreviewEngineFactory = (song: Song) => PreviewPlayback;

export class PreviewEngine {
  private current: PreviewPlayback | null = null;

  constructor(private readonly factory: PreviewEngineFactory) {}

  get active(): boolean {
    return this.current !== null;
  }

  /**
   * Play the candidate from the start of the section that changed.
   *
   * `stopHost` is passed in at the call rather than held, so the ordering
   * stays here — host first, then any earlier preview, then the new one — and
   * the caller does not have to remember it.
   */
  start(
    candidate: Song,
    sectionId: string,
    stopHost: () => void,
    practicePercent?: number,
  ): void {
    stopHost();
    this.stop();

    const playback = this.factory(candidate);
    if (practicePercent !== undefined) playback.setPracticePercent(practicePercent);
    this.current = playback;
    playback.seekToBar(`${sectionId}:0`);
    void playback.play();
  }

  /**
   * Follow a speed change while the candidate is playing.
   *
   * The same setting drives both engines, through the same helper, so the
   * candidate and the song are never heard at two different tempos.
   */
  setPracticePercent(percent: number): void {
    this.current?.setPracticePercent(percent);
  }

  /** Dispose the preview engine. Safe to call when there is none. */
  stop(): void {
    const playback = this.current;
    this.current = null;
    playback?.dispose();
  }
}

"use client";

/**
 * Playback lifecycle and state machine.
 *
 * The engine is built once, on the first play, and reused. Play and pause move
 * the transport; they never rebuild the graph or reschedule events. The engine
 * is disposed when the song changes or the screen goes away.
 *
 * Nothing here drives a clock of its own. The transport is the only timeline:
 * the interface reads its tick position on an animation frame, and a tempo
 * change moves the sound, the playhead, the active bar and the loop boundaries
 * together because all of them are expressed in ticks.
 */
import {
  SampleLoadError,
  createLiveEngine,
  scheduleSong,
  type Engine,
} from "@/lib/audio/engine";
import {
  barStartTicks,
  positionAtTicks,
  sectionLoopBounds,
  type PlayPosition,
} from "@/lib/audio/position";
import { NOWHERE } from "@/lib/audio/position";
import { buildSongPlan, type SongPlan } from "@/lib/audio/schedule";
import { bpmRange } from "@/lib/limits";
import type { Song } from "@/lib/song/schema";

export type PlaybackStatus =
  | "idle"
  | "loading"
  | "ready"
  | "playing"
  | "paused"
  | "ended"
  | "error";

export type LoadProgress = { buffers: number; totalBuffers: number };

export type PlaybackState = {
  status: PlaybackStatus;
  bpm: number;
  loopSectionId: string | null;
  metronome: boolean;
  progress: LoadProgress | null;
  error: string | null;
};

export class PlaybackController {
  private engine: Engine | null = null;
  private listeners = new Set<() => void>();
  private disposed = false;
  private state: PlaybackState;
  private readonly plan: SongPlan;

  constructor(private readonly song: Song) {
    this.plan = buildSongPlan(song);
    this.state = {
      status: "idle",
      bpm: song.bpm,
      loopSectionId: null,
      metronome: false,
      progress: null,
      error: null,
    };
  }

  getPlan(): SongPlan {
    return this.plan;
  }

  getState(): PlaybackState {
    return this.state;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<PlaybackState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /** Raw transport clock, for the debug surface. */
  getTransportTicks(): number {
    return this.engine?.context.transport.ticks ?? 0;
  }

  getTransportSeconds(): number {
    return this.engine?.context.transport.seconds ?? 0;
  }

  getLoopBounds(): { on: boolean; startTicks: number; endTicks: number } | null {
    const sectionId = this.state.loopSectionId;
    if (!sectionId) return null;
    const bounds = sectionLoopBounds(this.plan, sectionId);
    if (!bounds) return null;
    return { on: true, ...bounds };
  }

  /** Current transport position, read straight from the audio clock. */
  getPosition(): PlayPosition {
    const transport = this.engine?.context.transport;
    if (!transport) return NOWHERE;
    return positionAtTicks(this.plan, transport.ticks);
  }

  private async ensureEngine(): Promise<Engine> {
    if (this.engine) return this.engine;

    this.set({ status: "loading", error: null, progress: null });

    // Tone.start() runs inside the click that called play(), which is what the
    // browser requires to open an audio context.
    const engine = await createLiveEngine(this.song, {
      onProgress: (buffers, totalBuffers) =>
        this.set({ progress: { buffers, totalBuffers } }),
    });

    if (this.disposed) {
      engine.dispose();
      throw new Error("disposed");
    }

    scheduleSong(engine, this.state.bpm, {
      metronomeEnabled: () => this.state.metronome,
      onEnded: () => this.handleEnded(),
    });

    this.engine = engine;
    this.applyLoop();
    return engine;
  }

  private handleEnded() {
    const transport = this.engine?.context.transport;
    if (!transport) return;
    transport.pause();
    transport.ticks = this.plan.totalTicks;
    this.set({ status: "ended" });
  }

  async play(): Promise<void> {
    if (this.state.status === "loading") return;

    try {
      const engine = await this.ensureEngine();
      const transport = engine.context.transport;

      // Playing again after the end starts from the top.
      if (this.state.status === "ended") transport.ticks = 0;

      transport.start();
      this.set({ status: "playing", error: null });
    } catch (error) {
      this.fail(error);
    }
  }

  pause(): void {
    const transport = this.engine?.context.transport;
    if (!transport) return;
    // pause() keeps the tick position, unlike stop().
    transport.pause();
    if (this.state.status === "playing") this.set({ status: "paused" });
  }

  toggle(): void {
    if (this.state.status === "playing") this.pause();
    else void this.play();
  }

  /** Back to the top, for both the transport and the playhead. */
  rewind(): void {
    const transport = this.engine?.context.transport;
    if (transport) {
      transport.ticks = this.state.loopSectionId
        ? (sectionLoopBounds(this.plan, this.state.loopSectionId)?.startTicks ??
          0)
        : 0;
    }
    if (this.state.status === "ended") this.set({ status: "paused" });
  }

  seekToBar(barKey: string): void {
    const start = barStartTicks(this.plan, barKey);
    if (start === null) return;
    const transport = this.engine?.context.transport;
    if (transport) transport.ticks = start;
    if (this.state.status === "ended") this.set({ status: "paused" });
  }

  setLoopSection(sectionId: string | null): void {
    this.set({ loopSectionId: sectionId });
    this.applyLoop();
  }

  private applyLoop() {
    const transport = this.engine?.context.transport;
    if (!transport) return;

    const sectionId = this.state.loopSectionId;
    if (!sectionId) {
      transport.loop = false;
      return;
    }

    const bounds = sectionLoopBounds(this.plan, sectionId);
    if (!bounds) {
      transport.loop = false;
      return;
    }

    // Both edges are whole bar lines by construction (see sectionLoopBounds).
    transport.loopStart = `${bounds.startTicks}i`;
    transport.loopEnd = `${bounds.endTicks}i`;
    transport.loop = true;

    // Jump inside the loop if the transport is sitting outside it.
    if (
      transport.ticks < bounds.startTicks ||
      transport.ticks >= bounds.endTicks
    ) {
      transport.ticks = bounds.startTicks;
    }
  }

  setMetronome(on: boolean): void {
    this.set({ metronome: on });
  }

  setBpm(bpm: number): void {
    const clamped = Math.min(bpmRange.max, Math.max(bpmRange.min, Math.round(bpm)));
    const transport = this.engine?.context.transport;
    // Everything is scheduled in ticks, so the tempo alone moves the whole
    // timeline: sound, playhead, active bar and loop edges together.
    if (transport) transport.bpm.value = clamped;
    this.set({ bpm: clamped });
  }

  private fail(error: unknown) {
    const message =
      error instanceof SampleLoadError
        ? `${error.message} Ses dosyaları yüklenemediği için çalma başlatılamadı.`
        : error instanceof Error
          ? `Ses motoru başlatılamadı: ${error.message}`
          : "Ses motoru başlatılamadı.";
    this.set({ status: "error", error: message, progress: null });
  }

  dispose(): void {
    this.disposed = true;
    const transport = this.engine?.context.transport;
    if (transport) {
      transport.stop();
      transport.cancel();
      transport.loop = false;
    }
    this.engine?.dispose();
    this.engine = null;
    this.listeners.clear();
  }
}

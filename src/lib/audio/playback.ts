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
 *
 * Tempo comes from two numbers that never get mixed up (spec 13.8): the song's
 * own `bpm`, which belongs to the music and is never written to from here, and
 * the practice rate, which belongs to the session. What the transport runs at
 * is the one derived from both, through the same helper the preview uses.
 */
import {
  SampleLoadError,
  applyTempoMap,
  createLiveEngine,
  scheduleSong,
  type Engine,
} from "@/lib/audio/engine";
import {
  buildTempoMap,
  hasTempoChanges,
  tempoAtTicks,
  type TempoMap,
} from "@/lib/audio/tempo";
import {
  barStartTicks,
  nearestBarKey,
  positionAtTicks,
  sectionLoopBounds,
  type PlayPosition,
} from "@/lib/audio/position";
import { NOWHERE } from "@/lib/audio/position";
import {
  DEFAULT_PRACTICE_PERCENT,
  clampPercent,
  effectiveBpm,
} from "@/lib/audio/practice-rate";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { buildSongPlan, type SongPlan } from "@/lib/audio/schedule";
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
  /** The song's own tempo. Read-only here: the music owns it (spec 5.1). */
  songBpm: number;
  /** Whole percent of the song's tempo this session is practising at. */
  practicePercent: number;
  /** What the transport actually runs at: `songBpm * practicePercent / 100`. */
  bpm: number;
  /**
   * The tempo sounding **now** — the playhead's section, practice rate
   * included (spec 8.3, 13.8, K-25). Equal to `bpm` on a song at one tempo.
   */
  activeBpm: number;
  /** True when the song asks for more than one tempo, so the UI can say so. */
  hasTempoChanges: boolean;
  loopSectionId: string | null;
  metronome: boolean;
  progress: LoadProgress | null;
  error: string | null;
};

export type EngineFactory = (
  song: Song,
  options: {
    practicePercent?: number;
    onProgress?: (buffers: number, total: number) => void;
  },
) => Promise<Engine>;

export type PlaybackOptions = {
  /** Where this session starts. The preview is handed the song's own value. */
  practicePercent?: number;
  /** Injected so the controller can be driven without an audio context. */
  createEngine?: EngineFactory;
};

export class PlaybackController {
  private engine: Engine | null = null;
  /**
   * A seek asked for before there was an engine to seek.
   *
   * The audio engine is built on the first play, because a browser will not
   * open an audio context outside a gesture. Until then `seekToBar` had
   * nothing to write a tick to and quietly did nothing — so on a freshly
   * opened song, tapping bar 27 and pressing play started the music at bar 1.
   * Nothing announced the loss; the tap simply did not count.
   *
   * The position is remembered instead, and applied the moment the engine
   * exists. A later seek replaces it, which is right: what the reader asked
   * for last is where they want to be.
   */
  private pendingSeekTicks: number | null = null;
  private listeners = new Set<() => void>();
  private disposed = false;
  private state: PlaybackState;
  private readonly plan: SongPlan;
  private readonly createEngine: EngineFactory;
  /** How many times an engine was built. A rate change must never raise it. */
  private builds = 0;
  /** The tempo timeline at the current practice rate, kept rather than rebuilt. */
  private tempoCache: { percent: number; map: TempoMap };

  constructor(
    private readonly song: Song,
    options: PlaybackOptions = {},
  ) {
    this.plan = buildSongPlan(song);
    this.createEngine = options.createEngine ?? createLiveEngine;
    const practicePercent = clampPercent(
      options.practicePercent ?? DEFAULT_PRACTICE_PERCENT,
    );
    this.tempoCache = {
      percent: practicePercent,
      map: buildTempoMap(song, practicePercent),
    };
    this.state = {
      status: "idle",
      songBpm: song.bpm,
      practicePercent,
      bpm: effectiveBpm(song.bpm, practicePercent),
      activeBpm: tempoAtTicks(this.tempoCache.map, 0),
      hasTempoChanges: hasTempoChanges(song),
      loopSectionId: null,
      metronome: false,
      progress: null,
      error: null,
    };
  }

  /** Engines built so far, for the proof that a tempo change does not rebuild. */
  getEngineBuilds(): number {
    return this.builds;
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
    // Before the engine exists the remembered seek *is* the position: it is
    // where the next play will start from, so it is what a reader is told.
    if (!this.engine) return this.pendingSeekTicks ?? 0;
    return this.engine.context.transport.ticks;
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
    /*
     * The header shows the tempo sounding *now*, and "now" moves on its own:
     * crossing a section boundary changes it with nobody calling a setter.
     * This is the one thing read every frame while the transport runs, so it
     * is where the check belongs. It publishes only when the number actually
     * changed, so a song at one tempo never re-renders for it (spec 13.8,
     * K-25).
     */
    const active = tempoAtTicks(this.tempoMap(), transport.ticks);
    if (active !== this.state.activeBpm) this.set({ activeBpm: active });
    return positionAtTicks(this.plan, transport.ticks);
  }

  private async ensureEngine(): Promise<Engine> {
    if (this.engine) return this.engine;

    this.set({ status: "loading", error: null, progress: null });

    // Tone.start() runs inside the click that called play(), which is what the
    // browser requires to open an audio context.
    const engine = await this.createEngine(this.song, {
      practicePercent: this.state.practicePercent,
      onProgress: (buffers, totalBuffers) =>
        this.set({ progress: { buffers, totalBuffers } }),
    });
    this.builds += 1;

    if (this.disposed) {
      engine.dispose();
      throw new Error("disposed");
    }

    scheduleSong(engine, this.tempoMap(), {
      metronomeEnabled: () => this.state.metronome,
      onEnded: () => this.handleEnded(),
    });

    this.engine = engine;

    // A seek made before this existed is honoured now, not discarded.
    if (this.pendingSeekTicks !== null) {
      engine.context.transport.ticks = this.pendingSeekTicks;
      this.pendingSeekTicks = null;
    }

    this.applyLoop();

    // A loop wrap starts the section again, so nothing from the previous pass
    // may still be ringing over the top of it (spec 8.5).
    engine.context.transport.on("loop", () => engine.expression.stopAll());
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
    // A per-note voice is not on the transport's clock once it has started, so
    // pausing has to end it explicitly (spec 8.5).
    this.engine?.expression.stopAll();
    if (this.state.status === "playing") this.set({ status: "paused" });
  }

  toggle(): void {
    if (this.state.status === "playing") this.pause();
    else void this.play();
  }

  /** Back to the top, for both the transport and the playhead. */
  rewind(): void {
    const transport = this.engine?.context.transport;
    this.engine?.expression.stopAll();
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
    // Jumping somewhere else leaves anything that was sounding behind.
    this.engine?.expression.stopAll();
    const transport = this.engine?.context.transport;
    if (transport) {
      transport.ticks = start;
      this.pendingSeekTicks = null;
    } else {
      this.pendingSeekTicks = start;
    }
    if (this.state.status === "ended") this.set({ status: "paused" });
  }

  /**
   * Move to a bar, or to the nearest one this plan still has.
   *
   * The way a position survives a change to the song's structure. It goes
   * through the same seek as everything else, so an engine that does not exist
   * yet remembers the tick and starts there — nothing is scheduled here and no
   * engine is built.
   */
  seekToNearestBar(barKey: string): void {
    const key = nearestBarKey(this.plan, barKey);
    if (key !== null) this.seekToBar(key);
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

  /**
   * Change the practice speed (spec 13.8).
   *
   * The engine is not rebuilt and nothing is rescheduled: every event and both
   * loop edges are already in ticks, so moving the transport's tempo moves the
   * sound, the playhead, the active bar, the metronome and the loop together.
   * That is also why this may be called while the transport is running.
   *
   * The song's own `bpm` is not written to, here or anywhere else.
   */
  setPracticePercent(percent: number): void {
    const practicePercent = clampPercent(percent);
    const bpm = effectiveBpm(this.state.songBpm, practicePercent);
    const transport = this.engine?.context.transport;
    // The whole curve is rewritten, not just the current value: a song with
    // section tempos has several, and scaling one of them would silently put
    // the rest at the wrong speed (spec 8.3, 13.8, K-25).
    if (transport) applyTempoMap(transport, this.tempoMap(practicePercent));
    // Expression is written in seconds, so the plan is rebuilt at the new
    // speed and anything already sounding on the old timing is cancelled. The
    // engine itself is untouched: no graph, no samples, no rescheduling.
    this.engine?.expression.stopAll();
    this.engine?.expression.setPlan(
      buildExpressionPlan(this.song, { practicePercent }),
    );
    this.set({ practicePercent, bpm, activeBpm: this.activeBpm(practicePercent) });
  }

  /**
   * This song's tempo timeline at the speed being practised at.
   *
   * Cached because `getPosition` asks for it on every animation frame and the
   * answer only changes when the practice rate does.
   */
  private tempoMap(percent: number = this.state.practicePercent): TempoMap {
    if (this.tempoCache.percent !== percent) {
      this.tempoCache = { percent, map: buildTempoMap(this.song, percent) };
    }
    return this.tempoCache.map;
  }

  /**
   * The tempo actually sounding, which is the playhead's section's — not the
   * song's top-level number (spec 13.8, K-25). Showing the top-level tempo on
   * a song that changes tempo would be a display that is wrong most of the
   * time.
   */
  private activeBpm(percent: number = this.state.practicePercent): number {
    const ticks = this.engine?.context.transport.ticks ?? 0;
    return tempoAtTicks(this.tempoMap(percent), ticks);
  }

  getPracticePercent(): number {
    return this.state.practicePercent;
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
    this.engine?.expression.dispose();
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

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
  // Aliased: the class exposes methods of the same names, and inside the
  // class body a method would shadow the import.
  setTrackAudibility as writeTrackAudibility,
  setTrackMix as writeTrackMix,
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
  type PlayPosition,
} from "@/lib/audio/position";
import {
  barKeyParts,
  loopBounds,
  NO_LOOP,
  type PlaybackLoop,
} from "@/lib/practice/range";
import {
  countInClicks,
  countInSeconds,
  DEFAULT_COUNT_IN,
  type CountInBars,
} from "@/lib/practice/count-in";
import { NOWHERE } from "@/lib/audio/position";
import {
  DEFAULT_PRACTICE_PERCENT,
  clampPercent,
  effectiveBpm,
} from "@/lib/audio/practice-rate";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { silentTrackNotice } from "@/lib/audio/preset-availability";
import type { PreviewBankSession } from "@/lib/audio/preview-bank";
import { buildSongPlan, type SongPlan } from "@/lib/audio/schedule";
import {
  planSelectionIteration,
  selectionResumeWindow,
} from "@/lib/playback/selection-iteration";
import type { SelectionPlaybackPlan } from "@/lib/playback/selection-playback";
import type { Bar, Song } from "@/lib/song/schema";

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
  /**
   * What is looping, and which kind of loop it is (2R-A §10).
   *
   * A typed value rather than a nullable section id. There are two kinds of
   * loop now — a whole section, and a practice range of chosen bars — and one
   * string could only have told them apart by convention, which is a
   * convention every reader of it would have had to remember.
   */
  loop: PlaybackLoop;
  /** How many bars are counted in before playing. Off, one, or two (§11). */
  countInBars: CountInBars;
  /**
   * True while the clicks are sounding and the music has not started.
   *
   * Its own flag rather than a status, because the transport really is about
   * to play and every other part of the app that asks "is it playing" should
   * keep saying yes. What changes is only what the reader is told.
   */
  countingIn: boolean;
  metronome: boolean;
  progress: LoadProgress | null;
  error: string | null;
  /**
   * What to tell the reader about tracks that cannot make a sound, or null
   * when every track can (2O-B.1 §2).
   *
   * A sentence rather than a code, and their own track names rather than a
   * preset id: this is the difference between a reader learning that their
   * guitar is silent and a reader deciding the app is broken. It is not an
   * error — the rest of the song plays — so it does not go in `error`, and
   * it is not known until the graph has been built.
   */
  silentTrackNotice: string | null;
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
  /**
   * Keeps decoded sample banks alive across the engines this controller
   * builds and throws away (2O-B.1 §3).
   *
   * Passed by a caller that builds many short-lived controllers — the chord
   * audition builds one per shape — and left out by the song's own playback,
   * which builds one engine and keeps it.
   */
  bankSession?: PreviewBankSession;
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
  /**
   * The exact transport tick the reader paused on (2V-B.1 §8).
   *
   * Held rather than re-read, and read *before* anything else moves in
   * `pause`. A pause touches the transport, the playhead and the voice pool,
   * and a tick sampled after those is a tick that may already have been
   * nudged — which would resume the music somewhere the reader did not stop
   * it. Null means there is nothing to come back to: cleared by every seek,
   * rewind, end, abort, selection change and dispose, so a resume can never
   * restore voices belonging to a moment the reader has left.
   */
  private heldResumeTicks: number | null = null;
  private listeners = new Set<() => void>();
  private disposed = false;
  private state: PlaybackState;
  private readonly plan: SongPlan;
  private readonly createEngine: EngineFactory;
  /** How many times an engine was built. A rate change must never raise it. */
  private builds = 0;
  /** The tempo timeline at the current practice rate, kept rather than rebuilt. */
  private tempoCache: { percent: number; map: TempoMap };
  /**
   * Levels asked for by an open mixer that have not been committed yet, and
   * the audition the session is listening through.
   *
   * Both are remembered rather than only written, because the graph may not
   * exist yet: someone can open the mixer, move a slider and only then press
   * play. What they set is applied the moment the engine appears, in the same
   * place a pending seek is (spec 13.18 §6).
   */
  private mixOverrides = new Map<string, { volumeDb: number; pan: number }>();
  private audibleTrackIds: readonly string[] | null = null;
  /** Told once per completed pass of the loop, and nothing else (§12). */
  private loopListeners = new Set<() => void>();
  /**
   * The count-in that is currently sounding, if one is (2R-A §VIII).
   *
   * A token rather than a boolean, because "is a count-in running" and "is
   * *this* count-in still the one that should start playback" are different
   * questions once a reader can press play twice. Every scheduled step checks
   * the token it was created with, so a cancelled count-in cannot start a
   * ghost playback later.
   */
  private countInToken: object | null = null;
  private readonly bankSession: PreviewBankSession | undefined;

  constructor(
    private song: Song,
    options: PlaybackOptions = {},
  ) {
    this.plan = buildSongPlan(song);
    this.createEngine = options.createEngine ?? createLiveEngine;
    this.bankSession = options.bankSession;
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
      loop: NO_LOOP,
      countInBars: DEFAULT_COUNT_IN,
      countingIn: false,
      metronome: false,
      progress: null,
      error: null,
      silentTrackNotice: null,
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

  /** The tick a pause is holding, or null. Evidence, and the §8 tests. */
  getHeldResumeTicks(): number | null {
    return this.heldResumeTicks;
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
    const bounds = loopBounds(this.plan, this.state.loop);
    return bounds ? { on: true, ...bounds } : null;
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

    /*
     * Retention opens the moment there is a context to open it on — before
     * the check below, deliberately (2O-B.1 §3).
     *
     * A reader pressing through chord variations disposes each controller
     * long before its engine has finished loading, so most preview engines
     * arrive here already abandoned. Opening retention after that check
     * meant the abandoned ones released their banks with nothing holding on,
     * and the next audition decoded the same seven files again — which is
     * exactly the 168 requests this was supposed to fix, and it still
     * measured 175 until this line moved. The session's job is to keep banks
     * on every context its engines were built on; whether a particular
     * engine survived is not the session's business.
     */
    this.bankSession?.open(engine.context);

    if (this.disposed) {
      engine.dispose();
      throw new Error("disposed");
    }

    scheduleSong(engine, this.tempoMap(), {
      metronomeEnabled: () => this.state.metronome,
      onEnded: () => this.handleEnded(),
    });

    this.engine = engine;
    this.set({ silentTrackNotice: silentTrackNotice(engine.silentTracks) });

    // A seek made before this existed is honoured now, not discarded.
    if (this.pendingSeekTicks !== null) {
      engine.context.transport.ticks = this.pendingSeekTicks;
      this.pendingSeekTicks = null;
    }

    // Nor is a level moved, or a track silenced, before there was a graph.
    for (const [trackId, mix] of this.mixOverrides) {
      writeTrackMix(engine, trackId, mix.volumeDb, mix.pan);
    }
    if (this.audibleTrackIds !== null) {
      writeTrackAudibility(engine, this.audibleTrackIds);
    }

    this.applyLoop();

    // A loop wrap starts the section again, so nothing from the previous pass
    // may still be ringing over the top of it (spec 8.5).
    engine.context.transport.on("loop", () => {
      /*
       * Whether there is still a loop, asked now (2V-B.1 §9).
       *
       * A wrap notification is queued on the audio thread and delivered
       * afterwards, so one can arrive *after* the reader has turned the loop
       * off. Acting on it then does three visible wrong things: it silences
       * the pass that is still legitimately sounding, it tells the
       * progressive rate that a pass completed when the reader has stopped
       * practising, and on a selection loop it restarts music the reader has
       * dismissed.
       *
       * Both authorities are consulted, because they can disagree for one
       * frame: this controller's own state is what the reader pressed, and
       * the transport's flag is what the audio clock is actually doing.
       * A wrap is only real when both still say a loop is running.
       */
      if (this.disposed) return;
      if (this.state.loop.kind === "none") return;
      if (!engine.context.transport.loop) return;

      engine.expression.stopAll();
      /*
       * And the pass begins again — all of it (2V-B.3 §1–§5).
       *
       * The onsets inside the window are the transport's own events and come
       * back by themselves. A note that was already ringing when the window
       * opened is not an event at all, so unless it is put back here the
       * reader hears the held chord's tail on the first pass and silence in
       * its place on every wrap after it. That is the defect this batch was
       * opened on, and the fix is that a wrap runs the *same* iteration the
       * first play ran, at the wrap's own audio moment.
       *
       * After `stopAll`, never before it: the previous pass has to be
       * released before its successor is put in the air, or a four-pass loop
       * accumulates four copies of the same string.
       */
      const looping = this.selectionPlayback;
      if (looping !== null && looping.mode === "loop") {
        this.resumeSustainedInto(engine, looping, engine.context.now());
      }
      /*
       * And the pass is announced. This is the *only* signal the progressive
       * rate is allowed to act on (§12): the transport came round, which the
       * app knows, rather than anything about how the pass was played, which
       * it does not.
       */
      for (const listener of this.loopListeners) listener();
    });
    return engine;
  }

  /**
   * Be told when the loop comes round.
   *
   * Returns the way to stop being told, so a component that unmounts mid-loop
   * does not leave a listener behind holding its closure.
   */
  onLoopPass(listener: () => void): () => void {
    this.loopListeners.add(listener);
    return () => {
      this.loopListeners.delete(listener);
    };
  }

  setCountIn(bars: CountInBars): void {
    this.set({ countInBars: bars });
  }

  /**
   * The bar the count-in should count, or null when there is nothing to count.
   *
   * The *loop's first bar*, not the song's first and not the one on screen:
   * a count-in in 4/4 in front of a 7/8 loop would put the reader in the
   * wrong place before a note had sounded.
   */
  private countInBar(): Bar | null {
    const bounds = loopBounds(this.plan, this.state.loop);
    const at = bounds ? bounds.startTicks : this.getTransportTicks();
    const marker =
      this.plan.bars.find((bar) => bar.time === at) ??
      this.plan.bars.find(
        (bar) => at >= bar.time && at < bar.time + bar.durationTicks,
      );
    if (!marker) return null;
    const parts = barKeyParts(marker.barKey);
    const section = this.song.sections.find(
      (entry) => entry.id === parts?.sectionId,
    );
    return section?.bars[parts?.localBarIndex ?? -1] ?? null;
  }

  private handleEnded() {
    const transport = this.engine?.context.transport;
    if (!transport) return;
    /* The song is over; there is no held moment to come back to. */
    this.heldResumeTicks = null;
    transport.pause();
    transport.ticks = this.plan.totalTicks;
    this.set({ status: "ended" });
  }

  async play(): Promise<void> {
    /*
     * A disposed controller is not a broken one (2V-B.1 §9). A press that
     * arrives after the screen has gone — a queued handler, a stale closure
     * in a component that has already unmounted — must build nothing, sound
     * nothing and, above all, not set an error the reader would be shown on
     * whatever they opened next.
     */
    if (this.disposed) return;
    if (this.state.status === "loading") return;

    try {
      const engine = await this.ensureEngine();
      const transport = engine.context.transport;

      // Playing again after the end starts from the top, and from the top
      // there is nothing left over to continue.
      if (this.state.status === "ended") {
        transport.ticks = 0;
        this.heldResumeTicks = null;
      }

      /*
       * The count-in lives here and nowhere else: it is clicks on the audio
       * clock and a delayed transport start. No bar is added to the Song, no
       * bar number moves, and nothing about it reaches an export.
       */
      /*
       * A second press while a count-in is running is the same press, not a
       * second count-in. Without this the reader gets two sets of clicks and
       * two scheduled starts (§VIII).
       */
      if (this.countInToken !== null) return;

      const firstBar = this.countInBar();
      const input =
        firstBar === null
          ? null
          : {
              bars: this.state.countInBars,
              firstBar,
              bpm: this.state.songBpm,
              practicePercent: this.state.practicePercent,
            };
      const wait = input === null ? 0 : countInSeconds(input);

      if (wait > 0 && input !== null) {
        const token = {};
        this.countInToken = token;
        const now = engine.context.now();
        const { click } = engine.metronome;
        /*
         * On the audio clock, so the clicks are in time — a count-in that
         * drifts is worse than none. Cancellation is the token plus an
         * explicit cancel of the click voice below; both are needed, because
         * a scheduled attack does not consult anything when it fires.
         */
        for (const beat of countInClicks(input)) {
          click.triggerAttackRelease(
            0.02,
            now + (wait - beat.beforeSeconds),
            beat.downbeat ? 1 : 0.55,
          );
        }
        transport.start(now + wait);
        /* The same audio-clock moment the transport is given, so what was
           sounding comes back exactly when the music does (§8). */
        this.resumeHeldVoices(engine, now + wait);
        this.set({ status: "playing", error: null, countingIn: true });
        engine.context.draw.schedule(() => {
          if (this.countInToken !== token) return;
          this.countInToken = null;
          this.set({ countingIn: false });
        }, now + wait);
        return;
      }

      /*
       * One moment, given to both. Nothing is rescheduled and no engine is
       * rebuilt: the events are still on the transport where they were put,
       * and the only thing added is the tail of what the pause cut off.
       */
      const at = engine.context.now();
      transport.start(at);
      this.resumeHeldVoices(engine, at);
      this.set({ status: "playing", error: null, countingIn: false });
    } catch (error) {
      this.fail(error);
    }
  }

  /**
   * Take back a count-in that has not finished (§VIII).
   *
   * Three things, because three different mechanisms are holding it: the
   * token so nothing scheduled acts, the transport so the pending start does
   * not happen, and the click voice so the clicks already on the audio clock
   * do not sound. Anything less leaves a ghost.
   */
  private cancelCountIn(): void {
    if (this.countInToken === null) return;
    this.countInToken = null;
    const engine = this.engine;
    if (engine) {
      const transport = engine.context.transport;
      // The start was scheduled for a moment that has not arrived.
      transport.stop();
      const { click } = engine.metronome;
      const now = engine.context.now();
      /*
       * Two schedules, not one. The envelope holds the shape of each click
       * and `cancel` truncates it; the noise source holds a *state* timeline
       * of the starts themselves, and nothing about cancelling the envelope
       * touches it.
       *
       * This used to read `click.noise?.cancel?.(now)` through an untyped
       * cast. `Noise` has no `cancel`, so the optional call was a silent
       * no-op and every cancelled click stayed on the source's timeline —
       * and the *next* play, scheduling its own clicks at earlier times,
       * tripped Tone's "the time must be greater than or equal to the last
       * scheduled time" and left the transport stopped with an audio error.
       * The acceptance run found it by pressing play again after a
       * cancellation, which nothing had done before.
       */
      click.envelope.cancel(now);
      click.noise.stop(now);
    }
    /*
     * A cancelled count-in leaves the transport stopped, so the screen has to
     * say so. While the clicks are running the status is already "playing" —
     * that is what makes the button read "Duraklat" — and cancelling without
     * putting it back left the reader looking at a transport that claimed to
     * be playing with nothing coming out of it. Found by rewinding mid-count
     * in the acceptance run.
     */
    if (this.state.countingIn) {
      this.set({
        countingIn: false,
        ...(this.state.status === "playing" ? { status: "paused" as const } : {}),
      });
    }
  }

  pause(): void {
    this.cancelCountIn();
    const transport = this.engine?.context.transport;
    if (!transport) return;
    /*
     * The tick, before anything moves. Everything below this line touches
     * something the transport owns, and the number the resume needs is the
     * one that was true when the reader pressed the button (§8).
     */
    const at = transport.ticks;
    // pause() keeps the tick position, unlike stop().
    transport.pause();
    /* Said again, explicitly. A cancelled count-in inside `cancelCountIn`
       calls `stop()`, and the playhead the reader is looking at has to be the
       tick they paused on rather than wherever the teardown left it. */
    transport.ticks = at;
    this.heldResumeTicks = at;
    // A per-note voice is not on the transport's clock once it has started, so
    // pausing has to end it explicitly (spec 8.5).
    this.engine?.expression.stopAll();
    if (this.state.status === "playing") {
      this.set({ status: "paused", countingIn: false });
    }
  }

  /**
   * Put back what the pause left in the air, at the moment playback resumes.
   *
   * The held tick is cleared **after** the decision, not before it: "should
   * this resume restore anything" and "there is nothing left to restore" are
   * two different states, and collapsing them is how a second press ends up
   * restoring the same voices twice.
   *
   * The transport is asked where it is rather than trusted. Every path that
   * moves the playhead clears the held tick itself; this is the belt to that
   * suspender, and it is what makes "seek does not restore stale voices" true
   * even if a new path is added tomorrow and forgets.
   */
  private resumeHeldVoices(engine: Engine, at: number): void {
    const held = this.heldResumeTicks;
    this.heldResumeTicks = null;
    if (held === null) return;
    if (engine.context.transport.ticks !== held) return;

    /* Inside a selection, the resume is bounded by the same window the
       audition was scheduled with: a continuation from another track, or
       from outside the chosen bars, is music the reader asked not to hear. */
    const plan = this.selectionPlayback;
    engine.expression.resumeAt(
      held,
      at,
      plan === null ? null : selectionResumeWindow(plan),
    );
  }

  toggle(): void {
    if (this.state.status === "playing") this.pause();
    else void this.play();
  }

  /** Back to the top, for both the transport and the playhead. */
  rewind(): void {
    this.cancelCountIn();
    const transport = this.engine?.context.transport;
    /* Somewhere else entirely: a voice from the old position would be a
       sound the reader left behind (§8). */
    this.heldResumeTicks = null;
    this.engine?.expression.stopAll();
    if (transport) {
      transport.ticks = loopBounds(this.plan, this.state.loop)?.startTicks ?? 0;
    }
    if (this.state.status === "ended") this.set({ status: "paused" });
  }

  seekToBar(barKey: string): void {
    this.cancelCountIn();
    const start = barStartTicks(this.plan, barKey);
    if (start === null) return;
    // Jumping somewhere else leaves anything that was sounding behind.
    this.heldResumeTicks = null;
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

  /* ----------------------------------------- listening to a selection */

  /**
   * The selection currently being heard, or null (2V-A §3, §4).
   *
   * Held rather than derived, because the drawer has to be able to say
   * "Seçim döngüsünü kapat" and a loop's bounds alone cannot tell a reader
   * whether the run they are looking at is the one that is sounding.
   */
  private selectionPlayback: SelectionPlaybackPlan | null = null;

  /** A run already being started, so a double press cannot start two. */
  private selectionStart: Promise<void> | null = null;

  /**
   * Which start is still wanted (2V-A §5).
   *
   * The engine build is asynchronous, and everything that cancels a run —
   * leaving the view, cancelling the selection, unmounting — happens
   * synchronously while that build is still in the air. Without a token the
   * cancelled start comes back a moment later and begins playing something
   * the reader has already dismissed.
   */
  private selectionToken: object | null = null;

  getSelectionPlayback(): SelectionPlaybackPlan | null {
    return this.selectionPlayback;
  }

  /**
   * Hear this selection, once or in a loop.
   *
   * Everything about it is ephemeral: no command is produced, nothing is
   * written, and the Song is not read except to be scheduled. The engine is
   * the one that plays the whole song — rescheduled with a window, which is
   * the only difference between this and pressing play.
   *
   * A second press while the first is still starting is the same press. The
   * engine build is asynchronous, so without this a reader who taps twice
   * gets two schedules on one transport and hears the selection played over
   * itself (§5).
   */
  async playSelection(plan: SelectionPlaybackPlan): Promise<void> {
    if (this.disposed) return;
    if (this.selectionStart) {
      await this.selectionStart;
      /* The run that arrived first is the one that stands, unless this press
         asked for different music. */
      if (
        this.selectionPlayback &&
        this.selectionPlayback.startTicks === plan.startTicks &&
        this.selectionPlayback.endTicks === plan.endTicks &&
        this.selectionPlayback.mode === plan.mode
      ) {
        return;
      }
    }
    const run = this.startSelection(plan);
    this.selectionStart = run;
    try {
      await run;
    } finally {
      if (this.selectionStart === run) this.selectionStart = null;
    }
  }

  private async startSelection(plan: SelectionPlaybackPlan): Promise<void> {
    const token = {};
    this.selectionToken = token;

    /*
     * Whatever was playing stops first, and stops *completely*: a transport
     * left running under a new schedule is the second voice §5 forbids.
     */
    this.cancelCountIn();
    this.heldResumeTicks = null;
    this.engine?.context.transport.pause();
    this.engine?.expression.stopAll();

    try {
      const engine = await this.ensureEngine();
      /* Abandoned while the engine was being built: nothing to start. */
      if (this.disposed || this.selectionToken !== token) return;

      this.selectionPlayback = plan;
      this.rescheduleForSelection(engine, plan);

      /*
       * The loop is the one loop. Setting it here replaces a section or a
       * practice range rather than running beside it (§4), and clearing it
       * for a one-shot is the same single authority saying "nothing".
       */
      this.setLoop(
        plan.mode === "loop"
          ? {
              kind: "selection",
              bounds: { startTicks: plan.startTicks, endTicks: plan.endTicks },
            }
          : NO_LOOP,
      );

      engine.context.transport.ticks = plan.startTicks;
      /* One moment for both, so a continuation lines up with the transport
         rather than with whenever this line happened to run. */
      const at = engine.context.now();
      engine.context.transport.start(at);
      this.resumeSustainedInto(engine, plan, at);
      this.set({ status: "playing", error: null, countingIn: false });
    } catch (error) {
      /*
       * The audio failed. Nothing is sounding and nothing is held, so the
       * reader sees the ordinary playback error rather than a drawer that
       * says a loop is running (§5). The caller does not have to catch: the
       * two intents are `void`-called from a press handler.
       */
      if (this.selectionToken === token) this.selectionToken = null;
      this.selectionPlayback = null;
      this.fail(error);
    }
  }

  /**
   * Continue whatever was already ringing when the selection opened (§4).
   *
   * A reader who holds the middle of a let-ring chord has selected music, and
   * before this they heard nothing: the transport only fires events at or
   * after its position, so every note that began earlier was simply lost, and
   * the plan refused the selection outright rather than admit it.
   *
   * The continuation goes through the *same* resume the pause uses. Nothing
   * is re-struck — `activeVoicesAt` skips any onset at or after the resume
   * tick, so the boundary gains no attack the reader never wrote — and a
   * slide or vibrato caught mid-flight continues from the pitch and phase it
   * had actually reached.
   *
   * The window keeps the plan's track filter and drops its lower bound, and
   * that asymmetry is the whole point rather than an oversight: a
   * continuation from an unselected instrument is music the reader asked not
   * to hear, while a continuation from before the selection's first tick is
   * exactly what is being asked for. Zero is "no lower bound", not a
   * position — the upper bound is already enforced by the resume itself.
   */
  private resumeSustainedInto(
    engine: Engine,
    plan: SelectionPlaybackPlan,
    at: number,
  ): void {
    const iteration = planSelectionIteration(plan);
    if (!iteration.continues) return;
    engine.expression.resumeAt(iteration.resumeTicks, at, iteration.window);
  }

  /**
   * Stop listening, and put everything back where it was.
   *
   * Safe to call when nothing is running, because that is what every cleanup
   * path in §5 needs: leaving a view, changing a track, cancelling the
   * selection and unmounting all arrive here without first checking.
   */
  stopSelection(): void {
    const plan = this.selectionPlayback;
    this.cancelCountIn();
    /* Also cancels a start still in the air, which is what an abort is. */
    this.selectionToken = null;
    this.selectionPlayback = null;
    this.heldResumeTicks = null;

    const engine = this.engine;
    if (!engine) return;

    engine.context.transport.pause();
    engine.expression.stopAll();
    this.setLoop(NO_LOOP);
    /* The whole song again, so the next ordinary play is not still bounded. */
    this.scheduleWholeSong(engine);
    if (plan) engine.context.transport.ticks = plan.startTicks;
    if (this.state.status === "playing") this.set({ status: "paused" });
  }

  /**
   * A one-shot audition reached the end of the selection.
   *
   * Back to where it started rather than on into the next bar: the reader
   * asked to hear this much, and leaving the playhead past the end would make
   * pressing again play something else (§3).
   */
  handleSelectionEnded(): void {
    const plan = this.selectionPlayback;
    if (!plan || plan.mode !== "once") return;
    const transport = this.engine?.context.transport;
    this.heldResumeTicks = null;
    this.engine?.expression.stopAll();
    if (transport) {
      transport.pause();
      transport.ticks = plan.startTicks;
    }
    this.selectionPlayback = null;
    this.set({ status: "paused" });
  }

  private rescheduleForSelection(engine: Engine, plan: SelectionPlaybackPlan) {
    scheduleSong(engine, this.tempoMap(), {
      metronomeEnabled: () => this.state.metronome,
      onEnded: () => this.handleSelectionEnded(),
      window: {
        startTicks: plan.startTicks,
        endTicks: plan.endTicks,
        trackIds: plan.trackIds,
      },
    });
  }

  private scheduleWholeSong(engine: Engine) {
    scheduleSong(engine, this.tempoMap(), {
      metronomeEnabled: () => this.state.metronome,
      onEnded: () => this.handleEnded(),
    });
  }

  setLoopSection(sectionId: string | null): void {
    this.setLoop(sectionId === null ? NO_LOOP : { kind: "section", sectionId });
  }

  /**
   * Loop this, or nothing.
   *
   * The one way the loop changes. A range whose bars have gone resolves to no
   * bounds and therefore to no loop — it never falls back to the section it
   * used to be in, because a loop the reader did not ask for is worse than
   * none.
   */
  setLoop(loop: PlaybackLoop): void {
    // A count-in counts *the loop's* first bar; changing the loop mid-count
    // would leave the reader counted in to somewhere else.
    this.cancelCountIn();
    this.set({ loop });
    this.applyLoop();
  }

  private applyLoop() {
    const transport = this.engine?.context.transport;
    if (!transport) return;

    const bounds = loopBounds(this.plan, this.state.loop);
    if (!bounds) {
      transport.loop = false;
      return;
    }

    // Both edges are whole bar lines by construction (see `lib/practice`).
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

  /**
   * Preview one track's levels without changing the song (spec 13.18 §6).
   *
   * This is what a slider drag calls. It writes the graph and remembers the
   * value; it does not commit, does not write storage and does not add a
   * history step — the mixer's Uygula does that, once, through the one gate.
   */
  setTrackMix(trackId: string, volumeDb: number, pan: number): void {
    this.mixOverrides.set(trackId, { volumeDb, pan });
    if (this.engine) writeTrackMix(this.engine, trackId, volumeDb, pan);
  }

  /** Who the session is listening to. Session only; never reaches the song. */
  setTrackAudibility(audibleTrackIds: readonly string[]): void {
    this.audibleTrackIds = [...audibleTrackIds];
    if (this.engine) writeTrackAudibility(this.engine, this.audibleTrackIds);
  }

  /**
   * Put the graph back on the song's own levels (spec 13.18 §6, cancel).
   *
   * Every previewed value is forgotten and the committed one written in its
   * place. The audition is deliberately left alone: mute and solo are not a
   * draft of anything, they are how the reader is listening right now.
   */
  clearTrackMixPreview(): void {
    this.mixOverrides.clear();
    if (!this.engine) return;
    for (const track of this.song.tracks) {
      writeTrackMix(this.engine, track.id, track.volumeDb, track.pan ?? 0);
    }
  }

  /**
   * The song changed, and the only thing that changed was the mix.
   *
   * The caller has already asked `isMixOnlyChange`. Nothing is rebuilt: the
   * plan, the schedule, the samples, the transport position and the loop are
   * all still right, because none of them is about how loud a track is. The
   * new levels are written onto the channels that are playing them.
   */
  applyMixOnly(next: Song): void {
    this.song = next;
    /* A replaced Song, even one that only changed levels. Nothing held may
       outlive the object it was measured against (§8). */
    this.heldResumeTicks = null;
    this.mixOverrides.clear();
    if (!this.engine) return;
    for (const track of next.tracks) {
      writeTrackMix(this.engine, track.id, track.volumeDb, track.pan ?? 0);
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
    /*
     * The plan and the timeline it was built on, together (§8). Only the
     * expressive layer is touched: the sampler's and the drums' voices are
     * on the transport's own clock and go on sounding, because a speed
     * change is not a reason to silence the music that is playing.
     */
    this.engine?.expression.setPlan(
      buildExpressionPlan(this.song, { practicePercent }),
      this.tempoMap(practicePercent),
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
    // Before anything is torn down: a pending count-in holds a scheduled
    // transport start, and a disposed controller must not produce one (§VIII).
    this.cancelCountIn();
    this.disposed = true;
    this.heldResumeTicks = null;
    this.selectionPlayback = null;
    this.selectionStart = null;
    this.selectionToken = null;
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

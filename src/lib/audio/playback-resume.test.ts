/**
 * Pause, resume and loop shutdown, on the real controller (2V-B.1 §8, §9).
 *
 * The engine is injected, so this runs `PlaybackController` itself without an
 * audio context. What is being checked is not that Tone works: it is that the
 * tick the reader paused on is the tick the resume is given, that nothing is
 * rebuilt or rescheduled to achieve that, and that a loop notification which
 * arrives after the reader turned the loop off does nothing at all.
 */
import { describe, expect, it } from "vitest";

import type { Engine } from "@/lib/audio/engine";
import { PlaybackController } from "@/lib/audio/playback";
import { buildSongPlan } from "@/lib/audio/schedule";
import { fakeExpressionRuntime } from "@/test/engine-fakes";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import type { Song } from "@/lib/song/schema";

function harness(options: { song?: Song } = {}) {
  const target = options.song ?? SAMPLE_SONG;
  let clock = 10;

  const transport = {
    ticks: 0,
    seconds: 0,
    PPQ: 192,
    bpm: { value: 0, setValueAtTime: () => {}, cancelScheduledValues: () => {} },
    loop: false,
    loopStart: "",
    loopEnd: "",
    /** Every `schedule` this transport was given, so a reschedule is visible. */
    scheduled: 0,
    cancels: 0,
    starts: [] as unknown[],
    pauses: 0,
    stops: 0,
    loopCallbacks: [] as (() => void)[],
    schedule() {
      transport.scheduled += 1;
      return transport.scheduled;
    },
    on(event: string, callback: () => void) {
      if (event === "loop") transport.loopCallbacks.push(callback);
    },
    start(at?: unknown) {
      transport.starts.push(at);
    },
    pause() {
      transport.pauses += 1;
    },
    stop() {
      transport.stops += 1;
    },
    cancel() {
      transport.cancels += 1;
    },
  };

  const expression = fakeExpressionRuntime(target);
  let builds = 0;

  const engine = {
    context: {
      transport,
      now: () => clock,
      draw: { schedule: (run: () => void) => run() },
    },
    master: {},
    metronome: {
      click: {
        triggerAttackRelease: () => {},
        envelope: { cancel: () => {} },
        noise: { stop: () => {} },
      },
      filter: {},
    },
    voices: new Map(),
    meters: new Map(),
    plan: buildSongPlan(target),
    expression,
    silentTracks: [],
    expectedBuffers: 0,
    loadedBuffers: 0,
    dispose: () => {},
  } as unknown as Engine;

  const controller = new PlaybackController(target, {
    createEngine: async () => {
      builds += 1;
      return engine;
    },
  });

  return {
    controller,
    transport,
    expression,
    builds: () => builds,
    setClock: (value: number) => {
      clock = value;
    },
  };
}

describe("the exact tick a pause holds (§8)", () => {
  it("holds the tick the transport was on, and gives that same tick back", async () => {
    const { controller, transport, expression } = harness();
    await controller.play();

    transport.ticks = 1234;
    controller.pause();

    expect(controller.getHeldResumeTicks()).toBe(1234);
    /* The playhead does not move while it is paused, so what the reader sees
       and what the resume is about to use are the same number. */
    expect(transport.ticks).toBe(1234);
    expect(controller.getTransportTicks()).toBe(1234);

    await controller.play();
    expect(expression.log.resumes).toHaveLength(1);
    expect(expression.log.resumes[0]?.ticks).toBe(1234);
  });

  it("resumes at the same audio moment the transport is started at", async () => {
    const { controller, transport, expression, setClock } = harness();
    await controller.play();
    transport.ticks = 500;
    controller.pause();

    setClock(42.5);
    await controller.play();

    expect(transport.starts.at(-1)).toBe(42.5);
    expect(expression.log.resumes[0]?.audioTime).toBe(42.5);
  });

  it("does not rebuild the engine or reschedule the song to resume", async () => {
    const { controller, transport, builds } = harness();
    await controller.play();
    const scheduledBefore = transport.scheduled;
    const cancelsBefore = transport.cancels;

    transport.ticks = 700;
    controller.pause();
    await controller.play();

    expect(builds()).toBe(1);
    expect(transport.scheduled).toBe(scheduledBefore);
    expect(transport.cancels).toBe(cancelsBefore);
  });

  it("clears the held tick after the resume, so a second press restores nothing", async () => {
    const { controller, transport, expression } = harness();
    await controller.play();
    transport.ticks = 300;
    controller.pause();
    await controller.play();
    expect(controller.getHeldResumeTicks()).toBeNull();

    await controller.play();
    expect(expression.log.resumes).toHaveLength(1);
  });

  it("restores nothing after a seek", async () => {
    const { controller, transport, expression } = harness();
    await controller.play();
    transport.ticks = 900;
    controller.pause();

    const bar = buildSongPlan(SAMPLE_SONG).bars[1];
    expect(bar).toBeDefined();
    controller.seekToBar(bar!.barKey);
    expect(controller.getHeldResumeTicks()).toBeNull();

    await controller.play();
    expect(expression.log.resumes).toHaveLength(0);
  });

  it("restores nothing after a rewind", async () => {
    const { controller, transport, expression } = harness();
    await controller.play();
    transport.ticks = 900;
    controller.pause();

    controller.rewind();
    expect(controller.getHeldResumeTicks()).toBeNull();
    await controller.play();
    expect(expression.log.resumes).toHaveLength(0);
  });

  it("restores nothing once the Song has been replaced", async () => {
    const { controller, transport, expression } = harness();
    await controller.play();
    transport.ticks = 640;
    controller.pause();

    controller.applyMixOnly({
      ...SAMPLE_SONG,
      tracks: SAMPLE_SONG.tracks.map((track) => ({ ...track, volumeDb: -9 })),
    });
    expect(controller.getHeldResumeTicks()).toBeNull();
    await controller.play();
    expect(expression.log.resumes).toHaveLength(0);
  });

  it("refuses a resume whose tick no longer matches the transport", async () => {
    const { controller, transport, expression } = harness();
    await controller.play();
    transport.ticks = 400;
    controller.pause();

    /*
     * Something moved the playhead without going through a seek — the belt to
     * the suspender above. A resume from a stale tick would put back voices
     * belonging to a moment the reader has left.
     */
    transport.ticks = 405;
    await controller.play();
    expect(expression.log.resumes).toHaveLength(0);
    expect(controller.getHeldResumeTicks()).toBeNull();
  });

  it("bounds a selection resume by the window the selection was played with", async () => {
    const { controller, transport, expression } = harness();
    await controller.playSelection({
      startTicks: 768,
      endTicks: 1536,
      trackIds: ["gtr"],
      mode: "loop",
      onsetCount: 4,
      sustainCount: 0,
    });

    transport.ticks = 1000;
    controller.pause();
    await controller.play();

    /*
     * The track filter and the end are the selection's; the lower bound is
     * dropped (2V-B.3 §4).
     *
     * This assertion used to name 768, and that was the pause path holding a
     * private opinion about the audition's boundaries. A note that began
     * before the selection and was still ringing when it opened is *part of*
     * what the reader is hearing — the first play puts it there deliberately.
     * Bounding the resume at 768 made that same voice vanish across a pause,
     * so the audition sounded different before and after a button the reader
     * pressed only to stop for a moment. All three moments now read one
     * window, from one function.
     */
    expect(expression.log.resumes[0]?.window).toEqual({
      startTicks: 0,
      endTicks: 1536,
      trackIds: ["gtr"],
    });
  });

  it("passes no window when the whole song is playing", async () => {
    const { controller, transport, expression } = harness();
    await controller.play();
    transport.ticks = 120;
    controller.pause();
    await controller.play();
    expect(expression.log.resumes[0]?.window).toBeNull();
  });

  it("holds nothing once disposed", async () => {
    const { controller, transport } = harness();
    await controller.play();
    transport.ticks = 200;
    controller.pause();
    controller.dispose();
    expect(controller.getHeldResumeTicks()).toBeNull();
  });
});

describe("loop disable and what a queued wrap may do (§9)", () => {
  it("clears the transport's loop and the reported state in one call", async () => {
    const { controller, transport } = harness();
    await controller.play();
    controller.setLoop({
      kind: "selection",
      bounds: { startTicks: 0, endTicks: 768 },
    });
    expect(transport.loop).toBe(true);
    expect(controller.getState().loop.kind).toBe("selection");

    controller.setLoop({ kind: "none" });
    /* Synchronously: no frame in which the screen says off and the transport
       is still wrapping. */
    expect(transport.loop).toBe(false);
    expect(controller.getState().loop.kind).toBe("none");
  });

  it("ignores a wrap notification that arrives after the loop was turned off", async () => {
    const { controller, transport, expression } = harness();
    await controller.play();
    controller.setLoop({
      kind: "selection",
      bounds: { startTicks: 0, endTicks: 768 },
    });

    let passes = 0;
    controller.onLoopPass(() => {
      passes += 1;
    });

    /* A real wrap, first, so the check below is about the guard rather than
       about the listener never being called at all. */
    const wrap = transport.loopCallbacks[0];
    expect(wrap).toBeDefined();
    const stopsBefore = expression.log.stops;
    wrap!();
    expect(passes).toBe(1);
    expect(expression.log.stops).toBe(stopsBefore + 1);

    controller.setLoop({ kind: "none" });
    const stopsAfterDisable = expression.log.stops;

    /* The queued one. Nothing: no cleanup, no listener, no restart. */
    wrap!();
    expect(passes).toBe(1);
    expect(expression.log.stops).toBe(stopsAfterDisable);
  });

  it("ignores a wrap notification once the controller has been disposed", async () => {
    const { controller, transport } = harness();
    await controller.play();
    controller.setLoop({
      kind: "selection",
      bounds: { startTicks: 0, endTicks: 768 },
    });
    let passes = 0;
    controller.onLoopPass(() => {
      passes += 1;
    });

    const wrap = transport.loopCallbacks[0]!;
    controller.dispose();
    wrap();
    expect(passes).toBe(0);
  });

  it("puts the whole song back when a selection loop is shut down", async () => {
    const { controller, transport, expression } = harness();
    await controller.playSelection({
      startTicks: 768,
      endTicks: 1536,
      trackIds: ["gtr"],
      mode: "loop",
      onsetCount: 4,
      sustainCount: 0,
    });
    expect(controller.getSelectionPlayback()).not.toBeNull();
    expect(transport.loop).toBe(true);

    const stopsBefore = expression.log.stops;
    controller.stopSelection();

    /* Synchronously, and all of it: the held run, the loop, the audio, the
       playhead, and the windowed schedule. */
    expect(controller.getSelectionPlayback()).toBeNull();
    expect(controller.getState().loop.kind).toBe("none");
    expect(transport.loop).toBe(false);
    expect(expression.log.stops).toBeGreaterThan(stopsBefore);
    expect(transport.ticks).toBe(768);
    expect(controller.getState().status).toBe("paused");
  });

  it("does nothing at all when a disposed controller is asked to play", async () => {
    const { controller, transport, builds } = harness();
    controller.dispose();

    await controller.play();
    await controller.playSelection({
      startTicks: 0,
      endTicks: 768,
      trackIds: ["gtr"],
      mode: "once",
      onsetCount: 1,
      sustainCount: 0,
    });

    expect(builds()).toBe(0);
    expect(transport.starts).toHaveLength(0);
    /* Above all: not an error the reader would be shown somewhere else. */
    expect(controller.getState().status).not.toBe("error");
    expect(controller.getState().error).toBeNull();
  });

  it("leaves nothing scheduled and no listener behind on dispose", async () => {
    const { controller, transport, expression } = harness();
    await controller.play();
    const stop = controller.onLoopPass(() => {});
    stop();

    controller.dispose();
    expect(transport.stops).toBeGreaterThan(0);
    expect(transport.cancels).toBeGreaterThan(0);
    expect(transport.loop).toBe(false);
    expect(expression.log.disposals).toBe(1);
  });
});

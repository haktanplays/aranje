/**
 * The count-in's lifecycle, where it is easiest to get wrong (2R-A §VIII).
 *
 * The clicks themselves are `lib/practice/count-in.ts` and are tested there.
 * What is tested here is everything that happens *around* them: that the
 * transport waits, that the wait is cancellable, and above all that a
 * cancelled count-in cannot come back later and start playing on its own.
 *
 * A ghost start is the worst failure this feature has, because it happens
 * seconds after the reader stopped and looks like the app deciding to play by
 * itself. Every way out of a count-in is checked separately rather than
 * trusting one of them to cover the others.
 */
import { describe, expect, it } from "vitest";

import type { Engine } from "@/lib/audio/engine";
import { PlaybackController } from "@/lib/audio/playback";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { buildSongPlan } from "@/lib/audio/schedule";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

/** What the count-in actually touches, and nothing more. */
function harness() {
  const clicks: { time: number; velocity: number }[] = [];
  const drawn: { at: number; run: () => void }[] = [];
  const cancelled: string[] = [];
  const transport = {
    ticks: 0,
    seconds: 0,
    PPQ: 192,
    bpm: {
      value: 0,
      setValueAtTime: () => {},
      cancelScheduledValues: () => {},
    },
    loop: false,
    loopStart: "",
    loopEnd: "",
    starts: [] as unknown[],
    stops: 0,
    pauses: 0,
    schedule: () => 0,
    on: () => {},
    start(at?: unknown) {
      transport.starts.push(at ?? "now");
    },
    stop() {
      transport.stops += 1;
    },
    pause() {
      transport.pauses += 1;
    },
    cancel: () => {},
  };

  const engine = {
    context: {
      transport,
      now: () => 100,
      draw: {
        schedule: (run: () => void, at: number) => drawn.push({ at, run }),
      },
    },
    master: {},
    metronome: {
      click: {
        triggerAttackRelease: (_d: number, time: number, velocity: number) =>
          clicks.push({ time, velocity }),
        /*
         * The real click is a `Tone.NoiseSynth`, and the two schedules it
         * keeps have *different* method names: the envelope is cancelled and
         * the noise source is stopped. The first version of this fake gave
         * both a `cancel`, which is why the production code could call a
         * method that does not exist on `Noise` and nothing here noticed.
         */
        envelope: { cancel: () => cancelled.push("envelope") },
        noise: { stop: () => cancelled.push("noise") },
      },
      filter: {},
    },
    voices: new Map(),
    meters: new Map(),
    plan: buildSongPlan(SAMPLE_SONG),
    expression: {
      setPlan: () => {},
      getPlan: () => buildExpressionPlan(SAMPLE_SONG),
      play: () => false,
      playChain: () => false,
      stopAll: () => {},
      counts: { active: 0, started: 0, disposed: 0 },
      fetchedUrls: 0,
      dispose: () => {},
    },
    silentTracks: [],
    expectedBuffers: 0,
    loadedBuffers: 0,
    dispose: () => {},
  } as unknown as Engine;

  const controller = new PlaybackController(SAMPLE_SONG, {
    createEngine: async () => engine,
  });

  return { controller, transport, clicks, drawn, cancelled };
}

describe("273. the transport waits for the count-in, then starts", () => {
  it("starts immediately when the count-in is off", async () => {
    const { controller, transport, clicks } = harness();
    await controller.play();
    expect(controller.getState().error).toBeNull();
    expect(clicks).toHaveLength(0);
    expect(transport.starts).toEqual(["now"]);
    expect(controller.getState().countingIn).toBe(false);
  });

  it("clicks first and schedules the start for after them", async () => {
    const { controller, transport, clicks } = harness();
    controller.setCountIn(2);
    await controller.play();

    // The sample song opens in 4/4, so two bars is eight clicks.
    expect(clicks).toHaveLength(8);
    expect(controller.getState().countingIn).toBe(true);
    // One start, and not for now: `now()` is 100 in this harness.
    expect(transport.starts).toHaveLength(1);
    expect(Number(transport.starts[0])).toBeGreaterThan(100);
  });

  it("marks the downbeats and puts the clicks in order", async () => {
    const { controller, clicks } = harness();
    controller.setCountIn(1);
    await controller.play();
    expect(clicks.map((click) => click.velocity)).toEqual([1, 0.55, 0.55, 0.55]);
    for (let index = 1; index < clicks.length; index += 1) {
      expect(clicks[index]!.time).toBeGreaterThan(clicks[index - 1]!.time);
    }
  });

  it("says it is counting in, which is not the same as playing music", async () => {
    const { controller } = harness();
    controller.setCountIn(1);
    await controller.play();
    const state = controller.getState();
    expect(state.status).toBe("playing");
    expect(state.countingIn).toBe(true);
  });

  it("stops saying so once the music has actually begun", async () => {
    const { controller, drawn } = harness();
    controller.setCountIn(1);
    await controller.play();
    expect(drawn).toHaveLength(1);
    drawn[0]!.run();
    expect(controller.getState().countingIn).toBe(false);
  });
});

describe("274. a cancelled count-in cannot start playing later", () => {
  const ways: readonly [string, (controller: PlaybackController) => void][] = [
    ["pause", (controller) => controller.pause()],
    ["rewind", (controller) => controller.rewind()],
    ["seek", (controller) => controller.seekToBar("intro:0")],
    ["a change of loop", (controller) => controller.setLoopSection("intro")],
    ["dispose", (controller) => controller.dispose()],
  ];

  for (const [name, cancel] of ways) {
    it(`is taken back by ${name}`, async () => {
      const { controller, transport, drawn, cancelled } = harness();
      controller.setCountIn(2);
      await controller.play();
      expect(controller.getState().countingIn).toBe(true);

      cancel(controller);
      expect(controller.getState().countingIn).toBe(false);
      // The transport was told to stop, so the scheduled start cannot happen.
      expect(transport.stops).toBeGreaterThan(0);
      // And the clicks already on the audio clock were cancelled.
      expect(cancelled).toContain("envelope");
      // Both timelines, not one: the envelope's shape and the source's starts.
      expect(cancelled).toContain("noise");
      /*
       * And the screen says so. While the clicks run the status is already
       * "playing" — that is what makes the button read "Duraklat" — so a
       * cancellation that left it there would show a transport claiming to
       * play with nothing coming out of it.
       */
      expect(controller.getState().status).not.toBe("playing");
      expect(cancelled).toContain("noise");

      /*
       * The moment the count-in would have ended, arriving anyway. Nothing
       * may act on it: this is the ghost start the whole mechanism exists to
       * make impossible.
       */
      const startsBefore = transport.starts.length;
      for (const entry of drawn) entry.run();
      expect(transport.starts).toHaveLength(startsBefore);
      expect(controller.getState().countingIn).toBe(false);
    });
  }

  it("does not count a second play as a second count-in", async () => {
    const { controller, clicks, transport } = harness();
    controller.setCountIn(2);
    await controller.play();
    const afterFirst = clicks.length;
    await controller.play();
    expect(clicks).toHaveLength(afterFirst);
    expect(transport.starts).toHaveLength(1);
  });

  it("counts again after a real cancel, because that is a new start", async () => {
    const { controller, clicks } = harness();
    controller.setCountIn(1);
    await controller.play();
    const afterFirst = clicks.length;
    controller.pause();
    await controller.play();
    expect(clicks.length).toBe(afterFirst * 2);
  });
});

describe("275. the count-in leaves no trace in the music", () => {
  it("adds no bar and moves no bar number", async () => {
    const { controller } = harness();
    const before = buildSongPlan(SAMPLE_SONG);
    controller.setCountIn(2);
    await controller.play();
    const after = buildSongPlan(SAMPLE_SONG);
    expect(after.bars).toHaveLength(before.bars.length);
    expect(after.totalTicks).toBe(before.totalTicks);
    expect(after.bars[0]?.barNumber).toBe(before.bars[0]?.barNumber);
  });

  it("never puts the transport at a negative tick", async () => {
    const { controller, transport } = harness();
    controller.setCountIn(2);
    await controller.play();
    expect(transport.ticks).toBeGreaterThanOrEqual(0);
    expect(controller.getTransportTicks()).toBeGreaterThanOrEqual(0);
  });

  it("is not part of what the loop counts", async () => {
    /*
     * The listener fires on the transport's own loop event and on nothing
     * else, so a count-in — which happens before the transport starts — can
     * never be mistaken for a completed pass (§IX).
     */
    const { controller } = harness();
    let passes = 0;
    controller.onLoopPass(() => (passes += 1));
    controller.setCountIn(2);
    await controller.play();
    expect(passes).toBe(0);
  });
});

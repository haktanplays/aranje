/**
 * The transport, and what a practice-speed change does to it (spec 13.8).
 *
 * The engine is injected, so this runs the real controller and the real
 * `scheduleSong` without an audio context. What is being checked is not that
 * Tone works — it is that a speed change touches exactly one thing.
 */
import { describe, expect, it } from "vitest";

import { scheduleSong, type Engine } from "@/lib/audio/engine";
import { PlaybackController } from "@/lib/audio/playback";
import { sectionLoopBounds } from "@/lib/audio/position";
import { effectiveBpm } from "@/lib/audio/practice-rate";
import { buildSongPlan } from "@/lib/audio/schedule";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

type FakeTransport = {
  ticks: number;
  seconds: number;
  PPQ: number;
  bpm: { value: number };
  loop: boolean;
  loopStart: string;
  loopEnd: string;
  scheduled: number[];
  cancels: number;
  starts: number;
  pauses: number;
  schedule(callback: (time: number) => void, time: unknown): number;
  start(): void;
  pause(): void;
  stop(): void;
  cancel(): void;
};

function fakeTransport(): FakeTransport {
  const transport: FakeTransport = {
    ticks: 0,
    seconds: 0,
    PPQ: 192,
    bpm: { value: 0 },
    loop: false,
    loopStart: "",
    loopEnd: "",
    scheduled: [],
    cancels: 0,
    starts: 0,
    pauses: 0,
    schedule() {
      transport.scheduled.push(transport.scheduled.length);
      return transport.scheduled.length;
    },
    start() {
      transport.starts += 1;
    },
    pause() {
      transport.pauses += 1;
    },
    stop() {},
    cancel() {
      transport.cancels += 1;
      transport.scheduled = [];
    },
  };
  return transport;
}

function harness(options: { practicePercent?: number } = {}) {
  const transport = fakeTransport();
  let builds = 0;

  const engine = {
    context: { transport },
    master: {},
    metronome: { click: { triggerAttackRelease: () => {} }, filter: {} },
    voices: new Map(),
    meters: new Map(),
    plan: buildSongPlan(SAMPLE_SONG),
    expectedBuffers: 0,
    loadedBuffers: 0,
    dispose: () => {},
  } as unknown as Engine;

  const controller = new PlaybackController(SAMPLE_SONG, {
    ...(options.practicePercent === undefined
      ? {}
      : { practicePercent: options.practicePercent }),
    createEngine: async () => {
      builds += 1;
      return engine;
    },
  });

  return { controller, transport, engine, builds: () => builds };
}

describe("the two tempos", () => {
  it("starts at the song's own tempo", () => {
    const { controller } = harness();
    const state = controller.getState();
    expect(state.songBpm).toBe(SAMPLE_SONG.bpm);
    expect(state.practicePercent).toBe(100);
    expect(state.bpm).toBe(SAMPLE_SONG.bpm);
  });

  it("runs the transport at the effective tempo, not the song's", async () => {
    const { controller, transport } = harness({ practicePercent: 75 });
    await controller.play();

    expect(transport.bpm.value).toBe(effectiveBpm(SAMPLE_SONG.bpm, 75));
    expect(controller.getState().songBpm).toBe(SAMPLE_SONG.bpm);
  });

  it("never writes the song's own tempo", async () => {
    const before = SAMPLE_SONG.bpm;
    const { controller } = harness();
    await controller.play();
    controller.setPracticePercent(50);
    controller.setPracticePercent(150);

    expect(SAMPLE_SONG.bpm).toBe(before);
    expect(controller.getState().songBpm).toBe(before);
  });

  it("keeps the setting inside the bounds", () => {
    const { controller } = harness();
    controller.setPracticePercent(5);
    expect(controller.getPracticePercent()).toBe(50);
    controller.setPracticePercent(500);
    expect(controller.getPracticePercent()).toBe(150);
  });
});

describe("changing speed while it is playing", () => {
  it("moves the transport's tempo and nothing else", async () => {
    const { controller, transport } = harness();
    await controller.play();

    const scheduledBefore = transport.scheduled.length;
    const cancelsBefore = transport.cancels;
    expect(controller.getState().status).toBe("playing");

    controller.setPracticePercent(60);

    expect(transport.bpm.value).toBe(effectiveBpm(SAMPLE_SONG.bpm, 60));
    expect(transport.scheduled.length).toBe(scheduledBefore);
    expect(transport.cancels).toBe(cancelsBefore);
    expect(transport.pauses).toBe(0);
    expect(controller.getState().status).toBe("playing");
  });

  it("does not build a second engine or reload a sample", async () => {
    const { controller, builds } = harness();
    await controller.play();
    expect(builds()).toBe(1);

    controller.setPracticePercent(60);
    controller.setPracticePercent(120);
    await controller.play();

    expect(builds()).toBe(1);
    expect(controller.getEngineBuilds()).toBe(1);
  });

  it("applies a change made before the engine exists, on the first play", async () => {
    const { controller, transport } = harness();
    controller.setPracticePercent(50);
    await controller.play();
    expect(transport.bpm.value).toBe(effectiveBpm(SAMPLE_SONG.bpm, 50));
  });
});

describe("everything else is in ticks, so it follows for free", () => {
  it("leaves the loop boundaries where they were", async () => {
    const { controller, transport } = harness();
    const sectionId = SAMPLE_SONG.sections[0]?.id ?? "";
    await controller.play();
    controller.setLoopSection(sectionId);

    const bounds = sectionLoopBounds(controller.getPlan(), sectionId);
    const before = { start: transport.loopStart, end: transport.loopEnd };

    controller.setPracticePercent(50);

    expect(transport.loopStart).toBe(before.start);
    expect(transport.loopEnd).toBe(before.end);
    expect(transport.loopStart).toBe(`${bounds?.startTicks}i`);
    expect(controller.getLoopBounds()).toEqual({
      on: true,
      startTicks: bounds?.startTicks,
      endTicks: bounds?.endTicks,
    });
  });

  it("seeks to the same tick whatever the speed is", async () => {
    const barKey = `${SAMPLE_SONG.sections[0]?.id}:1`;
    const { controller, transport } = harness();
    await controller.play();

    controller.seekToBar(barKey);
    const atFullSpeed = transport.ticks;

    controller.setPracticePercent(50);
    controller.seekToBar(barKey);

    expect(transport.ticks).toBe(atFullSpeed);
    expect(atFullSpeed).toBeGreaterThan(0);
  });

  it("reads the playhead off the transport, wherever the transport is", async () => {
    const { controller, transport } = harness();
    await controller.play();
    const plan = controller.getPlan();
    const secondBar = plan.bars[1];
    expect(secondBar).toBeDefined();

    transport.ticks = 0;
    const atStart = controller.getPosition();
    transport.ticks = (secondBar?.time ?? 0) + 1;
    const laterOn = controller.getPosition();

    expect(atStart.barKey).toBe(plan.bars[0]?.barKey);
    expect(laterOn.barKey).toBe(secondBar?.barKey);
    expect(laterOn.barKey).not.toBe(atStart.barKey);
  });

  it("reads the same position whatever the speed is", async () => {
    const { controller, transport } = harness();
    await controller.play();
    transport.ticks = 400;

    const before = controller.getPosition();
    controller.setPracticePercent(50);

    expect(controller.getPosition()).toEqual(before);
    expect(before.barKey).not.toBeNull();
  });

  it("schedules the metronome once, in ticks, and never again", async () => {
    const { controller, transport } = harness();
    await controller.play();

    const scheduled = transport.scheduled.length;
    expect(scheduled).toBeGreaterThan(0);

    controller.setMetronome(true);
    controller.setPracticePercent(75);

    expect(transport.scheduled.length).toBe(scheduled);
    expect(controller.getState().metronome).toBe(true);
  });
});

describe("the scheduler itself", () => {
  it("is given the effective tempo, once", () => {
    const transport = fakeTransport();
    const engine = {
      context: { transport },
      metronome: { click: { triggerAttackRelease: () => {} } },
      voices: new Map(),
      plan: buildSongPlan(SAMPLE_SONG),
    } as unknown as Engine;

    scheduleSong(engine, effectiveBpm(SAMPLE_SONG.bpm, 75));
    expect(transport.bpm.value).toBe(99);
  });
});

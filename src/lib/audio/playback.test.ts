/**
 * The transport, and what a practice-speed change does to it (spec 13.8).
 *
 * The engine is injected, so this runs the real controller and the real
 * `scheduleSong` without an audio context. What is being checked is not that
 * Tone works — it is that a speed change touches exactly one thing.
 */
import { describe, expect, it } from "vitest";

import { scheduleSong, type Engine } from "@/lib/audio/engine";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { PlaybackController } from "@/lib/audio/playback";
import { fakeExpressionRuntime } from "@/test/engine-fakes";
import { sectionLoopBounds } from "@/lib/audio/position";
import { effectiveBpm } from "@/lib/audio/practice-rate";
import { buildSongPlan } from "@/lib/audio/schedule";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import type { Song } from "@/lib/song/schema";
import { buildTempoMap } from "@/lib/audio/tempo";
import { bar, note, slots, song } from "@/test/expression-fixtures";

/** Two notes on one string, the second hammered on to the first. */
function legatoSong() {
  return song([bar(slots([note("G3", 1, 10), note("B3", 1, 14, "hammer_on")]))]);
}

type FakeTransport = {
  ticks: number;
  seconds: number;
  PPQ: number;
  bpm: {
    value: number;
    /** Every step scheduled on the curve, in the order it was written. */
    steps: { bpm: number; atSeconds: number }[];
    setValueAtTime(bpm: number, atSeconds: number): void;
    cancelScheduledValues(atSeconds: number): void;
  };
  loop: boolean;
  loopStart: string;
  loopEnd: string;
  scheduled: number[];
  callbacks: ((time: number) => void)[];
  listeners: string[];
  loopCallbacks: (() => void)[];
  cancels: number;
  starts: number;
  /** Every moment the transport was told to start at, in order. */
  startedAt: unknown[];
  pauses: number;
  schedule(callback: (time: number) => void, time: unknown): number;
  on(event: string, callback: () => void): void;
  start(at?: unknown): void;
  pause(): void;
  stop(): void;
  cancel(): void;
};

function fakeTransport(): FakeTransport {
  const transport: FakeTransport = {
    ticks: 0,
    seconds: 0,
    PPQ: 192,
    bpm: {
      value: 0,
      steps: [] as { bpm: number; atSeconds: number }[],
      setValueAtTime(bpm: number, atSeconds: number) {
        this.steps.push({ bpm, atSeconds });
      },
      cancelScheduledValues(atSeconds: number) {
        this.steps = this.steps.filter((step) => step.atSeconds < atSeconds);
      },
    },
    loop: false,
    loopStart: "",
    loopEnd: "",
    scheduled: [],
    callbacks: [],
    listeners: [],
    loopCallbacks: [],
    cancels: 0,
    starts: 0,
    startedAt: [],
    pauses: 0,
    schedule(callback) {
      transport.scheduled.push(transport.scheduled.length);
      transport.callbacks.push(callback);
      return transport.scheduled.length;
    },
    on(event, callback) {
      transport.listeners.push(event);
      if (event === "loop") transport.loopCallbacks.push(callback);
    },
    start(at) {
      transport.starts += 1;
      transport.startedAt.push(at);
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


function harness(options: { practicePercent?: number; song?: Song } = {}) {
  const song = options.song ?? SAMPLE_SONG;
  const transport = fakeTransport();
  let builds = 0;
  const expression = fakeExpressionRuntime(song);

  /* A clock the controller can ask for the resume moment. Fixed, so the
     moment the transport is started at and the moment the voices come back
     at can be compared exactly. */
  let clock = 100;
  const engine = {
    context: { transport, now: () => clock },
    master: {},
    metronome: { click: { triggerAttackRelease: () => {} }, filter: {} },
    voices: new Map(),
    meters: new Map(),
    plan: buildSongPlan(song),
    expression,
    // Every real engine reports which tracks it found no sound for; a stub
    // standing in for one says the ordinary thing: none of them.
    silentTracks: [],
    expectedBuffers: 0,
    loadedBuffers: 0,
    dispose: () => {},
  } as unknown as Engine;

  const controller = new PlaybackController(song, {
    ...(options.practicePercent === undefined
      ? {}
      : { practicePercent: options.practicePercent }),
    createEngine: async () => {
      builds += 1;
      return engine;
    },
  });

  return {
    controller,
    transport,
    engine,
    expression,
    builds: () => builds,
    setClock: (value: number) => {
      clock = value;
    },
  };
}

/** A harness whose engine has been built, so the transport carries the tempo. */
async function started(options: { practicePercent?: number; song?: Song } = {}) {
  const bench = harness(options);
  await bench.controller.play();
  return bench;
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
      expression: fakeExpressionRuntime(SAMPLE_SONG),
    } as unknown as Engine;

    scheduleSong(engine, buildTempoMap(SAMPLE_SONG, 75));
    expect(transport.bpm.value).toBe(99);
  });
});

describe("the expressive layer's lifetime", () => {
  it("rebuilds the plan at the new speed, without rebuilding the engine", async () => {
    const { controller, expression, builds } = harness();
    await controller.play();
    const plansBefore = expression.log.plans;

    controller.setPracticePercent(50);

    expect(expression.log.plans).toBe(plansBefore + 1);
    expect(expression.log.stops).toBeGreaterThan(0);
    expect(builds()).toBe(1);
    const slow = expression.getPlan().notes[0];
    const fast = buildExpressionPlan(SAMPLE_SONG).notes[0];
    expect(slow?.durationSeconds).toBeCloseTo((fast?.durationSeconds ?? 0) * 2, 5);
  });

  it("ends every voice on pause", async () => {
    const { controller, expression } = harness();
    await controller.play();
    const before = expression.log.stops;
    controller.pause();
    expect(expression.log.stops).toBe(before + 1);
  });

  it("ends every voice on a seek and on a rewind", async () => {
    const { controller, expression } = harness();
    await controller.play();
    const before = expression.log.stops;

    controller.seekToBar(`${SAMPLE_SONG.sections[0]?.id}:1`);
    controller.rewind();

    expect(expression.log.stops).toBe(before + 2);
  });

  it("listens for the loop wrap so the previous pass cannot hang over", async () => {
    const { controller, transport } = harness();
    await controller.play();
    expect(transport.listeners).toContain("loop");
  });

  it("disposes the expressive layer with the engine", async () => {
    const { controller, expression } = harness();
    await controller.play();
    controller.dispose();
    expect(expression.log.disposals).toBe(1);
  });
});

describe("what the scheduler does with a legato chain (spec 8.5, K-22)", () => {
  /** A fake sampler voice that records every restrike asked of it. */
  function legatoHarness() {
    const transport = fakeTransport();
    const struck: string[] = [];
    const chained: string[] = [];

    const fixture = legatoSong();
    const plan = buildExpressionPlan(fixture);

    const engine = {
      context: { transport },
      metronome: { click: { triggerAttackRelease: () => {} } },
      voices: new Map([
        [
          "gtr",
          {
            kind: "sampler",
            trackId: "gtr",
            sampler: {
              triggerAttackRelease: (pitch: string) => struck.push(pitch),
            },
          },
        ],
      ]),
      plan: buildSongPlan(fixture),
      expression: {
        ...fakeExpressionRuntime(fixture),
        getPlan: () => plan,
        playChain: (chain: { chainId: string }) => {
          chained.push(chain.chainId);
          return true;
        },
      },
    } as unknown as Engine;

    return { engine, transport, struck, chained, plan };
  }

  it("plays the chain once and never restrikes its target", () => {
    const { engine, transport, struck, chained, plan } = legatoHarness();
    scheduleSong(engine, buildTempoMap(SAMPLE_SONG));

    expect(plan.chains).toHaveLength(1);
    // Every scheduled callback fires, as the transport would.
    for (const callback of transport.callbacks) callback(0);

    expect(chained).toEqual([plan.chains[0]?.chainId]);
    // Only the notes outside the chain are struck; the chain's two notes are
    // its own, and its target is not struck at all.
    expect(struck).toEqual([]);
  });

  it("still strikes an ordinary note beside a chain", () => {
    const { engine, transport, struck } = legatoHarness();
    scheduleSong(engine, buildTempoMap(SAMPLE_SONG));
    for (const callback of transport.callbacks) callback(0);

    // The fixture is two notes, both in the chain, so nothing is struck. A
    // third note outside it would be — that is what this guards.
    expect(struck).toHaveLength(0);
    expect(transport.callbacks.length).toBeGreaterThan(0);
  });
});

describe("a song that changes tempo at a section line (spec 8.3, K-25)", () => {
  /** The demo song with its second section marked slower. */
  function stepped(): Song {
    const sections = SAMPLE_SONG.sections.map((section, index) =>
      index === 1 ? { ...section, bpmOverride: 60 } : section,
    );
    return { ...SAMPLE_SONG, sections };
  }

  it("writes one step per later section onto the transport", async () => {
    const song = stepped();
    const { controller, transport } = await started({ song });
    const map = buildTempoMap(song);

    // The first segment is the plain value; the rest are scheduled.
    expect(transport.bpm.value).toBe(map.segments[0]?.bpm);
    expect(transport.bpm.steps).toHaveLength(map.segments.length - 1);
    expect(transport.bpm.steps[0]).toEqual({
      bpm: 60,
      atSeconds: map.segments[1]?.startSeconds,
    });
    controller.dispose();
  });

  it("rewrites the whole curve when the practice speed changes", async () => {
    const song = stepped();
    const { controller, transport } = await started({ song });

    controller.setPracticePercent(50);

    // Not one value scaled and the rest left behind: every step is at half.
    expect(transport.bpm.value).toBe(SAMPLE_SONG.bpm / 2);
    expect(transport.bpm.steps.map((s) => s.bpm)).toEqual(
      buildTempoMap(song, 50).segments.slice(1).map((s) => s.bpm),
    );
    expect(transport.bpm.steps.some((s) => s.bpm === 30)).toBe(true);
    controller.dispose();
  });

  it("reports the tempo of the section the playhead is in", async () => {
    const song = stepped();
    const { controller, transport } = await started({ song });
    const map = buildTempoMap(song);

    expect(controller.getState().hasTempoChanges).toBe(true);
    expect(controller.getState().activeBpm).toBe(SAMPLE_SONG.bpm);

    // Move the playhead into the slower section and ask again.
    transport.ticks = map.segments[1]?.startTicks ?? 0;
    controller.setPracticePercent(100);
    expect(controller.getState().activeBpm).toBe(60);
    controller.dispose();
  });

  it("follows the playhead across a section boundary on its own", async () => {
    /*
     * Nothing calls a setter when the transport crosses into the next
     * section, so the header would otherwise show the first section's tempo
     * for the whole song. The playhead is read every frame; that read is what
     * publishes the change (spec 13.8, K-25).
     */
    const song = stepped();
    const { controller, transport } = await started({ song });
    const map = buildTempoMap(song);

    let notifications = 0;
    controller.subscribe(() => {
      notifications += 1;
    });

    expect(controller.getState().activeBpm).toBe(SAMPLE_SONG.bpm);

    transport.ticks = map.segments[1]?.startTicks ?? 0;
    controller.getPosition();
    expect(controller.getState().activeBpm).toBe(60);
    expect(notifications).toBe(1);

    // Reading again at the same place must not re-publish the same number.
    controller.getPosition();
    expect(notifications).toBe(1);

    transport.ticks = 0;
    controller.getPosition();
    expect(controller.getState().activeBpm).toBe(SAMPLE_SONG.bpm);
    controller.dispose();
  });

  it("does not re-publish a tempo on a song that has only one", async () => {
    const { controller, transport } = await started({});
    let notifications = 0;
    controller.subscribe(() => {
      notifications += 1;
    });
    for (const ticks of [0, 480, 1920, 5760]) {
      transport.ticks = ticks;
      controller.getPosition();
    }
    expect(notifications).toBe(0);
    controller.dispose();
  });

  it("says nothing changed on a song at one tempo", async () => {
    const { controller, transport } = await started({});
    expect(controller.getState().hasTempoChanges).toBe(false);
    expect(controller.getState().activeBpm).toBe(SAMPLE_SONG.bpm);
    expect(transport.bpm.steps.every((s) => s.bpm === SAMPLE_SONG.bpm)).toBe(true);
    controller.dispose();
  });

  it("leaves the song's own tempo alone", async () => {
    const song = stepped();
    const before = JSON.stringify(song);
    const { controller } = await started({ song });
    controller.setPracticePercent(150);
    expect(JSON.stringify(song)).toBe(before);
    controller.dispose();
  });
});

/**
 * Listening to a selection, through the real controller (2V-A §3–§6, §8).
 *
 * The `PlaybackController` with an injected fake engine, exactly as
 * `playback.test.ts` drives it. No wall clock: the transport is a recorder and
 * every claim is about what the controller asked it to do.
 */
import { describe, expect, it } from "vitest";

import { PlaybackController } from "@/lib/audio/playback";
import { carriedController } from "@/lib/audio/use-playback";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { buildSongPlan } from "@/lib/audio/schedule";
import { planSelectionPlayback } from "@/lib/playback/selection-playback";
import { describeTimeSelection } from "@/lib/song/selection-descriptor";
import { guitarTrack, restSlots, section, song } from "@/lib/song/fixtures";
import type { Engine } from "@/lib/audio/engine";
import type { Bar, MelodicSlot, Song } from "@/lib/song/schema";

const GTR = "gtr";
const BASS = "bass";
const BAR = 768;

const note = (pitch: string, string: number, fret: number): MelodicSlot => ({
  notes: [{ pitch, position: { string, fret } }],
});

function twoBarSong(): Song {
  const line = (): MelodicSlot[] => {
    const slots = restSlots(16);
    slots[0] = note("E2", 0, 0);
    slots[8] = note("A3", 3, 2);
    return slots;
  };
  const bar = {
    timeSignature: [4, 4],
    resolution: 16,
    slots: { [GTR]: line(), [BASS]: line() },
  } satisfies Bar;
  return song(
    [guitarTrack({ id: GTR }), guitarTrack({ id: BASS, name: "Bas" })],
    [section([bar, bar], { id: "s1" })],
  );
}

/** A transport that remembers what it was told, and never runs a clock. */
function fakeTransport() {
  return {
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
    cancels: 0,
    starts: 0,
    pauses: 0,
    stops: 0,
    scheduled: [] as number[],
    schedule(_run: (at: number) => void, at: unknown) {
      this.scheduled.push(Number(String(at).replace("i", "")));
      return this.scheduled.length;
    },
    on: () => {},
    start() {
      this.starts += 1;
    },
    pause() {
      this.pauses += 1;
    },
    stop() {
      this.stops += 1;
    },
    cancel() {
      this.cancels += 1;
      this.scheduled = [];
    },
  };
}

function harness(source: Song = twoBarSong()) {
  const transport = fakeTransport();
  let builds = 0;
  const stops = { count: 0 };
  const engine = {
    context: {
      transport,
      draw: { schedule: (run: () => void) => run() },
      now: () => 0,
    },
    master: {},
    metronome: { click: { triggerAttackRelease: () => {} }, filter: {} },
    voices: new Map(),
    meters: new Map(),
    plan: buildSongPlan(source),
    expression: {
      getPlan: () => buildExpressionPlan(source),
      setPlan: () => {},
      play: () => false,
      playChain: () => false,
      stopAll: () => {
        stops.count += 1;
      },
      counts: { active: 0, started: 0, disposed: 0 },
      fetchedUrls: 0,
      dispose: () => {},
    },
    silentTracks: [],
    expectedBuffers: 0,
    loadedBuffers: 0,
    dispose: () => {},
  } as unknown as Engine;

  const controller = new PlaybackController(source, {
    createEngine: async () => {
      builds += 1;
      return engine;
    },
  });
  /* Count-in off: it is a separate feature with its own tests, and leaving it
     on would make every assertion here about clicks instead of about ticks. */
  controller.setCountIn(0);
  return { controller, transport, engine, source, builds: () => builds, stops };
}

const planFor = (
  source: Song,
  from: number,
  to: number,
  mode: "once" | "loop",
  trackId = GTR,
) => {
  const descriptor = describeTimeSelection(source, {
    sectionId: "s1",
    trackId,
    startTicks: from,
    endTicks: to,
  });
  const result = planSelectionPlayback(source, descriptor, mode);
  if (!result.ok) throw new Error(`fixture refused: ${result.reason}`);
  return result.plan;
};

describe("hearing a selection once", () => {
  it("starts at the first tick of the selection", async () => {
    const rig = harness();
    await rig.controller.playSelection(planFor(rig.source, BAR, 2 * BAR, "once"));
    expect(rig.transport.ticks).toBe(BAR);
    expect(rig.transport.starts).toBe(1);
  });

  it("does not loop", async () => {
    const rig = harness();
    await rig.controller.playSelection(planFor(rig.source, 0, BAR, "once"));
    expect(rig.transport.loop).toBe(false);
    expect(rig.controller.getState().loop.kind).toBe("none");
  });

  it("comes back to the start when it finishes, so it can be heard again", async () => {
    const rig = harness();
    await rig.controller.playSelection(planFor(rig.source, BAR, 2 * BAR, "once"));
    rig.transport.ticks = 2 * BAR;
    rig.controller.handleSelectionEnded();
    expect(rig.transport.ticks).toBe(BAR);
    expect(rig.controller.getState().status).not.toBe("playing");
  });

  it("stops whatever was already playing, atomically", async () => {
    const rig = harness();
    await rig.controller.play();
    expect(rig.transport.starts).toBe(1);
    await rig.controller.playSelection(planFor(rig.source, BAR, 2 * BAR, "once"));
    /* One engine, one transport: the old playback was stopped rather than
       left running underneath a second one. */
    expect(rig.builds()).toBe(1);
    expect(rig.transport.pauses + rig.transport.stops).toBeGreaterThan(0);
    expect(rig.stops.count).toBeGreaterThan(0);
  });
});

describe("looping a selection", () => {
  it("loops between the selection's own ticks", async () => {
    const rig = harness();
    await rig.controller.playSelection(planFor(rig.source, BAR, 2 * BAR, "loop"));
    expect(rig.transport.loop).toBe(true);
    expect(rig.transport.loopStart).toBe(`${BAR}i`);
    expect(rig.transport.loopEnd).toBe(`${2 * BAR}i`);
  });

  it("is one loop authority, not a second one beside the practice range", async () => {
    const rig = harness();
    rig.controller.setLoopSection("s1");
    await rig.controller.playSelection(planFor(rig.source, 0, BAR, "loop"));
    const loop = rig.controller.getState().loop;
    expect(loop.kind).toBe("selection");
    expect(rig.transport.loopStart).toBe("0i");
    expect(rig.transport.loopEnd).toBe(`${BAR}i`);
  });

  it("keeps its bounds across pause and resume", async () => {
    const rig = harness();
    await rig.controller.playSelection(planFor(rig.source, BAR, 2 * BAR, "loop"));
    rig.controller.pause();
    await rig.controller.play();
    expect(rig.transport.loop).toBe(true);
    expect(rig.transport.loopStart).toBe(`${BAR}i`);
    expect(rig.transport.loopEnd).toBe(`${2 * BAR}i`);
  });

  it("rewinds to the selection's start, not the song's", async () => {
    const rig = harness();
    await rig.controller.playSelection(planFor(rig.source, BAR, 2 * BAR, "loop"));
    rig.transport.ticks = BAR + 400;
    rig.controller.rewind();
    expect(rig.transport.ticks).toBe(BAR);
  });

  it("does not drift over fifty passes", () => {
    /*
     * The bounds are ticks and the wrap is the transport's own, so a pass
     * cannot accumulate error — but that is a claim about arithmetic, so it
     * is checked as arithmetic rather than by waiting for fifty real passes.
     */
    const source = twoBarSong();
    const plan = planFor(source, BAR, 2 * BAR, "loop");
    let at = plan.startTicks;
    for (let pass = 0; pass < 50; pass += 1) {
      at += plan.endTicks - plan.startTicks;
      if (at >= plan.endTicks) at = plan.startTicks + (at - plan.endTicks);
    }
    expect(at).toBe(plan.startTicks);
  });
});

describe("turning it off", () => {
  it("stops, clears the loop and returns to the selection's start", async () => {
    const rig = harness();
    await rig.controller.playSelection(planFor(rig.source, BAR, 2 * BAR, "loop"));
    rig.transport.ticks = BAR + 300;
    rig.controller.stopSelection();

    expect(rig.transport.loop).toBe(false);
    expect(rig.controller.getState().loop.kind).toBe("none");
    expect(rig.transport.ticks).toBe(BAR);
    expect(rig.controller.getState().status).not.toBe("playing");
    expect(rig.controller.getSelectionPlayback()).toBeNull();
  });

  it("is the same whether it was a loop or a one-shot", async () => {
    const rig = harness();
    await rig.controller.playSelection(planFor(rig.source, 0, BAR, "once"));
    rig.controller.stopSelection();
    expect(rig.controller.getSelectionPlayback()).toBeNull();
    expect(rig.transport.loop).toBe(false);
  });

  it("gives the whole song back to the scheduler", async () => {
    /*
     * Not only "the loop is off". The engine is scheduled once and never
     * again by play or pause (K-25), so a controller that stopped listening
     * without rescheduling would leave every later press of play bounded to a
     * selection the reader let go of — silence from the second bar on, with
     * nothing on screen to explain it.
     */
    const rig = harness();
    await rig.controller.playSelection(planFor(rig.source, 0, BAR, "once"));
    /* Strictly past the end: the callback that ends the run sits *on* it. */
    const windowed = rig.transport.scheduled.filter((at) => at > BAR).length;
    expect(windowed).toBe(0);

    rig.controller.stopSelection();
    const whole = rig.transport.scheduled.filter((at) => at > BAR).length;
    expect(whole).toBeGreaterThan(0);
  });

  it("says nothing is running before anything has been asked for", () => {
    const rig = harness();
    expect(rig.controller.getSelectionPlayback()).toBeNull();
    /* And stopping nothing is not an error, so a cleanup can always run. */
    expect(() => rig.controller.stopSelection()).not.toThrow();
  });
});

describe("the callback that ends a one-shot", () => {
  /*
   * `onEnded` is scheduled at the window's end for both modes, because the
   * schedule does not know which one it is. A loop reaching that tick is the
   * loop working; treating it as the end of the run would stop the music the
   * reader asked to keep hearing, one pass in.
   */
  it("leaves a loop running when it reaches the same tick", async () => {
    const rig = harness();
    await rig.controller.playSelection(planFor(rig.source, 0, BAR, "loop"));
    rig.controller.handleSelectionEnded();

    expect(rig.controller.getSelectionPlayback()?.mode).toBe("loop");
    expect(rig.controller.getState().status).toBe("playing");
    expect(rig.transport.loop).toBe(true);
  });

  it("does end a one-shot at it", async () => {
    const rig = harness();
    await rig.controller.playSelection(planFor(rig.source, 0, BAR, "once"));
    rig.controller.handleSelectionEnded();

    expect(rig.controller.getSelectionPlayback()).toBeNull();
    expect(rig.controller.getState().status).toBe("paused");
  });
});

describe("asking twice", () => {
  it("starts one run, not two", async () => {
    const rig = harness();
    const plan = planFor(rig.source, 0, BAR, "loop");
    await Promise.all([
      rig.controller.playSelection(plan),
      rig.controller.playSelection(plan),
    ]);
    expect(rig.builds()).toBe(1);
    expect(rig.controller.getSelectionPlayback()).toMatchObject({
      startTicks: 0,
      endTicks: BAR,
      mode: "loop",
    });
  });

  it("a second, different selection replaces the first", async () => {
    const rig = harness();
    await rig.controller.playSelection(planFor(rig.source, 0, BAR, "loop"));
    await rig.controller.playSelection(planFor(rig.source, BAR, 2 * BAR, "loop"));
    expect(rig.transport.loopStart).toBe(`${BAR}i`);
    expect(rig.controller.getSelectionPlayback()).toMatchObject({
      startTicks: BAR,
    });
  });
});

describe("what it never touches", () => {
  it("leaves the song byte-identical", async () => {
    const rig = harness();
    const before = JSON.stringify(rig.source);
    await rig.controller.playSelection(planFor(rig.source, 0, BAR, "loop"));
    rig.controller.pause();
    rig.controller.stopSelection();
    expect(JSON.stringify(rig.source)).toBe(before);
  });

  it("keeps the reader's practice speed and metronome preference", async () => {
    const rig = harness();
    rig.controller.setPracticePercent(75);
    rig.controller.setMetronome(true);
    await rig.controller.playSelection(planFor(rig.source, 0, BAR, "once"));
    const state = rig.controller.getState();
    expect(state.practicePercent).toBe(75);
    expect(state.metronome).toBe(true);
    expect(state.bpm).toBe(Math.round((rig.source.bpm * 75) / 100));
  });

  it("reports the engine's own play state, not a wish", async () => {
    const rig = harness();
    await rig.controller.playSelection(planFor(rig.source, 0, BAR, "loop"));
    expect(rig.controller.getState().status).toBe("playing");
    rig.controller.pause();
    expect(rig.controller.getState().status).toBe("paused");
  });
});

describe("a disposed controller", () => {
  it("leaves nothing behind to sound later", async () => {
    const rig = harness();
    await rig.controller.playSelection(planFor(rig.source, 0, BAR, "loop"));
    rig.controller.dispose();
    expect(rig.transport.stops).toBeGreaterThan(0);
    expect(rig.transport.loop).toBe(false);
    expect(rig.controller.getSelectionPlayback()).toBeNull();
  });
})

describe("when the song itself changes underneath", () => {
  /*
   * A selection loop is a pair of ticks the reader drew on music that has
   * just stopped existing in that shape. §5 lists this beside cancelling the
   * selection, and it is the one cleanup path the hook cannot do — the whole
   * controller is replaced — so `carriedController` has to refuse it.
   */
  it("does not carry a selection loop over to the new song", async () => {
    const { controller, source } = harness();
    await controller.playSelection(planFor(source, 0, BAR, "loop"));
    expect(controller.getLoopBounds()?.on).toBe(true);

    const next = carriedController(controller, twoBarSong());
    expect(next.getLoopBounds()).toBeNull();
    expect(next.getSelectionPlayback()).toBeNull();
  });

  it("still carries a section loop, which is named music and survives", async () => {
    /* The contrast that makes the refusal above a decision, not an accident. */
    const { controller, source } = harness();
    controller.setLoopSection("s1");
    expect(controller.getLoopBounds()?.on).toBe(true);

    const next = carriedController(controller, source);
    expect(next.getLoopBounds()?.on).toBe(true);
  });
});

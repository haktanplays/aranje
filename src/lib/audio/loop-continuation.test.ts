/**
 * The chord that is heard on the first pass and never again (2V-B.3 §1-§6).
 *
 * ## What the founder did, and what they heard
 *
 * The test song opens on a held power chord. They put the start of the
 * selection *inside* it — after the strike, while it is still ringing —
 * reached the selection to the note after it, and looped the result.
 *
 * On the first pass they heard what they asked for: the tail of the power
 * chord, then the next note. On the second pass and every one after it the
 * chord tail was gone; only the next note remained.
 *
 * ## Why it happened
 *
 * Two different mechanisms carry the two halves of a selection, and only one
 * of them repeats.
 *
 * - Onsets *inside* the window are placed on the transport by `scheduleSong`.
 *   The transport owns the loop, so they re-fire on every wrap for free.
 * - The note that began *before* the window is not a transport event at all.
 *   It is a continuation, produced by `activeVoicesAt` and handed to
 *   `expression.resumeAt` once, against the audio clock, at the moment the
 *   selection starts.
 *
 * The wrap handler then calls `stopAll()` — correctly, so the previous pass
 * does not ring over the new one — and schedules nothing to replace it. The
 * continuation is a one-shot, so it happens exactly once and the second pass
 * is missing a voice the first pass had.
 *
 * These tests hold the fix: a wrap runs the *same* iteration plan the first
 * entry ran, so pass one and pass four contain the same voices.
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
    createEngine: async () => engine,
  });

  return {
    controller,
    transport,
    expression,
    /** Fire one loop wrap, the way the transport delivers it. */
    wrap(at: number) {
      clock = at;
      for (const callback of transport.loopCallbacks) callback();
    },
  };
}

/** A selection that opens inside a ringing note, looped. */
const MID_NOTE = {
  startTicks: 96,
  endTicks: 768,
  trackIds: ["gtr"],
  mode: "loop" as const,
  onsetCount: 3,
  /* The whole point: something was already sounding when the window opened. */
  sustainCount: 2,
};

describe("a looped selection that opens inside a ringing note", () => {
  it("continues the ringing note on the first pass", async () => {
    const { controller, expression } = harness();
    await controller.playSelection(MID_NOTE);
    expect(expression.log.resumes).toHaveLength(1);
    expect(expression.log.resumes[0]?.ticks).toBe(96);
  });

  it("continues it again on every wrap, not only the first time", async () => {
    /*
     * The defect, stated as a number: before the fix this was 1, because the
     * continuation was a one-shot on the audio clock and the wrap replaced it
     * with nothing.
     */
    const { controller, expression, wrap } = harness();
    await controller.playSelection(MID_NOTE);
    wrap(20);
    wrap(30);
    wrap(40);
    expect(expression.log.resumes).toHaveLength(4);
  });

  it("asks for the same tick and the same window on every pass", async () => {
    const { controller, expression, wrap } = harness();
    await controller.playSelection(MID_NOTE);
    wrap(20);
    wrap(30);
    wrap(40);
    const first = expression.log.resumes[0];
    for (const resume of expression.log.resumes) {
      expect(resume.ticks).toBe(first?.ticks);
      expect(resume.window).toEqual(first?.window);
    }
  });

  it("continues at the moment the wrap happened, not at the first start", async () => {
    /* A continuation placed at the original start time would either be in the
       past or would stack every pass on top of one moment. */
    const { controller, expression, wrap } = harness();
    await controller.playSelection(MID_NOTE);
    wrap(20);
    wrap(30);
    expect(expression.log.resumes.map((entry) => entry.audioTime)).toEqual([10, 20, 30]);
  });

  it("silences the previous pass before continuing the new one", async () => {
    /* Order matters: continuing first and stopping afterwards would cut off
       the voice that was just created. */
    const { controller, expression, wrap } = harness();
    await controller.playSelection(MID_NOTE);
    const before = expression.log.stops;
    wrap(20);
    expect(expression.log.stops).toBeGreaterThan(before);
    expect(expression.log.resumes).toHaveLength(2);
  });
});

describe("what a wrap must not do", () => {
  it("continues nothing when the selection has nothing sustaining", async () => {
    /*
     * A selection that starts on an onset has no tail to carry. Resuming
     * there would ask `activeVoicesAt` for voices it correctly refuses to
     * produce, and on a boundary onset it would be a second attack.
     */
    const { controller, expression, wrap } = harness();
    await controller.playSelection({ ...MID_NOTE, startTicks: 0, sustainCount: 0 });
    wrap(20);
    wrap(30);
    expect(expression.log.resumes).toHaveLength(0);
  });

  it("continues nothing after the reader turns the loop off", async () => {
    const { controller, expression, transport, wrap } = harness();
    await controller.playSelection(MID_NOTE);
    controller.setLoop({ kind: "none" });
    transport.loop = false;
    wrap(20);
    expect(expression.log.resumes).toHaveLength(1);
  });

  it("continues nothing after the selection is stopped", async () => {
    const { controller, expression, wrap } = harness();
    await controller.playSelection(MID_NOTE);
    controller.stopSelection();
    wrap(20);
    expect(expression.log.resumes).toHaveLength(1);
  });

  it("does not reschedule the song to achieve any of it", async () => {
    /* The transport's own events already repeat; rebuilding them per wrap
       would be a second scheduler and would change the timing. */
    const { controller, transport, wrap } = harness();
    await controller.playSelection(MID_NOTE);
    const cancels = transport.cancels;
    wrap(20);
    wrap(30);
    expect(transport.cancels).toBe(cancels);
  });

  it("leaves whole-song looping alone", async () => {
    const { controller, expression, wrap } = harness();
    await controller.play();
    controller.setLoopSection(SAMPLE_SONG.sections[0]?.id ?? null);
    wrap(20);
    /* No selection, so no window and nothing to continue into. */
    expect(expression.log.resumes).toHaveLength(0);
  });
});

/**
 * Twenty-five auditions, one download (2O-B.1 §3).
 *
 * The measurement that started this: pressing through chord variations
 * issued 168 sample requests for seven files, because each audition built an
 * engine, played one chord and disposed it, and the bank went with it.
 *
 * Tone is faked; what is checked is the thing the browser measurement also
 * checks — how many times the pack was constructed — but here on the exact
 * production path an audition takes: PreviewEngine → PlaybackController →
 * engine → shared bank.
 */
import { describe, expect, it } from "vitest";

import { acquireBank, banksHeld } from "@/lib/audio/buffer-bank";
import { PlaybackController } from "@/lib/audio/playback";
import { PreviewBankSession } from "@/lib/audio/preview-bank";
import type { Engine } from "@/lib/audio/engine";
import type { SamplePack } from "@/lib/audio/packs";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { buildSongPlan } from "@/lib/audio/schedule";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

const PACK: SamplePack = {
  id: "electric_guitar/high_gain",
  baseUrl: "/samples/electric_guitar/high_gain/",
  urls: Object.fromEntries(
    ["E2", "A2", "C3", "E3", "A3", "C4", "E4"].map((note) => [note, `${note}.mp3`]),
  ),
  bytes: 0,
  bankKey: "/samples/electric_guitar/high_gain/#A2=A2.mp3,A3=A3.mp3",
  trimDb: 14,
};

/** Counts constructions, which is what a fetch-and-decode costs. */
function fakeTone() {
  const built: { disposed: number }[] = [];
  const tone = {
    ToneAudioBuffers: class {
      disposed = 0;
      constructor(options: { onload: () => void }) {
        built.push(this);
        options.onload();
      }
      dispose() {
        this.disposed += 1;
      }
    },
  } as unknown as typeof import("tone");
  return { tone, built };
}

/** Enough of a transport for the real `scheduleSong` to run against. */
function fakeTransport() {
  const transport = {
    ticks: 0,
    seconds: 0,
    PPQ: 192,
    bpm: {
      value: 0,
      steps: [] as { bpm: number; atSeconds: number }[],
      setValueAtTime(bpm: number, atSeconds: number) {
        transport.bpm.steps.push({ bpm, atSeconds });
      },
      cancelScheduledValues(atSeconds: number) {
        transport.bpm.steps = transport.bpm.steps.filter((s) => s.atSeconds < atSeconds);
      },
    },
    loop: false,
    loopStart: "",
    loopEnd: "",
    scheduled: 0,
    schedule() {
      transport.scheduled += 1;
      return transport.scheduled;
    },
    on() {},
    start() {},
    pause() {},
    stop() {},
    cancel() {},
  };
  return transport;
}

/** The expressive layer, without any audio in it. */
function fakeExpression() {
  let plan = buildExpressionPlan(SAMPLE_SONG);
  return {
    setPlan: (next: typeof plan) => {
      plan = next;
    },
    getPlan: () => plan,
    play: () => false,
    playChain: () => false,
    stopAll: () => {},
    counts: { active: 0, started: 0, disposed: 0 },
    fetchedUrls: 7,
    dispose: () => {},
  };
}

/**
 * One audition, end to end: a controller is built, it plays, it is disposed.
 *
 * The real chord audition drives this through `PreviewEngine`, which starts
 * the playback without waiting for it — right for a screen, useless for a
 * measurement. The controller is driven directly here so each audition is
 * finished before the next begins, and what is counted is exactly what an
 * audition costs.
 */
function auditionBench() {
  const { tone, built } = fakeTone();
  const context = { transport: fakeTransport() } as unknown as Engine["context"];
  const bankSession = new PreviewBankSession();
  let engines = 0;

  const controllerFor = (): PlaybackController =>
    new PlaybackController(SAMPLE_SONG, {
      bankSession,
      createEngine: async () => {
        engines += 1;
        const bank = acquireBank(tone, context, PACK, () => {});
        await bank.loaded;
        return {
          context,
          silentTracks: [],
          master: {},
          metronome: { click: { triggerAttackRelease: () => {} }, filter: {} },
          voices: new Map(),
          meters: new Map(),
          plan: buildSongPlan(SAMPLE_SONG),
          expression: fakeExpression(),
          expectedBuffers: 7,
          loadedBuffers: 7,
          dispose: () => bank.release(),
        } as unknown as Engine;
      },
    });

  let current: PlaybackController | null = null;

  /** What pressing a voicing card does: stop the last one, play the next. */
  const audition = async () => {
    current?.dispose();
    current = controllerFor();
    await current.play();
  };

  /** What closing the sheet does. */
  const stop = () => {
    current?.dispose();
    current = null;
  };

  return { audition, stop, bankSession, built, context, engines: () => engines };
}

describe("175. an audition does not download the pack again", () => {
  it("decodes once across twenty-five auditions", async () => {
    const bench = auditionBench();
    for (let i = 0; i < 25; i += 1) await bench.audition();

    expect(bench.engines()).toBe(25);
    // Twenty-five engines, one bank: the structural target of §3.
    expect(bench.built).toHaveLength(1);
    expect(bench.built[0]?.disposed).toBe(0);
    expect(bench.bankSession.retained()).toBe(1);
  });

  it("keeps the bank when the sheet closes and lets it go when the screen does", async () => {
    const bench = auditionBench();
    await bench.audition();
    await bench.audition();

    // Closing the sheet: the chord stops, the recordings stay.
    bench.stop();
    expect(bench.built[0]?.disposed).toBe(0);
    expect(bench.bankSession.retained()).toBe(1);
    expect(banksHeld(bench.context)).toBe(1);

    await bench.audition();
    expect(bench.built).toHaveLength(1);

    // Leaving the screen: engine first, then the session.
    bench.stop();
    bench.bankSession.dispose();
    expect(bench.built[0]?.disposed).toBe(1);
    expect(banksHeld(bench.context)).toBe(0);
  });

  it("opens retention on the one context its engines were built on", async () => {
    const bench = auditionBench();
    await bench.audition();
    await bench.audition();
    expect(bench.bankSession.contexts).toBe(1);
    bench.bankSession.dispose();
    expect(bench.bankSession.contexts).toBe(0);
  });

  it("is inert once disposed, so a late engine cannot revive it", async () => {
    const bench = auditionBench();
    await bench.audition();
    bench.stop();
    bench.bankSession.dispose();

    await bench.audition();
    bench.stop();
    // Nothing was retained after the session ended: the second bank was
    // built and torn down like any unretained one.
    expect(bench.bankSession.retained()).toBe(0);
    expect(bench.bankSession.contexts).toBe(0);
    expect(bench.built).toHaveLength(2);
    expect(bench.built[1]?.disposed).toBe(1);
  });
});

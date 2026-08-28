/**
 * The five figures, rendered through the production engine (2T-C §10).
 *
 * Evaluation only, and deliberately thin: there are no candidates here and
 * no plan surgery. Every render goes through `createEngine` and
 * `scheduleSong` exactly as the app does, on an offline context, so what is
 * measured is what ships. A hand-built comparison would prove something
 * about the harness rather than about the product.
 */
import {
  attackRatioAt,
  centsTrack,
  energyWindows,
  spectralCentroid,
  trackPitch,
} from "../expression-benchmark/analysis";
import { FIXTURES, type Fixture } from "./fixtures";

import { createEngine, loadTone, scheduleSong, type Engine } from "@/lib/audio/engine";
import { buildTempoMap } from "@/lib/audio/tempo";
import { audioExportLimits } from "@/lib/limits";
import { encodeWav } from "@/lib/export/wav-encoder";
import { pitchToMidi } from "@/lib/music/pitch";
import type { Song } from "@/lib/song/schema";

const RATE = audioExportLimits.sampleRate;
const round = (value: number): number => Math.round(value * 1e6) / 1e6;

const hzOf = (pitch: string): number => {
  const midi = pitchToMidi(pitch);
  if (midi === null) throw new Error(`no midi for ${pitch}`);
  return 440 * 2 ** ((midi - 69) / 12);
};

type Rendered = {
  channels: Float32Array[];
  mono: Float32Array;
  seconds: number;
  logicalVoices: number;
  physicalSources: number;
  activeAfterDispose: number;
};

async function render(song: Song): Promise<Rendered> {
  const tone = await loadTone();
  const seconds = buildTempoMap(song).totalSeconds + 2.5;

  let built: Engine | null = null;
  let samplerOnsets = 0;

  const buffer = (await (
    tone as unknown as {
      Offline: (
        build: (context: unknown) => Promise<void>,
        seconds: number,
        channels: number,
        rate: number,
      ) => Promise<{ toArray(): Float32Array | Float32Array[] }>;
    }
  ).Offline(
    async (context) => {
      const engine = await createEngine(song, context as never);
      built = engine;
      const plan = engine.expression.getPlan();
      samplerOnsets = plan.notes.filter(
        (entry) => entry.chainId === undefined && !entry.expressive,
      ).length;
      scheduleSong(engine, buildTempoMap(song), { metronomeEnabled: () => false });
      (context as { transport: { start(at: number): void } }).transport.start(0);
    },
    seconds,
    audioExportLimits.channels,
    RATE,
  )) as { toArray(): Float32Array | Float32Array[] };

  const raw = buffer.toArray();
  const planar = Array.isArray(raw) ? raw : [raw];
  const channels = planar.length >= 2 ? planar.slice(0, 2) : [planar[0]!, planar[0]!];

  const engine = built as Engine | null;
  let logicalVoices = 0;
  let physicalSources = 0;
  let activeAfterDispose = -1;
  if (engine) {
    /*
     * A logical voice is a note a listener would say they heard; a physical
     * source is a buffer that actually played. A legato pair is two notes
     * and one source, and that difference is exactly what this checkpoint is
     * measuring, so the two are counted apart.
     */
    logicalVoices = engine.expression.counts.primary + samplerOnsets;
    physicalSources = engine.expression.counts.started + samplerOnsets;
    engine.expression.stopAll();
    engine.dispose();
    activeAfterDispose = engine.expression.counts.active;
  }

  const frames = channels[0]!.length;
  const mono = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1) {
    mono[index] = ((channels[0]![index] ?? 0) + (channels[1]![index] ?? 0)) / 2;
  }

  return {
    channels,
    mono,
    seconds: frames / RATE,
    logicalVoices,
    physicalSources,
    activeAfterDispose,
  };
}

/** Peak, RMS and how many samples came out at or past full scale. */
function levels(samples: Float32Array): {
  peak: number;
  peakDbfs: number;
  rms: number;
  rmsDbfs: number;
  clippedSamples: number;
} {
  let peak = 0;
  let sum = 0;
  let clipped = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index]!;
    const magnitude = Math.abs(value);
    if (magnitude >= 1) clipped += 1;
    peak = Math.max(peak, magnitude);
    sum += value * value;
  }
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  const db = (value: number) => (value > 0 ? round(20 * Math.log10(value)) : -Infinity);
  return {
    peak: round(peak),
    peakDbfs: db(peak),
    rms: round(rms),
    rmsDbfs: db(rms),
    clippedSamples: clipped,
  };
}

/**
 * How many separate attacks there are in the file.
 *
 * A rise in short-window energy that is both large in ratio and large in
 * absolute terms, with a hold-off after it so one attack is not counted
 * twice as it decays unevenly. This is the number that says "a listener
 * hears two picks here and one pick there" — the whole difference between a
 * picked pair and a legato one.
 */
function onsets(
  samples: Float32Array,
  sampleRate: number,
): readonly { timeSeconds: number; ratio: number; peak: number }[] {
  const windows = energyWindows(samples, sampleRate, 5);
  const loudest = windows.reduce((most, window) => Math.max(most, window.rms), 0);
  const found: { timeSeconds: number; ratio: number; peak: number }[] = [];
  let holdOff = -1;

  for (let index = 1; index < windows.length; index += 1) {
    if (index <= holdOff) continue;
    const before = windows[index - 1]!;
    const now = windows[index]!;
    const ratio = before.rms > 0 ? now.rms / before.rms : now.rms > 0 ? Infinity : 0;
    /* Loud enough to be an event, and a real rise rather than a ripple. */
    if (now.rms < loudest * 0.08) continue;
    if (ratio < 1.6) continue;
    found.push({
      timeSeconds: round(now.timeSeconds),
      ratio: round(Number.isFinite(ratio) ? ratio : 999),
      peak: round(now.peak),
    });
    holdOff = index + 8; /* 40 ms: one attack, not its own ripples. */
  }
  return found;
}

export type Measurement = ReturnType<typeof measure>;

function measure(fixture: Fixture, rendered: Rendered) {
  const { mono, seconds } = rendered;
  const at = fixture.transitionSeconds;

  const attack = attackRatioAt(mono, RATE, at, 12);
  const level = levels(mono);

  /* The RMS curve, at 20 ms, so the shape of the note is in the artefact. */
  const curve = energyWindows(mono, RATE, 20).map((window) => ({
    t: round(window.timeSeconds),
    rms: round(window.rms),
  }));

  const frames = trackPitch(mono, {
    sampleRate: RATE,
    minHz: 60,
    maxHz: 1200,
    windowSeconds: 0.046,
    hopSeconds: 0.008,
  });
  const target = hzOf(fixture.targetPitch);
  const cents = centsTrack(frames, target);

  /*
   * Where the pitch is once the transition is over. Read a little after the
   * written moment, because a hand takes time to arrive and reading at the
   * instant would be reading the departure.
   */
  const settled = cents.filter(
    (point) => point.timeSeconds > at + 0.08 && point.timeSeconds < at + 0.4,
  );
  const settledCents =
    settled.length === 0
      ? null
      : round(settled.reduce((sum, point) => sum + point.cents, 0) / settled.length);

  /*
   * How long the pitch takes to arrive.
   *
   * This is the number that separates a hammer-on from a slide, and the
   * first version of this harness did not measure it: the two came out with
   * identical peaks, identical attacks and identical settled pitch, because
   * the only difference between them is how long the hand takes to travel.
   * A finger landing is a step; a hand sliding is a journey.
   */
  const arrival = cents.find(
    (point) => point.timeSeconds >= at && Math.abs(point.cents) <= 25,
  );
  const arrivalSeconds =
    arrival === undefined ? null : round(arrival.timeSeconds - at);

  /*
   * And when the pitch *left*, measured against the note it came from.
   *
   * A slide arrives exactly when the target is written — that is what 2F.2
   * decided, and it is why the arrival time above cannot tell a slide from a
   * hammer-on. What separates them is when the hand set off: a slide is
   * already travelling through the tail of the note before, a finger landing
   * is not. So departure is measured backwards from the written moment, and
   * a negative number means the pitch was on its way before the beat.
   */
  const fromCents = centsTrack(frames, hzOf(fixture.fromPitch));
  const holding = fromCents.filter(
    (point) => point.timeSeconds < at && Math.abs(point.cents) <= 25,
  );
  const lastHeld = holding.at(-1)?.timeSeconds ?? null;
  const departureSeconds = lastHeld === null ? null : round(lastHeld - at);

  /* How often the tracked pitch crosses a semitone boundary: one gesture is
     one crossing, and a restrike that lands in the wrong place is visible. */
  let transitions = 0;
  for (let index = 1; index < cents.length; index += 1) {
    const previous = cents[index - 1]!.cents;
    const now = cents[index]!.cents;
    if (Math.abs(now - previous) > 50) transitions += 1;
  }

  const before = mono.subarray(
    Math.max(0, Math.round((at - 0.05) * RATE)),
    Math.round(at * RATE),
  );
  const after = mono.subarray(
    Math.round(at * RATE),
    Math.min(mono.length, Math.round((at + 0.05) * RATE)),
  );

  /*
   * How bright the moment of the transition is.
   *
   * Level alone cannot say what a hand did. A finger hammering a string onto
   * a fret and a finger plucking it sideways on the way off are two
   * different noises, and the difference between them is mostly spectral —
   * so the brightness of the 30 ms after the written moment is measured
   * beside the level, and the two together are what "these are different
   * gestures" means.
   */
  const centroidFrom = Math.round(at * RATE);
  const centroidLength = Math.min(
    Math.round(0.03 * RATE),
    Math.max(0, mono.length - centroidFrom),
  );
  const transitionCentroidHz =
    centroidLength < 64
      ? null
      : round(spectralCentroid(mono, centroidFrom, centroidLength, RATE));

  return {
    fixture: fixture.name,
    what: fixture.what,
    durationSeconds: round(seconds),
    ...level,
    transitionSeconds: round(at),
    /** Energy just after the written moment over energy just before it. */
    attackRatio: round(Number.isFinite(attack.ratio) ? attack.ratio : 999),
    attackBeforeRms: round(attack.before),
    attackAfterRms: round(attack.after),
    transientWindow: {
      beforeRms: round(levels(before).rms),
      afterRms: round(levels(after).rms),
      /** The level change across the written moment, in dB. */
      changeDb: round(
        20 * Math.log10(Math.max(1e-9, levels(after).rms) / Math.max(1e-9, levels(before).rms)),
      ),
    },
    transitionCentroidHz,
    onsets: onsets(mono, RATE),
    onsetCount: onsets(mono, RATE).length,
    pitch: {
      fromPitch: fixture.fromPitch,
      targetPitch: fixture.targetPitch,
      targetHz: round(target),
      settledCents,
      /** Seconds from the written moment until the target pitch is heard. */
      arrivalSeconds,
      /** When the pitch last sat on the note it came from, relative to it. */
      departureSeconds,
      transitions,
      voicedFrames: cents.length,
    },
    voices: {
      logical: rendered.logicalVoices,
      physical: rendered.physicalSources,
      activeAfterDispose: rendered.activeAfterDispose,
    },
    rmsCurve: curve,
  };
}

declare global {
  interface Window {
    AranjeGuitarPerformance: {
      fixtureNames(): string[];
      renderFixture(name: string): Promise<Measurement & { wavBase64: string }>;
    };
  }
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary);
};

window.AranjeGuitarPerformance = {
  fixtureNames: () => FIXTURES.map((fixture) => fixture.name),
  async renderFixture(name: string) {
    const fixture = FIXTURES.find((entry) => entry.name === name);
    if (!fixture) throw new Error(`no fixture ${name}`);
    const rendered = await render(fixture.song);
    const wav = encodeWav({ channels: rendered.channels, sampleRate: RATE });
    if (!wav.ok) throw new Error(`wav refused: ${wav.code}`);
    return { ...measure(fixture, rendered), wavBase64: toBase64(wav.bytes) };
  },
};

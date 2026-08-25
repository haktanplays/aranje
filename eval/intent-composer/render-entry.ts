/**
 * The 1/32 playback investigation, rendered for real (2S-A §2 A, §3).
 *
 * Evaluation only, and deliberately *instrumented* rather than reimplemented:
 * the song goes through the production `createEngine` and the production
 * `scheduleSong`, and what this file adds is a log of what each layer did.
 * A reconstruction of the audio path would prove nothing about the path that
 * ships, and the reported defect is exactly the kind that lives between two
 * layers rather than inside one.
 *
 * Four layers are recorded separately, because "the note is silent" can be
 * true at any of them and the fix is a different fix in each case:
 *
 *   1. **timeline / notated plan** — is the onset in the song's own model?
 *   2. **scheduler** — was a transport event placed at its tick?
 *   3. **voice** — was a sampler or an expressive voice actually triggered?
 *   4. **render** — did energy appear in the output at that moment?
 */
import {
  centsBetween,
  energyWindows,
  fundamentalOf,
} from "../expression-benchmark/analysis";
import { REPORTED, matrix, songFor, type FixtureSpec } from "./fixtures";

import {
  createEngine,
  loadTone,
  scheduleSong,
  type Engine,
} from "@/lib/audio/engine";
import type { ExpressionPlan } from "@/lib/audio/expression-plan";
import { buildNotatedPlan } from "@/lib/audio/schedule";
import { buildTempoMap, secondsAtTicks } from "@/lib/audio/tempo";
import { pitchToMidi } from "@/lib/music/pitch";
import { audioExportLimits } from "@/lib/limits";
import { encodeWav } from "@/lib/export/wav-encoder";
import type { Song } from "@/lib/song/schema";

const RATE = audioExportLimits.sampleRate;
const round = (value: number): number => Math.round(value * 1e6) / 1e6;

/* ------------------------------------------------------------ the log */

export type TriggerLog = {
  /** `sampler` | `expressive` | `chain`. */
  readonly via: string;
  readonly pitch: string;
  readonly atSeconds: number;
  readonly durationSeconds: number | null;
  readonly gain: number | null;
};

type Recorder = { triggers: TriggerLog[] };

/**
 * Wrap the things that actually make sound, without changing what they do.
 *
 * Every wrapper calls straight through. The point is only to find out whether
 * the layer was reached at all, so a silent note can be attributed to the
 * layer that dropped it rather than guessed at.
 */
function instrument(engine: Engine, recorder: Recorder): void {
  for (const voice of engine.voices.values()) {
    if (voice.kind !== "sampler") continue;
    const sampler = voice.sampler as unknown as {
      triggerAttackRelease: (
        note: unknown,
        duration: unknown,
        time?: unknown,
        velocity?: number,
      ) => unknown;
      toSeconds: (value: unknown) => number;
    };
    const original = sampler.triggerAttackRelease.bind(sampler);
    const toSeconds = sampler.toSeconds.bind(sampler);
    sampler.triggerAttackRelease = (note, duration, time, velocity) => {
      recorder.triggers.push({
        via: "sampler",
        pitch: String(note),
        atSeconds: round(toSeconds(time)),
        durationSeconds: round(toSeconds(duration)),
        gain: velocity ?? null,
      });
      return original(note, duration, time, velocity);
    };
  }

  const expression = engine.expression as unknown as {
    play: (note: { pitch: string; durationSeconds: number; gain: number }, time: number) => boolean;
    playChain: (chain: { sourcePitch: string; endSeconds: number; startSeconds: number; gain: number }, time: number) => boolean;
  };
  const play = expression.play.bind(expression);
  const playChain = expression.playChain.bind(expression);
  expression.play = (note, time) => {
    recorder.triggers.push({
      via: "expressive",
      pitch: note.pitch,
      atSeconds: round(time),
      durationSeconds: round(note.durationSeconds),
      gain: round(note.gain),
    });
    return play(note, time);
  };
  expression.playChain = (chain, time) => {
    recorder.triggers.push({
      via: "chain",
      pitch: chain.sourcePitch,
      atSeconds: round(time),
      durationSeconds: round(chain.endSeconds - chain.startSeconds),
      gain: round(chain.gain),
    });
    return playChain(chain, time);
  };
}

/* --------------------------------------------------------- the render */

export type OnsetReport = {
  readonly index: number;
  readonly pitch: string;
  readonly timeTicks: number;
  readonly atSeconds: number;
  /** The written length in ticks, before the articulation shortens it. */
  readonly notatedTicks: number;
  /** What the scheduler would play, in ticks. */
  readonly playedTicks: number | null;
  readonly articulation: string | null;
  readonly chainRole: string | null;
  readonly expressive: boolean;
  /** Was a transport event placed for this onset at all? */
  readonly scheduled: boolean;
  /** Which layer, if any, actually triggered a voice within 5 ms of it. */
  readonly triggeredVia: string | null;
  /** RMS of the 20 ms after the onset, and of the 20 ms before it. */
  readonly rmsAfter: number;
  readonly rmsBefore: number;
  /** Above one when energy went up at the onset: something was struck. */
  readonly attackRatio: number;
  /** Peak in the onset's own window. */
  readonly peak: number;
  /** True when nothing audible happened here at all. */
  readonly silent: boolean;
};

export type FixtureReport = {
  readonly name: string;
  readonly bpm: number;
  readonly resolution: number;
  readonly slotSeconds: number;
  readonly onsets: readonly OnsetReport[];
  readonly triggers: readonly TriggerLog[];
  readonly scheduledEventCount: number;
  readonly chains: number;
  readonly expressiveNotes: number;
  readonly silentOnsets: readonly number[];
  readonly durationSeconds: number;
  readonly activeAfterDispose: number;
};

/** How loud a note has to get, relative to the loudest onset, to count as heard. */
const AUDIBLE_FRACTION = 0.12;
/** How much louder than the moment before it an onset has to be to count as struck. */
const ATTACK_FLOOR = 1.25;

async function renderSong(song: Song): Promise<{
  mono: Float32Array;
  triggers: TriggerLog[];
  plan: ExpressionPlan | null;
  scheduled: number[];
  activeAfterDispose: number;
  seconds: number;
  channels: Float32Array[];
}> {
  const tone = await loadTone();
  const tempo = buildTempoMap(song);
  const seconds = tempo.totalSeconds + 2;

  const recorder: Recorder = { triggers: [] };
  const scheduled: number[] = [];
  let built: Engine | null = null;
  let plan: ExpressionPlan | null = null;

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
      plan = engine.expression.getPlan();
      instrument(engine, recorder);

      // The transport is wrapped too, so "was an event placed here" is a
      // separate fact from "did a voice start here".
      const transport = (context as { transport: { schedule: (cb: unknown, at: unknown) => number; start(at: number): void; toSeconds(value: unknown): number } }).transport;
      const originalSchedule = transport.schedule.bind(transport);
      transport.schedule = (callback, at) => {
        scheduled.push(round(transport.toSeconds(at)));
        return originalSchedule(callback, at);
      };

      scheduleSong(engine, tempo, { metronomeEnabled: () => false });
      transport.start(0);
    },
    seconds,
    audioExportLimits.channels,
    RATE,
  )) as { toArray(): Float32Array | Float32Array[] };

  const raw = buffer.toArray();
  const planar = Array.isArray(raw) ? raw : [raw];
  const channels = planar.length >= 2 ? planar.slice(0, 2) : [planar[0]!, planar[0]!];
  const frames = channels[0]!.length;
  const mono = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1) {
    mono[index] = ((channels[0]![index] ?? 0) + (channels[1]![index] ?? 0)) / 2;
  }

  let activeAfterDispose = -1;
  const engine = built as Engine | null;
  if (engine) {
    engine.expression.stopAll();
    engine.dispose();
    activeAfterDispose = engine.expression.counts.active;
  }

  return {
    mono,
    triggers: recorder.triggers,
    plan,
    scheduled,
    activeAfterDispose,
    seconds: frames / RATE,
    channels,
  };
}

function rmsOf(samples: Float32Array, from: number, length: number): number {
  let sum = 0;
  let counted = 0;
  for (let index = from; index < from + length && index < samples.length; index += 1) {
    if (index < 0) continue;
    const value = samples[index] ?? 0;
    sum += value * value;
    counted += 1;
  }
  return counted === 0 ? 0 : Math.sqrt(sum / counted);
}

function peakOf(samples: Float32Array, from: number, length: number): number {
  let peak = 0;
  for (let index = Math.max(0, from); index < from + length && index < samples.length; index += 1) {
    peak = Math.max(peak, Math.abs(samples[index] ?? 0));
  }
  return peak;
}

export async function measureFixture(spec: FixtureSpec): Promise<FixtureReport> {
  const song = songFor(spec);
  const tempo = buildTempoMap(song);
  const notated = buildNotatedPlan(song);
  const rendered = await renderSong(song);
  const plan = rendered.plan;

  const slotSeconds =
    secondsAtTicks(tempo, 768 / spec.resolution) - secondsAtTicks(tempo, 0);
  // Half a slot, capped so a slow tempo does not measure the next note.
  const windowSeconds = Math.min(0.02, slotSeconds * 0.5);
  const windowFrames = Math.max(8, Math.round(windowSeconds * RATE));

  const noteEvents = notated.events.filter((event) => event.kind === "note");
  const onsets: OnsetReport[] = noteEvents.map((event, index) => {
    const atSeconds = secondsAtTicks(tempo, event.time);
    const planned = plan?.notes.find(
      (entry) => entry.timeTicks === event.time && entry.pitch === event.pitch,
    );
    const at = Math.round(atSeconds * RATE);
    const rmsAfter = rmsOf(rendered.mono, at, windowFrames);
    const rmsBefore = rmsOf(rendered.mono, at - windowFrames, windowFrames);
    const trigger = rendered.triggers.find(
      (entry) => Math.abs(entry.atSeconds - atSeconds) < 0.005,
    );
    return {
      index,
      pitch: event.pitch,
      timeTicks: event.time,
      atSeconds: round(atSeconds),
      notatedTicks: event.durationTicks,
      playedTicks: planned?.durationTicks ?? null,
      articulation: event.articulation ?? null,
      chainRole: planned?.chainRole ?? null,
      expressive: planned?.expressive ?? false,
      scheduled: rendered.scheduled.some((time) => Math.abs(time - atSeconds) < 0.005),
      triggeredVia: trigger?.via ?? null,
      rmsAfter: round(rmsAfter),
      rmsBefore: round(rmsBefore),
      attackRatio: round(rmsBefore > 0 ? rmsAfter / rmsBefore : rmsAfter > 0 ? Infinity : 0),
      peak: round(peakOf(rendered.mono, at, windowFrames)),
      silent: false,
    };
  });

  /*
   * "Silent" is measured against the run itself, not against an absolute
   * level. A note that is quieter than an eighth of the loudest onset and did
   * not raise the level at its own moment was not heard — whatever the sample
   * pack's absolute output happens to be.
   *
   * A chain target is exempt: it is not supposed to be struck. Its silence is
   * the articulation working, and counting it would make every pull-off look
   * like the defect.
   */
  const loudest = Math.max(...onsets.map((onset) => onset.peak), 0);
  const decided = onsets.map((onset) => ({
    ...onset,
    silent:
      onset.chainRole !== "target" &&
      onset.peak < loudest * AUDIBLE_FRACTION &&
      onset.attackRatio < ATTACK_FLOOR,
  }));

  return {
    name: spec.name,
    bpm: spec.bpm,
    resolution: spec.resolution,
    slotSeconds: round(slotSeconds),
    onsets: decided,
    triggers: rendered.triggers,
    scheduledEventCount: rendered.scheduled.length,
    chains: plan?.chains.length ?? 0,
    expressiveNotes: plan?.expressiveNotes ?? 0,
    silentOnsets: decided.filter((onset) => onset.silent).map((onset) => onset.index),
    durationSeconds: round(rendered.seconds),
    activeAfterDispose: rendered.activeAfterDispose,
  };
}

/** Every energy window of the reported fixture, for a shape a person can read. */
export async function reportedEnvelope(): Promise<{
  windows: readonly { timeSeconds: number; rms: number; peak: number }[];
  wav: string;
}> {
  const song = songFor(REPORTED);
  const rendered = await renderSong(song);
  const windows = energyWindows(rendered.mono, RATE, 5).map((window) => ({
    timeSeconds: round(window.timeSeconds),
    rms: round(window.rms),
    peak: round(window.peak),
  }));
  const encoded = encodeWav({ channels: rendered.channels, sampleRate: RATE });
  if (!encoded.ok) throw new Error(`wav: ${encoded.code}`);
  let binary = "";
  for (let index = 0; index < encoded.bytes.length; index += 1) {
    binary += String.fromCharCode(encoded.bytes[index]!);
  }
  return { windows, wav: btoa(binary) };
}

/* ------------------------------------------------- what one note contributes */

/**
 * The exact signal one onset adds, by subtraction (§3).
 *
 * Rendering the run twice — once whole, once with one onset turned into a rest
 * — and subtracting gives precisely the sound that onset was responsible for.
 * Nothing about it is a threshold or a heuristic: if the difference is silence,
 * the note made no sound, whatever the envelope around it looked like.
 *
 * The one thing it cannot answer honestly is a legato chain member. Removing a
 * chain's source turns its target into a refused slur, so the difference then
 * carries the whole chain rather than one note. Those onsets are reported with
 * `chainMember: true` and their number is read as "the chain's contribution".
 */
export type ContributionReport = {
  readonly name: string;
  readonly onsets: readonly {
    readonly index: number;
    readonly pitch: string;
    readonly atSeconds: number;
    readonly chainMember: boolean;
    /** Peak of `full − without-this-onset`, over the whole render. */
    readonly peak: number;
    readonly rms: number;
    /** The same, over this onset's own slot only. */
    readonly peakInSlot: number;
  }[];
  /** Loudest single contribution in the run, for scale. */
  readonly loudest: number;
};

export async function measureContribution(
  spec: FixtureSpec,
): Promise<ContributionReport> {
  const song = songFor(spec);
  const tempo = buildTempoMap(song);
  const full = await renderSong(song);
  const notated = buildNotatedPlan(song);
  const plan = full.plan;
  const slotSeconds =
    secondsAtTicks(tempo, 768 / spec.resolution) - secondsAtTicks(tempo, 0);
  const slotFrames = Math.max(8, Math.round(slotSeconds * RATE));

  const noteEvents = notated.events.filter((event) => event.kind === "note");
  const out: ContributionReport["onsets"][number][] = [];

  for (let index = 0; index < noteEvents.length; index += 1) {
    const event = noteEvents[index]!;
    const withoutIt = silenceOnset(songFor(spec), index, spec);
    const other = await renderSong(withoutIt);

    const frames = Math.min(full.mono.length, other.mono.length);
    const difference = new Float32Array(frames);
    for (let frame = 0; frame < frames; frame += 1) {
      difference[frame] = (full.mono[frame] ?? 0) - (other.mono[frame] ?? 0);
    }

    const atSeconds = secondsAtTicks(tempo, event.time);
    const at = Math.round(atSeconds * RATE);
    const planned = plan?.notes.find((entry) => entry.timeTicks === event.time);
    out.push({
      index,
      pitch: event.pitch,
      atSeconds: round(atSeconds),
      chainMember: planned?.chainId !== undefined,
      peak: round(peakOf(difference, 0, difference.length)),
      rms: round(rmsOf(difference, 0, difference.length)),
      peakInSlot: round(peakOf(difference, at, slotFrames)),
    });
  }

  return { name: spec.name, onsets: out, loudest: Math.max(...out.map((o) => o.peak), 0) };
}

/** The same song with one onset's slot emptied, and nothing else touched. */
function silenceOnset(song: Song, index: number, spec: FixtureSpec): Song {
  const start = spec.startSlot ?? 0;
  const target = start + index;
  const trackId = song.tracks[0]!.id;
  const lastSection = song.sections.length - 1;
  const perBar = song.sections[lastSection]!.bars[0]!.slots[trackId]!.length;
  const barIndex = Math.floor(target / perBar);
  const slotIndex = target % perBar;

  const sections = song.sections.map((section, sectionIndex) => {
    if (sectionIndex !== lastSection) return section;
    const bars = section.bars.map((bar, position) => {
      if (position !== barIndex) return bar;
      const lane = bar.slots[trackId];
      if (!Array.isArray(lane)) return bar;
      const emptied = (lane as readonly unknown[]).map((slot, at) =>
        at === slotIndex ? null : slot,
      );
      return { ...bar, slots: { ...bar.slots, [trackId]: emptied } } as typeof bar;
    });
    return { ...section, bars };
  });

  return { ...song, sections };
}

export async function measureContributionNamed(
  name: string,
): Promise<ContributionReport> {
  return measureContribution(specFor(name));
}

/** Every 5 ms window of one fixture, so a person can read the shape. */
export async function envelopeFor(name: string): Promise<{
  windows: readonly { timeSeconds: number; rms: number; peak: number }[];
  wav: string;
}> {
  const rendered = await renderSong(songFor(specFor(name)));
  const windows = energyWindows(rendered.mono, RATE, 5).map((window) => ({
    timeSeconds: round(window.timeSeconds),
    rms: round(window.rms),
    peak: round(window.peak),
  }));
  const encoded = encodeWav({ channels: rendered.channels, sampleRate: RATE });
  if (!encoded.ok) throw new Error(`wav: ${encoded.code}`);
  let binary = "";
  for (let index = 0; index < encoded.bytes.length; index += 1) {
    binary += String.fromCharCode(encoded.bytes[index]!);
  }
  return { windows, wav: btoa(binary) };
}

/* --------------------------------------------------- the live path, captured */

/**
 * The same song on a **real** audio context, recorded as it plays (§2 A, §3).
 *
 * The offline renderer walks its own clock as fast as it can and never misses
 * a callback. A live transport does not: it looks ahead a fixed distance and
 * fires whatever falls inside each tick of a real timer. That is a different
 * machine, and a note can be lost in it that the offline render plays
 * perfectly — so the report's "some notes are not heard" has to be measured
 * here, not there.
 *
 * Capture is a `ScriptProcessorNode` on the engine's own master. Deprecated,
 * and used anyway: it is the only way to get the actual samples a live
 * context produced, and this file is evaluation code that ships nowhere.
 */
export type LiveReport = {
  readonly name: string;
  readonly triggers: readonly TriggerLog[];
  readonly capturedSeconds: number;
  readonly sampleRate: number;
  readonly onsets: readonly {
    readonly index: number;
    readonly pitch: string;
    readonly atSeconds: number;
    readonly chainRole: string | null;
    readonly peakInSlot: number;
    readonly rmsInSlot: number;
    /** How late this onset's own transport callback ran, in seconds. */
    readonly latenessSeconds: number | null;
    /** What the scheduler asked the voice to sound for. */
    readonly playedSeconds: number;
    /**
     * True when the callback ran later than the note's whole length.
     *
     * Both the attack and the release are then in the past, so the source is
     * told to start and to stop at moments that have already gone by — and it
     * produces no samples at all.
     */
    readonly deadOnArrival: boolean;
  }[];
  /** Times the transport callback ran later than the moment it was given. */
  readonly lateCallbacks: number;
  readonly worstLatenessSeconds: number;
  readonly medianLatenessSeconds: number;
  readonly deadOnArrivalCount: number;
  /** Milliseconds of main-thread blocking injected while it played. */
  readonly loadMs: number;
  readonly start: LiveStart;
  readonly seekTicks: number;
  /** Where the capture decided the music began, in captured frames. */
  readonly firstSoundFrame: number;
  /** 5 ms windows of the capture, from the first sound onwards. */
  readonly envelope: readonly { timeSeconds: number; rms: number; peak: number }[];
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * How the transport was started, mirroring the ways `play()` can start it.
 *
 * `plain` is `transport.start()`. `countin` is `transport.start(now + wait)`,
 * which is what a count-in does. `seek` sets `transport.ticks` first, which is
 * what tapping a bar and what a practice range's wrap do. They are separate
 * cases because they are separate code paths in Tone, and a note can be lost
 * in one of them and not the others.
 */
export type LiveStart = "plain" | "countin" | "seek";

export async function captureLive(
  spec: FixtureSpec,
  loadMs = 0,
  start: LiveStart = "plain",
  seekTicks = 0,
): Promise<LiveReport> {
  const tone = await loadTone();
  await (tone as unknown as { start(): Promise<void> }).start();

  const song = songFor(spec);
  const tempo = buildTempoMap(song);
  const notated = buildNotatedPlan(song);

  /*
   * A native `AudioContext`, handed to Tone rather than created by it.
   *
   * Tone builds its own context through `standardized-audio-context`, whose
   * wrapper does not carry `createScriptProcessor` — and that is the only
   * node that can hand back the samples a live graph actually produced. Tone
   * accepts an existing context, so the graph is still entirely Tone's; what
   * changes is only that the raw context underneath it is one this file can
   * tap.
   */
  const native = new AudioContext({ latencyHint: "interactive" });
  const context = new (tone as unknown as {
    Context: new (options?: unknown) => unknown;
  }).Context({ context: native });
  const recorder: Recorder = { triggers: [] };
  const lateness: number[] = [];

  const engine = await createEngine(song, context as never);
  instrument(engine, recorder);

  const raw = native;
  const captured: Float32Array[] = [];
  const processor = raw.createScriptProcessor(4096, 2, 2);
  processor.onaudioprocess = (event) => {
    const left = event.inputBuffer.getChannelData(0);
    const right = event.inputBuffer.getChannelData(1);
    const block = new Float32Array(left.length);
    for (let index = 0; index < left.length; index += 1) {
      block[index] = ((left[index] ?? 0) + (right[index] ?? 0)) / 2;
    }
    captured.push(block);
  };
  (engine.master as unknown as { connect(node: AudioNode): void }).connect(processor);
  processor.connect(raw.destination);

  const transport = (context as {
    transport: {
      schedule(callback: (time: number) => void, at: unknown): number;
      start(at?: number): void;
      stop(): void;
      toSeconds(value: unknown): number;
      now(): number;
    };
    now(): number;
    dispose(): Promise<unknown>;
  }).transport;

  const ranAt = new Map<number, number>();
  const original = transport.schedule.bind(transport);
  transport.schedule = (callback, at) => {
    const scheduledFor = transport.toSeconds(at);
    return original((time) => {
      const late = raw.currentTime - time;
      lateness.push(late);
      ranAt.set(round(scheduledFor), late);
      callback(time);
    }, at);
  };

  scheduleSong(engine, tempo, { metronomeEnabled: () => false });

  /*
   * Exactly the three ways `play()` can start the transport. `plain` takes no
   * argument; `countin` starts at a moment in the future, the way the clicks
   * do; `seek` moves the tick counter first, the way tapping a bar does.
   */
  if (start === "countin") {
    transport.start((context as { now(): number }).now() + 0.5);
  } else if (start === "seek") {
    (transport as unknown as { ticks: number }).ticks = seekTicks;
    transport.start();
  } else {
    transport.start();
  }
  /*
   * Optional main-thread blocking, so a measurement can be taken under the
   * kind of load a real session has rather than only on an idle machine.
   * It is a busy wait on purpose: a timer would yield, and yielding is
   * exactly what a stalled main thread does not do.
   */
  const deadline = performance.now() + (tempo.totalSeconds + 1.2) * 1000;
  while (performance.now() < deadline) {
    if (loadMs > 0) {
      const until = performance.now() + loadMs;
      while (performance.now() < until) {
        /* hold the thread */
      }
    }
    await sleep(loadMs > 0 ? 1 : 20);
  }
  transport.stop();

  processor.disconnect();
  engine.expression.stopAll();
  engine.dispose();

  const frames = captured.reduce((total, block) => total + block.length, 0);
  const mono = new Float32Array(frames);
  let cursor = 0;
  for (const block of captured) {
    mono.set(block, cursor);
    cursor += block.length;
  }
  const rate = raw.sampleRate;
  await (context as { dispose(): Promise<unknown> }).dispose();

  /*
   * The capture starts when the processor's first block arrives, which is not
   * the transport's zero. The offset is found from the first sample that rises
   * above the noise floor, because the first onset is at tick 0 in every
   * fixture here and is therefore the only thing that can be making it.
   */
  let firstSound = 0;
  for (let index = 0; index < mono.length; index += 1) {
    if (Math.abs(mono[index] ?? 0) > 0.002) {
      firstSound = index;
      break;
    }
  }

  const slotSeconds =
    secondsAtTicks(tempo, 768 / spec.resolution) - secondsAtTicks(tempo, 0);
  const slotFrames = Math.max(8, Math.round(slotSeconds * rate));

  const plan = engine.expression.getPlan();
  const onsets = notated.events
    .filter((event) => event.kind === "note")
    .map((event, index) => {
      const atSeconds = secondsAtTicks(tempo, event.time);
      const at = firstSound + Math.round(atSeconds * rate);
      const planned = plan.notes.find((entry) => entry.timeTicks === event.time);
      const late = ranAt.get(round(atSeconds)) ?? null;
      const playedSeconds = planned
        ? secondsAtTicks(tempo, event.time + planned.durationTicks) - atSeconds
        : 0;
      return {
        index,
        pitch: event.pitch,
        atSeconds: round(atSeconds),
        chainRole: planned?.chainRole ?? null,
        peakInSlot: round(peakOf(mono, at, slotFrames)),
        rmsInSlot: round(rmsOf(mono, at, slotFrames)),
        latenessSeconds: late === null ? null : round(late),
        playedSeconds: round(playedSeconds),
        deadOnArrival:
          late !== null && playedSeconds > 0 && late >= playedSeconds,
      };
    });

  const sorted = [...lateness].sort((a, b) => a - b);
  return {
    name: spec.name,
    triggers: recorder.triggers,
    capturedSeconds: round(frames / rate),
    sampleRate: rate,
    onsets,
    lateCallbacks: lateness.filter((value) => value > 0.001).length,
    worstLatenessSeconds: round(Math.max(0, ...lateness)),
    medianLatenessSeconds: round(sorted[Math.floor(sorted.length / 2)] ?? 0),
    deadOnArrivalCount: onsets.filter((onset) => onset.deadOnArrival).length,
    loadMs,
    start,
    seekTicks,
    firstSoundFrame: firstSound,
    envelope: energyWindows(mono.slice(firstSound), rate, 5).map((window) => ({
      timeSeconds: round(window.timeSeconds),
      rms: round(window.rms),
      peak: round(window.peak),
    })),
  };
}

export async function captureLiveNamed(
  name: string,
  loadMs = 0,
  start: LiveStart = "plain",
  seekTicks = 0,
): Promise<LiveReport> {
  return captureLive(specFor(name), loadMs, start, seekTicks);
}

/* --------------------------------------- does the slurred pitch ever arrive? */

/**
 * Whether a legato target's own pitch is ever actually sounded (§3).
 *
 * A hammer-on or a pull-off is not struck: the chain moves the ringing voice's
 * pitch instead. So "was the note heard" is not a question about energy — the
 * string is loud throughout — it is a question about **pitch**. If the voice
 * stops before the travel finishes, the target's pitch is never reached and
 * the reader hears the note before it, held, and then nothing.
 *
 * The fundamental is tracked through the target's own slot and compared, in
 * cents, with the pitch the score writes there.
 */
export type ArrivalReport = {
  readonly name: string;
  readonly targets: readonly {
    readonly index: number;
    readonly pitch: string;
    readonly atSeconds: number;
    readonly kind: string;
    /** How long the planner gave the finger to land, in seconds. */
    readonly transitionSeconds: number;
    /** When the plan says the pitch arrives, from the chain's start. */
    readonly arrivesAtSeconds: number;
    /** When the chain's one voice stops, from the chain's start. */
    readonly chainEndsAtSeconds: number;
    /** True when the voice stops before the travel has finished. */
    readonly stopsBeforeArrival: boolean;
    /** Seconds the target's own pitch is actually sounding. Never negative. */
    readonly heldSeconds: number;
    /** Measured: how far the sounding pitch is from the written one, in cents. */
    readonly centsOffAtOnset: number | null;
    readonly centsOffAtSlotEnd: number | null;
  }[];
};

export async function measureArrival(spec: FixtureSpec): Promise<ArrivalReport> {
  const song = songFor(spec);
  const tempo = buildTempoMap(song);
  const rendered = await renderSong(song);
  const plan = rendered.plan;
  if (!plan) return { name: spec.name, targets: [] };

  const slotSeconds =
    secondsAtTicks(tempo, 768 / spec.resolution) - secondsAtTicks(tempo, 0);

  const targets = plan.notes
    .filter((note) => note.chainRole === "target")
    .map((note) => {
      const chain = plan.chains.find((entry) => entry.chainId === note.chainId)!;
      const transition = chain.transitions.find((entry) => entry.noteId === note.id)!;
      const chainEndsAt = chain.endSeconds - chain.startSeconds;
      const written = pitchToMidi(note.pitch);
      const at = note.startSeconds;
      const measure = (from: number): number | null => {
        if (written === null) return null;
        const found = fundamentalOf(
          rendered.mono,
          Math.round(from * RATE),
          Math.round(Math.min(0.03, slotSeconds * 0.6) * RATE),
          { sampleRate: RATE, minHz: 70, maxHz: 1200 },
        );
        if (found.hz === null || found.hz <= 0 || found.confidence < 0.5) return null;
        const reference = 440 * Math.pow(2, (written - 69) / 12);
        return round(centsBetween(found.hz, reference));
      };
      return {
        index: plan.notes.indexOf(note),
        pitch: note.pitch,
        atSeconds: round(at),
        kind: transition.kind,
        transitionSeconds: round(transition.transitionSeconds),
        arrivesAtSeconds: round(transition.arrivesAtSeconds),
        chainEndsAtSeconds: round(chainEndsAt),
        stopsBeforeArrival: chainEndsAt < transition.arrivesAtSeconds,
        heldSeconds: round(Math.max(0, chainEndsAt - transition.arrivesAtSeconds)),
        centsOffAtOnset: measure(at),
        centsOffAtSlotEnd: measure(at + slotSeconds * 0.6),
      };
    });

  return { name: spec.name, targets };
}

export async function measureArrivalNamed(name: string): Promise<ArrivalReport> {
  return measureArrival(specFor(name));
}

export function fixtureNames(): string[] {
  return [REPORTED.name, ...matrix().map((spec) => spec.name)];
}

export function specFor(name: string): FixtureSpec {
  if (name === REPORTED.name) return REPORTED;
  const found = matrix().find((spec) => spec.name === name);
  if (!found) throw new Error(`no fixture named ${name}`);
  return found;
}

export async function measureNamed(name: string): Promise<FixtureReport> {
  return measureFixture(specFor(name));
}

declare global {
  interface Window {
    AranjeIntentRender: {
      fixtureNames: typeof fixtureNames;
      measureNamed: typeof measureNamed;
      reportedEnvelope: typeof reportedEnvelope;
      measureContributionNamed: typeof measureContributionNamed;
      envelopeFor: typeof envelopeFor;
      captureLiveNamed: typeof captureLiveNamed;
      measureArrivalNamed: typeof measureArrivalNamed;
    };
  }
}

if (typeof window !== "undefined") {
  window.AranjeIntentRender = {
    fixtureNames,
    measureNamed,
    reportedEnvelope,
    measureContributionNamed,
    envelopeFor,
    captureLiveNamed,
    measureArrivalNamed,
  };
}

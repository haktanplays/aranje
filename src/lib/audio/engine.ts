/**
 * Tone.js signal graph and transport wiring (spec 8).
 *
 * The engine never touches Tone's module-level `Transport` or `Destination`
 * exports. Those are bound to whichever context existed when the module was
 * first imported, so under an offline render they point at the wrong graph and
 * nothing sounds. Everything here comes from a context that is handed in:
 * nodes are constructed with `{ context }`, the master gain lands on
 * `context.destination`, and events are placed on `context.transport`.
 *
 * Online and offline use the same code and the same scheduling core. The only
 * difference is which context is injected.
 *
 * Only the proven nodes are used: Sampler, MembraneSynth, NoiseSynth, Filter,
 * Channel, Gain, Destination and Meter (spec 8.1).
 */
import type * as Tone from "tone";

import { isDrumInstrument } from "@/lib/instruments/registry";
import { samplePackFor } from "@/lib/audio/packs";
import { metronomeClicks } from "@/lib/audio/position";
import { buildSongPlan, ticks, type SongPlan } from "@/lib/audio/schedule";
import type { DrumPiece, Song, Track } from "@/lib/song/schema";

/**
 * Tone reaches for `window` as soon as it is imported, so it is pulled in on
 * demand rather than at module scope. That keeps this file importable during
 * the server render while the audio itself stays client-only (spec 8.3).
 */
type ToneModule = typeof import("tone");

let tonePromise: Promise<ToneModule> | null = null;

/**
 * Finds the real module behind the import.
 *
 * Tone's package.json points its `browser` field at a UMD bundle, so a client
 * build resolves the dynamic import to a file that publishes itself on the
 * global object and hands back an empty namespace. Other bundlers give the ESM
 * namespace directly, or wrap it under `default`. All three shapes are checked
 * rather than assumed, which also keeps the offline render and the app on the
 * same loader.
 */
function unwrapTone(loaded: unknown): ToneModule {
  const candidate = loaded as ToneModule & { default?: ToneModule };
  if (typeof candidate?.start === "function") return candidate;
  if (typeof candidate?.default?.start === "function") return candidate.default;

  const global = (globalThis as { Tone?: ToneModule }).Tone;
  if (typeof global?.start === "function") return global;

  const keys = Object.keys(candidate ?? {}).slice(0, 20).join(", ");
  throw new Error(
    `Tone.js yüklendi ama beklenen arayüzü sağlamıyor. Gelen anahtarlar: ${keys || "(bos namespace)"}`,
  );
}

export async function loadTone(): Promise<ToneModule> {
  tonePromise ??= import("tone").then(unwrapTone);
  return tonePromise;
}

/** Anything that can host the graph: a live context or an offline one. */
export type AudioRuntime = Tone.BaseContext;

export type DrumVoices = {
  kick: Tone.MembraneSynth;
  snare: Tone.NoiseSynth;
  hat: Tone.NoiseSynth;
  cymbal: Tone.NoiseSynth;
  filters: Tone.Filter[];
};

/** Click voice for the metronome, on the same context as everything else. */
export type MetronomeVoice = { click: Tone.NoiseSynth; filter: Tone.Filter };

export type TrackVoice =
  | {
      kind: "sampler";
      trackId: string;
      sampler: Tone.Sampler;
      channel: Tone.Channel;
      bufferCount: number;
    }
  | { kind: "drums"; trackId: string; drums: DrumVoices; channel: Tone.Channel };

export type Engine = {
  context: AudioRuntime;
  master: Tone.Gain;
  metronome: MetronomeVoice;
  voices: Map<string, TrackVoice>;
  meters: Map<string, Tone.Meter>;
  plan: SongPlan;
  /** How many sample buffers this graph expects, and how many arrived. */
  expectedBuffers: number;
  loadedBuffers: number;
  dispose(): void;
};

export type CreateEngineOptions = {
  debug?: boolean;
  /** Tracks to leave out of the graph entirely, for isolated renders. */
  excludeTrackIds?: readonly string[];
  /** Called as each sample pack finishes decoding. */
  onProgress?: (loadedBuffers: number, totalBuffers: number) => void;
};

/** A sample pack that could not be fetched or decoded. */
export class SampleLoadError extends Error {
  constructor(
    readonly packId: string,
    readonly reason: unknown,
  ) {
    super(`Ses paketi yüklenemedi: ${packId}`);
    this.name = "SampleLoadError";
  }
}

function buildMetronome(
  tone: ToneModule,
  context: AudioRuntime,
  destination: Tone.InputNode,
): MetronomeVoice {
  const filter = new tone.Filter({
    context,
    frequency: 2400,
    type: "highpass",
  });
  filter.connect(destination);
  const click = new tone.NoiseSynth({
    context,
    volume: -20,
    envelope: { attack: 0.001, decay: 0.02, sustain: 0 },
  });
  click.connect(filter);
  return { click, filter };
}

/** Kick, snare, hats and cymbals from the allowed synth nodes (spec 8.1). */
function buildDrums(
  tone: ToneModule,
  context: AudioRuntime,
  destination: Tone.InputNode,
): DrumVoices {
  const kick = new tone.MembraneSynth({
    context,
    volume: -5,
    pitchDecay: 0.04,
    octaves: 6,
    envelope: { attack: 0.001, decay: 0.28, sustain: 0 },
  });
  kick.connect(destination);

  const snareFilter = new tone.Filter({
    context,
    frequency: 1800,
    type: "highpass",
  });
  snareFilter.connect(destination);
  const snare = new tone.NoiseSynth({
    context,
    volume: -11,
    envelope: { attack: 0.001, decay: 0.14, sustain: 0 },
  });
  snare.connect(snareFilter);

  const hatFilter = new tone.Filter({
    context,
    frequency: 7000,
    type: "highpass",
  });
  hatFilter.connect(destination);
  const hat = new tone.NoiseSynth({
    context,
    volume: -21,
    envelope: { attack: 0.001, decay: 0.035, sustain: 0 },
  });
  hat.connect(hatFilter);

  const cymbalFilter = new tone.Filter({
    context,
    frequency: 5200,
    type: "highpass",
  });
  cymbalFilter.connect(destination);
  const cymbal = new tone.NoiseSynth({
    context,
    volume: -19,
    envelope: { attack: 0.002, decay: 1.1, sustain: 0 },
  });
  cymbal.connect(cymbalFilter);

  return {
    kick,
    snare,
    hat,
    cymbal,
    filters: [snareFilter, hatFilter, cymbalFilter],
  };
}

type VoiceBuild = { voice: TrackVoice; loaded: Promise<void> };

/** Builds the graph for one track, plus a promise for its samples. */
function buildVoice(
  tone: ToneModule,
  context: AudioRuntime,
  track: Track,
  master: Tone.Gain,
): VoiceBuild | null {
  const channel = new tone.Channel({ context, volume: track.volumeDb });
  if (track.pan !== undefined) channel.pan.value = track.pan;
  if (track.muted) channel.mute = true;
  channel.connect(master);

  if (isDrumInstrument(track.instrumentId)) {
    return {
      voice: {
        kind: "drums",
        trackId: track.id,
        drums: buildDrums(tone, context, channel),
        channel,
      },
      // Synthesised, so there is nothing to download.
      loaded: Promise.resolve(),
    };
  }

  const pack = samplePackFor(track.instrumentId, track.presetId);
  if (!pack) {
    channel.dispose();
    return null;
  }

  let settle: () => void = () => {};
  let fail: (error: unknown) => void = () => {};
  const loaded = new Promise<void>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });

  const sampler = new tone.Sampler({
    context,
    urls: pack.urls,
    baseUrl: pack.baseUrl,
    volume: pack.trimDb,
    // Fires once every buffer of this sampler has decoded.
    onload: () => settle(),
    // A missing or undecodable file is surfaced, never swallowed into a
    // synthesised stand-in.
    onerror: (error) => fail(new SampleLoadError(pack.id, error)),
  });
  sampler.connect(channel);

  return {
    voice: {
      kind: "sampler",
      trackId: track.id,
      sampler,
      channel,
      bufferCount: Object.keys(pack.urls).length,
    },
    loaded,
  };
}

/**
 * Builds the graph on the given context and waits for every sample of every
 * sampler to decode. Nothing is scheduled here; the caller schedules once this
 * resolves.
 */
export async function createEngine(
  song: Song,
  context: AudioRuntime,
  options: CreateEngineOptions = {},
): Promise<Engine> {
  const excluded = new Set(options.excludeTrackIds ?? []);

  const tone = await loadTone();
  const master = new tone.Gain({ context, gain: 1 });
  master.connect(context.destination);
  const metronome = buildMetronome(tone, context, master);

  const voices = new Map<string, TrackVoice>();
  const meters = new Map<string, Tone.Meter>();
  const loads: Promise<void>[] = [];

  for (const track of song.tracks) {
    if (excluded.has(track.id)) continue;
    const built = buildVoice(tone, context, track, master);
    if (!built) continue;

    voices.set(track.id, built.voice);
    loads.push(built.loaded);

    if (options.debug) {
      const meter = new tone.Meter({ context, smoothing: 0.6 });
      built.voice.channel.connect(meter);
      meters.set(track.id, meter);
    }
  }

  const samplers = [...voices.values()].filter(
    (voice) => voice.kind === "sampler",
  );
  const expectedBuffers = samplers.reduce(
    (total, voice) => total + (voice.kind === "sampler" ? voice.bufferCount : 0),
    0,
  );

  // Await these samplers, not a global download registry. Progress is reported
  // as each pack lands so the interface can show something truthful.
  let decoded = 0;
  options.onProgress?.(0, expectedBuffers);
  await Promise.all(
    [...voices.values()].map((voice, index) => {
      const load = loads[index] ?? Promise.resolve();
      if (voice.kind !== "sampler") return load;
      return load.then(() => {
        decoded += voice.bufferCount;
        options.onProgress?.(decoded, expectedBuffers);
      });
    }),
  );
  const loadedBuffers = samplers.reduce(
    (total, voice) =>
      total +
      (voice.kind === "sampler" && voice.sampler.loaded ? voice.bufferCount : 0),
    0,
  );

  return {
    context,
    master,
    metronome,
    voices,
    meters,
    plan: buildSongPlan(song),
    expectedBuffers,
    loadedBuffers,
    dispose() {
      for (const voice of voices.values()) {
        if (voice.kind === "sampler") voice.sampler.dispose();
        else {
          voice.drums.kick.dispose();
          voice.drums.snare.dispose();
          voice.drums.hat.dispose();
          voice.drums.cymbal.dispose();
          for (const filter of voice.drums.filters) filter.dispose();
        }
        voice.channel.dispose();
      }
      for (const meter of meters.values()) meter.dispose();
      metronome.click.dispose();
      metronome.filter.dispose();
      master.dispose();
    },
  };
}

/**
 * Starts the audio context from a user gesture and builds the engine on it.
 * This is the only entry point the interface should use.
 */
export async function createLiveEngine(
  song: Song,
  options: CreateEngineOptions = {},
): Promise<Engine> {
  const tone = await loadTone();
  // Spec 8.3: the context may only be started inside a user gesture.
  await tone.start();
  return createEngine(song, tone.getContext(), options);
}

export type ScheduleOptions = {
  /**
   * Read at click time rather than baked in, so the metronome can be toggled
   * without rescheduling the music.
   */
  metronomeEnabled?: () => boolean;
  /** Fired on the drawing clock when the transport reaches the last bar line. */
  onEnded?: () => void;
};

/**
 * Places every event of the plan on the engine's own transport. Times are
 * ticks derived from note values, so a tempo change rescales them for free.
 *
 * This runs once per engine. Play and pause never reschedule.
 */
export function scheduleSong(
  engine: Engine,
  bpm: number,
  options: ScheduleOptions = {},
): number {
  const transport = engine.context.transport;
  transport.cancel();
  transport.PPQ = 192;
  // Tempo is set before anything is scheduled (spec 8.3).
  transport.bpm.value = bpm;

  for (const event of engine.plan.events) {
    const voice = engine.voices.get(event.trackId);
    if (!voice) continue;

    if (event.kind === "note" && voice.kind === "sampler") {
      const { sampler } = voice;
      const duration = ticks(event.durationTicks);
      transport.schedule((time) => {
        sampler.triggerAttackRelease(event.pitch, duration, time, event.gain);
      }, ticks(event.time));
      continue;
    }

    if (event.kind === "drum" && voice.kind === "drums") {
      const { drums } = voice;
      transport.schedule((time) => {
        playDrum(drums, event.piece, time, event.gain);
      }, ticks(event.time));
    }
  }

  // The metronome sits on the same transport and the same context as the
  // music, so it cannot drift away from it.
  const { click } = engine.metronome;
  for (const beat of metronomeClicks(engine.plan)) {
    transport.schedule((time) => {
      if (!options.metronomeEnabled?.()) return;
      click.triggerAttackRelease(0.02, time, beat.downbeat ? 1 : 0.55);
    }, ticks(beat.time));
  }

  if (options.onEnded) {
    const notify = options.onEnded;
    transport.schedule((time) => {
      // Drawn on the visual clock, so the state flips when the listener hears
      // the end rather than at the scheduler's look-ahead.
      engine.context.draw.schedule(() => notify(), time);
    }, ticks(engine.plan.totalTicks));
  }

  return engine.plan.totalTicks;
}

/** Maps a drum piece onto the synthesised voices. */
export function playDrum(
  drums: DrumVoices,
  piece: DrumPiece,
  time: number,
  gain: number,
) {
  switch (piece) {
    case "kick":
      drums.kick.triggerAttackRelease("C1", 0.08, time, gain);
      return;
    case "snare":
      drums.snare.triggerAttackRelease(0.12, time, gain);
      return;
    case "closed_hat":
      drums.hat.triggerAttackRelease(0.03, time, gain);
      return;
    case "open_hat":
      drums.hat.triggerAttackRelease(0.18, time, gain * 0.9);
      return;
    case "crash":
    case "china":
    case "ride":
      drums.cymbal.triggerAttackRelease(0.9, time, gain);
      return;
    default:
      // Toms use the membrane voice at different pitches.
      drums.kick.triggerAttackRelease(
        piece === "tom_high" ? "G2" : piece === "tom_mid" ? "D2" : "A1",
        0.2,
        time,
        gain,
      );
  }
}

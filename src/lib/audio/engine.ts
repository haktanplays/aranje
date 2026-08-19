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
import * as Tone from "tone";

import { isDrumInstrument } from "@/lib/instruments/registry";
import { samplePackFor } from "@/lib/audio/packs";
import { buildSongPlan, ticks, type SongPlan } from "@/lib/audio/schedule";
import type { DrumPiece, Song, Track } from "@/lib/song/schema";

/** Anything that can host the graph: a live context or an offline one. */
export type AudioRuntime = Tone.BaseContext;

export type DrumVoices = {
  kick: Tone.MembraneSynth;
  snare: Tone.NoiseSynth;
  hat: Tone.NoiseSynth;
  cymbal: Tone.NoiseSynth;
  filters: Tone.Filter[];
};

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
};

/** Kick, snare, hats and cymbals from the allowed synth nodes (spec 8.1). */
function buildDrums(
  context: AudioRuntime,
  destination: Tone.InputNode,
): DrumVoices {
  const kick = new Tone.MembraneSynth({
    context,
    volume: -5,
    pitchDecay: 0.04,
    octaves: 6,
    envelope: { attack: 0.001, decay: 0.28, sustain: 0 },
  });
  kick.connect(destination);

  const snareFilter = new Tone.Filter({
    context,
    frequency: 1800,
    type: "highpass",
  });
  snareFilter.connect(destination);
  const snare = new Tone.NoiseSynth({
    context,
    volume: -11,
    envelope: { attack: 0.001, decay: 0.14, sustain: 0 },
  });
  snare.connect(snareFilter);

  const hatFilter = new Tone.Filter({
    context,
    frequency: 7000,
    type: "highpass",
  });
  hatFilter.connect(destination);
  const hat = new Tone.NoiseSynth({
    context,
    volume: -21,
    envelope: { attack: 0.001, decay: 0.035, sustain: 0 },
  });
  hat.connect(hatFilter);

  const cymbalFilter = new Tone.Filter({
    context,
    frequency: 5200,
    type: "highpass",
  });
  cymbalFilter.connect(destination);
  const cymbal = new Tone.NoiseSynth({
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
  context: AudioRuntime,
  track: Track,
  master: Tone.Gain,
): VoiceBuild | null {
  const channel = new Tone.Channel({ context, volume: track.volumeDb });
  if (track.pan !== undefined) channel.pan.value = track.pan;
  if (track.muted) channel.mute = true;
  channel.connect(master);

  if (isDrumInstrument(track.instrumentId)) {
    return {
      voice: {
        kind: "drums",
        trackId: track.id,
        drums: buildDrums(context, channel),
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
  const loaded = new Promise<void>((resolve) => {
    settle = resolve;
  });

  const sampler = new Tone.Sampler({
    context,
    urls: pack.urls,
    baseUrl: pack.baseUrl,
    volume: pack.trimDb,
    // Fires once every buffer of this sampler has decoded.
    onload: () => settle(),
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

  const master = new Tone.Gain({ context, gain: 1 });
  master.connect(context.destination);

  const voices = new Map<string, TrackVoice>();
  const meters = new Map<string, Tone.Meter>();
  const loads: Promise<void>[] = [];

  for (const track of song.tracks) {
    if (excluded.has(track.id)) continue;
    const built = buildVoice(context, track, master);
    if (!built) continue;

    voices.set(track.id, built.voice);
    loads.push(built.loaded);

    if (options.debug) {
      const meter = new Tone.Meter({ context, smoothing: 0.6 });
      built.voice.channel.connect(meter);
      meters.set(track.id, meter);
    }
  }

  // Await these samplers, not a global download registry.
  await Promise.all(loads);

  const samplers = [...voices.values()].filter(
    (voice) => voice.kind === "sampler",
  );
  const expectedBuffers = samplers.reduce(
    (total, voice) => total + (voice.kind === "sampler" ? voice.bufferCount : 0),
    0,
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
  // Spec 8.3: the context may only be started inside a user gesture.
  await Tone.start();
  return createEngine(song, Tone.getContext(), options);
}

/**
 * Places every event of the plan on the engine's own transport. Times are
 * ticks derived from note values, so a tempo change rescales them for free.
 */
export function scheduleSong(engine: Engine, bpm: number): number {
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

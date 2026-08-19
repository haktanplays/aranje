/**
 * Tone.js signal graph and transport wiring (spec 8).
 *
 * Only the proven nodes are used: Sampler, MembraneSynth, NoiseSynth, Filter,
 * Channel, Gain, Destination and Meter. Reverb, PluckSynth, FMSynth, Convolver
 * and worklet chains stay out.
 *
 * Every track gets its own Channel and all channels meet at one master Gain.
 * Scheduling is done with note-derived tick values, never with seconds, and
 * Tone.start() is the caller's job so it can happen inside a user gesture.
 */
import * as Tone from "tone";

import { isDrumInstrument } from "@/lib/instruments/registry";
import { samplePackFor } from "@/lib/audio/packs";
import { buildSongPlan, ticks, type SongPlan } from "@/lib/audio/schedule";
import type { DrumPiece, Song, Track } from "@/lib/song/schema";

export type DrumVoices = {
  kick: Tone.MembraneSynth;
  snare: Tone.NoiseSynth;
  hat: Tone.NoiseSynth;
  cymbal: Tone.NoiseSynth;
  nodes: (Tone.Filter | Tone.Gain)[];
};

export type TrackVoice =
  | { kind: "sampler"; trackId: string; sampler: Tone.Sampler; channel: Tone.Channel }
  | { kind: "drums"; trackId: string; drums: DrumVoices; channel: Tone.Channel };

export type Engine = {
  master: Tone.Gain;
  voices: Map<string, TrackVoice>;
  meters: Map<string, Tone.Meter>;
  plan: SongPlan;
  dispose(): void;
};

/** Kick, snare, hats and cymbals from the allowed synth nodes (spec 8.1). */
function buildDrums(destination: Tone.InputNode): DrumVoices {
  const kick = new Tone.MembraneSynth({
    pitchDecay: 0.04,
    octaves: 6,
    envelope: { attack: 0.001, decay: 0.28, sustain: 0 },
  });
  kick.volume.value = -5;
  kick.connect(destination);

  const snareFilter = new Tone.Filter(1800, "highpass");
  snareFilter.connect(destination);
  const snare = new Tone.NoiseSynth({
    envelope: { attack: 0.001, decay: 0.14, sustain: 0 },
  });
  snare.volume.value = -11;
  snare.connect(snareFilter);

  const hatFilter = new Tone.Filter(7000, "highpass");
  hatFilter.connect(destination);
  const hat = new Tone.NoiseSynth({
    envelope: { attack: 0.001, decay: 0.035, sustain: 0 },
  });
  hat.volume.value = -21;
  hat.connect(hatFilter);

  const cymbalFilter = new Tone.Filter(5200, "highpass");
  cymbalFilter.connect(destination);
  const cymbal = new Tone.NoiseSynth({
    envelope: { attack: 0.002, decay: 1.1, sustain: 0 },
  });
  cymbal.volume.value = -19;
  cymbal.connect(cymbalFilter);

  return {
    kick,
    snare,
    hat,
    cymbal,
    nodes: [snareFilter, hatFilter, cymbalFilter],
  };
}

/** Builds the graph for one track. */
function buildVoice(track: Track, master: Tone.Gain): TrackVoice | null {
  const channel = new Tone.Channel({ volume: track.volumeDb });
  if (track.pan !== undefined) channel.pan.value = track.pan;
  if (track.muted) channel.mute = true;
  channel.connect(master);

  if (isDrumInstrument(track.instrumentId)) {
    return { kind: "drums", trackId: track.id, drums: buildDrums(channel), channel };
  }

  const pack = samplePackFor(track.instrumentId, track.presetId);
  if (!pack) {
    channel.dispose();
    return null;
  }

  const sampler = new Tone.Sampler({ urls: pack.urls, baseUrl: pack.baseUrl });
  sampler.volume.value = pack.trimDb;
  sampler.connect(channel);
  return { kind: "sampler", trackId: track.id, sampler, channel };
}

export type CreateEngineOptions = {
  debug?: boolean;
  /**
   * Where the master gain lands. Defaults to the destination of whichever
   * context is current, which matters because an offline render swaps the
   * context underneath us.
   */
  destination?: Tone.InputNode;
};

/**
 * Builds the graph and waits for every sample to decode. The caller is
 * responsible for having started the audio context first.
 */
export async function createEngine(
  song: Song,
  options: CreateEngineOptions = {},
): Promise<Engine> {
  const master = new Tone.Gain(1);
  // Tone's `Destination` and `Transport` exports bind to the context that was
  // current when the module was imported. The accessors resolve the context
  // that is current now, which is what an offline render needs.
  master.connect(options.destination ?? Tone.getDestination());

  const voices = new Map<string, TrackVoice>();
  const meters = new Map<string, Tone.Meter>();

  for (const track of song.tracks) {
    const voice = buildVoice(track, master);
    if (!voice) continue;
    voices.set(track.id, voice);
    if (options.debug) {
      const meter = new Tone.Meter({ smoothing: 0.6 });
      voice.channel.connect(meter);
      meters.set(track.id, meter);
    }
  }

  await Tone.loaded();

  return {
    master,
    voices,
    meters,
    plan: buildSongPlan(song),
    dispose() {
      for (const voice of voices.values()) {
        if (voice.kind === "sampler") voice.sampler.dispose();
        else {
          voice.drums.kick.dispose();
          voice.drums.snare.dispose();
          voice.drums.hat.dispose();
          voice.drums.cymbal.dispose();
          for (const node of voice.drums.nodes) node.dispose();
        }
        voice.channel.dispose();
      }
      for (const meter of meters.values()) meter.dispose();
      master.dispose();
    },
  };
}

/**
 * Places every event of the plan on the transport. Times are ticks derived
 * from note values, so a tempo change rescales them for free.
 */
export function scheduleSong(
  engine: Engine,
  bpm: number,
  transport: ReturnType<typeof Tone.getTransport> = Tone.getTransport(),
): number {
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

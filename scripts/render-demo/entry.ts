/**
 * Offline render of the demo song, used to produce a listenable preview before
 * any transport UI exists.
 *
 * This runs the real engine and the real scheduling core. The only thing that
 * differs from live playback is the context, which Tone.Offline hands to the
 * callback and which is passed straight through to the engine.
 */
import * as Tone from "tone";

import { styleExampleSongs } from "@/lib/copilot/style-examples";
import { createEngine, scheduleSong } from "@/lib/audio/engine";
import { drumTrackIds, melodicTrackIds } from "@/lib/audio/tracks";
import { PPQ, buildSongPlan } from "@/lib/audio/schedule";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import type { Song } from "@/lib/song/schema";

function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const channelCount = channels.length;
  const frames = channels[0]?.length ?? 0;
  const dataBytes = frames * channelCount * 2;
  const view = new DataView(new ArrayBuffer(44 + dataBytes));

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = channels[channel]?.[frame] ?? 0;
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, Math.round(clamped * 32767), true);
      offset += 2;
    }
  }

  return new Uint8Array(view.buffer);
}

export type RenderVariant = "full" | "melodic" | "drums";

function excludedFor(song: Song, variant: RenderVariant): string[] {
  if (variant === "melodic") return drumTrackIds(song);
  if (variant === "drums") return melodicTrackIds(song);
  return [];
}

export async function renderVariant(variant: RenderVariant = "full") {
  const song = SAMPLE_SONG;
  const plan = buildSongPlan(song);
  const seconds = (plan.totalTicks / PPQ) * (60 / song.bpm) + 2.5;
  const excludeTrackIds = excludedFor(song, variant);

  const diagnostics: Record<string, unknown> = { variant, excludeTrackIds };

  const buffer = await Tone.Offline(async (context) => {
    // The engine only ever sees this context: nodes are built on it, the
    // master lands on its destination, and events go on its transport.
    const engine = await createEngine(song, context, { excludeTrackIds });

    diagnostics.contextIsOffline = context.isOffline;
    diagnostics.expectedBuffers = engine.expectedBuffers;
    diagnostics.loadedBuffers = engine.loadedBuffers;
    diagnostics.voices = [...engine.voices.values()].map((voice) => ({
      trackId: voice.trackId,
      kind: voice.kind,
      loaded: voice.kind === "sampler" ? voice.sampler.loaded : null,
    }));

    // Samples are decoded by the time createEngine resolves, so scheduling and
    // starting the transport happen strictly afterwards.
    diagnostics.scheduledTicks = scheduleSong(engine, song.bpm);
    context.transport.start(0);
  }, seconds);

  const raw = buffer.toArray() as Float32Array | Float32Array[];
  const list = Array.isArray(raw) ? raw : [raw];

  let peak = 0;
  let sumSquares = 0;
  let samples = 0;
  for (const channel of list) {
    for (const value of channel) {
      peak = Math.max(peak, Math.abs(value));
      sumSquares += value * value;
      samples += 1;
    }
  }

  const secondsPerBar =
    (plan.bars[0]?.durationTicks ?? PPQ * 4) / PPQ / (song.bpm / 60);
  const barLevels = plan.bars.map((bar, index) => {
    const from = Math.floor(index * secondsPerBar * buffer.sampleRate);
    const to = Math.floor((index + 1) * secondsPerBar * buffer.sampleRate);
    let sum = 0;
    let count = 0;
    for (const channel of list) {
      for (let i = from; i < to && i < channel.length; i += 1) {
        sum += (channel[i] ?? 0) ** 2;
        count += 1;
      }
    }
    return { bar: index + 1, rms: Math.sqrt(sum / Math.max(1, count)) };
  });

  const playedEvents = plan.events.filter(
    (event) => !excludeTrackIds.includes(event.trackId),
  ).length;

  const wav = encodeWav(list, buffer.sampleRate);
  let binary = "";
  for (const byte of wav) binary += String.fromCharCode(byte);

  return {
    variant,
    wavBase64: btoa(binary),
    sampleRate: buffer.sampleRate,
    channels: list.length,
    seconds: buffer.duration,
    peak,
    rms: Math.sqrt(sumSquares / Math.max(1, samples)),
    events: playedEvents,
    barLevels,
    diagnostics,
  };
}

/** Renders one track alone, to prove nothing is silently missing. */
export async function renderSolo(trackId: string) {
  const song = SAMPLE_SONG;
  const plan = buildSongPlan(song);
  const seconds = (plan.totalTicks / PPQ) * (60 / song.bpm) + 2.5;
  const excludeTrackIds = song.tracks
    .map((track) => track.id)
    .filter((id) => id !== trackId);

  const buffer = await Tone.Offline(async (context) => {
    const engine = await createEngine(song, context, { excludeTrackIds });
    scheduleSong(engine, song.bpm);
    context.transport.start(0);
  }, seconds);

  const raw = buffer.toArray() as Float32Array | Float32Array[];
  const list = Array.isArray(raw) ? raw : [raw];
  let peak = 0;
  let sumSquares = 0;
  let samples = 0;
  for (const channel of list) {
    for (const value of channel) {
      peak = Math.max(peak, Math.abs(value));
      sumSquares += value * value;
      samples += 1;
    }
  }

  const wav = encodeWav(list, buffer.sampleRate);
  let binary = "";
  for (const byte of wav) binary += String.fromCharCode(byte);

  return {
    trackId,
    wavBase64: btoa(binary),
    peak,
    rms: Math.sqrt(sumSquares / Math.max(1, samples)),
    events: plan.events.filter((event) => event.trackId === trackId).length,
  };
}

/**
 * Render one style card example on its own (spec 11.7, phase 2C).
 *
 * The same engine, the same samples and the same scheduler as everything
 * else: no new sample pack and no synth fallback. These are listening
 * outputs for the owner, not an automated judgement of anything musical.
 */
export async function renderStyleExample(
  bodies: Record<string, string>,
  index: number,
) {
  const examples = styleExampleSongs(bodies);
  const example = examples[index];
  if (!example) throw new Error(`no style example at index ${index}`);

  const song = example.song;
  const plan = buildSongPlan(song);
  const seconds = (plan.totalTicks / PPQ) * (60 / song.bpm) + 2.5;

  const buffer = await Tone.Offline(async (context) => {
    const engine = await createEngine(song, context);
    scheduleSong(engine, song.bpm);
    context.transport.start(0);
  }, seconds);

  const raw = buffer.toArray() as Float32Array | Float32Array[];
  const list = Array.isArray(raw) ? raw : [raw];

  let peak = 0;
  let sumSquares = 0;
  let samples = 0;
  for (const channel of list) {
    for (const value of channel) {
      peak = Math.max(peak, Math.abs(value));
      sumSquares += value * value;
      samples += 1;
    }
  }

  const wav = encodeWav(list, buffer.sampleRate);
  let binary = "";
  for (const byte of wav) binary += String.fromCharCode(byte);

  return {
    id: example.id,
    cardId: example.cardId,
    exampleIndex: example.exampleIndex,
    targetTrackId: example.targetTrackId,
    wavBase64: btoa(binary),
    sampleRate: buffer.sampleRate,
    channels: list.length,
    seconds: buffer.duration,
    peak,
    rms: Math.sqrt(sumSquares / Math.max(1, samples)),
    events: plan.events.length,
  };
}

declare global {
  interface Window {
    aranjeRenderVariant: typeof renderVariant;
    aranjeRenderSolo: typeof renderSolo;
    aranjeRenderStyleExample: typeof renderStyleExample;
    aranjeTrackIds: string[];
  }
}

window.aranjeRenderVariant = renderVariant;
window.aranjeRenderSolo = renderSolo;
window.aranjeRenderStyleExample = renderStyleExample;
window.aranjeTrackIds = SAMPLE_SONG.tracks.map((track) => track.id);

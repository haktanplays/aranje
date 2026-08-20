/**
 * Offline renderer for the shadow eval. Evaluation only.
 *
 * The same engine, scheduler, planner and samples as live playback; the only
 * thing that differs is the context, which `Tone.Offline` supplies. Nothing
 * here is reachable from the app, and it renders the eval's own song rather
 * than the product demo.
 *
 * Nine cuts: the whole piece, each section on its own, and each track on its
 * own. A section cut is a song containing only that section, which is what a
 * section preview already does; a track cut excludes every other track at
 * engine build time.
 */
import * as Tone from "tone";

import { createEngine, scheduleSong } from "@/lib/audio/engine";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { PPQ, buildSongPlan } from "@/lib/audio/schedule";
import { buildTempoMap, secondsAtTicks } from "@/lib/audio/tempo";
import { songSchema, type Song } from "@/lib/song/schema";
import FINAL from "./artifacts/final-song.json";

const SONG: Song = songSchema.parse(FINAL);

function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const channelCount = channels.length;
  const frames = channels[0]?.length ?? 0;
  const dataBytes = frames * channelCount * 2;
  const view = new DataView(new ArrayBuffer(44 + dataBytes));
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF"); view.setUint32(4, 36 + dataBytes, true); ascii(8, "WAVE");
  ascii(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true); view.setUint16(34, 16, true);
  ascii(36, "data"); view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = channels[channel]?.[frame] ?? 0;
      view.setInt16(offset, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true);
      offset += 2;
    }
  }
  return new Uint8Array(view.buffer);
}

export type Cut = {
  id: string;
  /** Section id to isolate, or null for the whole piece. */
  sectionId: string | null;
  /** Track id to isolate, or null for every track. */
  trackId: string | null;
};

export const CUTS: readonly Cut[] = [
  { id: "shadow-s02-full-mix", sectionId: null, trackId: null },
  { id: "shadow-s02-break", sectionId: "sec-1", trackId: null },
  { id: "shadow-s02-heavy-bridge", sectionId: "sec-2", trackId: null },
  { id: "shadow-s02-solo", sectionId: "sec-3", trackId: null },
  { id: "shadow-s02-acoustic-outro", sectionId: "sec-4", trackId: null },
  { id: "shadow-s02-rhythm-guitar", sectionId: null, trackId: "rhythm_guitar" },
  { id: "shadow-s02-lead-guitar", sectionId: null, trackId: "lead_guitar" },
  { id: "shadow-s02-drums", sectionId: null, trackId: "drums" },
  { id: "shadow-s02-acoustic", sectionId: null, trackId: "acoustic_guitar" },
];

function songFor(cut: Cut): Song {
  if (cut.sectionId === null) return SONG;
  return {
    ...SONG,
    sections: SONG.sections.filter((section) => section.id === cut.sectionId),
  };
}

export async function renderCut(index: number) {
  const cut = CUTS[index];
  if (!cut) throw new Error(`no cut at ${index}`);

  const song = songFor(cut);
  const plan = buildSongPlan(song);
  const expression = buildExpressionPlan(song);
  // The tempo map, not the global tempo: a song may change tempo, and
  // the old formula truncated whatever ran slower (spec 8.3, K-25).
  const seconds = buildTempoMap(song).totalSeconds + 2.5;
  const excludeTrackIds =
    cut.trackId === null
      ? []
      : song.tracks.map((track) => track.id).filter((id) => id !== cut.trackId);

  let requests = 0;
  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/samples/")) requests += 1;
    return originalFetch(input as RequestInfo, init);
  }) as typeof window.fetch;

  const diagnostics: Record<string, unknown> = {};
  let engineBuilds = 0;

  const buffer = await Tone.Offline(async (context) => {
    // Built exactly once per render; a second build would show here.
    engineBuilds += 1;
    const engine = await createEngine(song, context, { excludeTrackIds });
    scheduleSong(engine, buildTempoMap(song));
    context.transport.start(0);

    diagnostics.expectedBuffers = engine.expectedBuffers;
    diagnostics.loadedBuffers = engine.loadedBuffers;
    diagnostics.engine = engine;
  }, seconds);

  window.fetch = originalFetch;

  const engine = diagnostics.engine as {
    expression: { counts: Record<string, number> };
    dispose(): void;
  };
  diagnostics.countsAtEnd = { ...engine.expression.counts };
  engine.dispose();
  diagnostics.countsAfterDispose = { ...engine.expression.counts };
  delete diagnostics.engine;

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

  const events =
    cut.trackId === null
      ? plan.events.length
      : plan.events.filter((event) => event.trackId === cut.trackId).length;
  const notes =
    cut.trackId === null
      ? expression.notes
      : expression.notes.filter((note) => note.trackId === cut.trackId);

  // Where each section begins in the full mix.
  const sectionStarts: Record<string, number> = {};
  const tempoMap = buildTempoMap(song);
  let tick = 0;
  for (const section of song.sections) {
    sectionStarts[section.name] = secondsAtTicks(tempoMap, tick);
    for (const bar of section.bars) {
      tick += (PPQ * 4 * bar.timeSignature[0]) / bar.timeSignature[1];
    }
  }

  const wav = encodeWav(list, buffer.sampleRate);
  let binary = "";
  for (const byte of wav) binary += String.fromCharCode(byte);

  return {
    id: cut.id,
    wavBase64: btoa(binary),
    seconds: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: list.length,
    peak,
    rms: Math.sqrt(sumSquares / Math.max(1, samples)),
    events,
    expressiveVoices: notes.filter((note) => note.expressive).length,
    fallbacks: notes.filter((note) => note.fallbackReason !== undefined).length,
    chains: expression.chains.filter(
      (chain) => cut.trackId === null || chain.trackId === cut.trackId,
    ).length,
    sampleRequests: requests,
    engineBuilds,
    sectionStarts,
    diagnostics,
  };
}

declare global {
  interface Window {
    aranjeS02RenderCut: typeof renderCut;
    aranjeS02CutCount: number;
  }
}
window.aranjeS02RenderCut = renderCut;
window.aranjeS02CutCount = CUTS.length;

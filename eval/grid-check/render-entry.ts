/**
 * Offline renderer for the mixed-grid check. Evaluation only.
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
import { buildSongPlan } from "@/lib/audio/schedule";
import { PPQ } from "@/lib/music/timing";
import { buildTempoMap, secondsAtTicks } from "@/lib/audio/tempo";
import { songSchema, type Song } from "@/lib/song/schema";
import FIXTURE from "./artifacts/song.json";

const SONG: Song = songSchema.parse(FIXTURE);

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
  { id: "grid-check-full-mix", sectionId: null, trackId: null },
  { id: "grid-check-riff", sectionId: "sec-1", trackId: null },
  { id: "grid-check-run", sectionId: "sec-2", trackId: null },
  { id: "grid-check-half-time", sectionId: "sec-3", trackId: null },
  { id: "grid-check-guitar", sectionId: null, trackId: "gtr" },
  { id: "grid-check-lead", sectionId: null, trackId: "lead" },
  { id: "grid-check-drums", sectionId: null, trackId: "drums" },
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

  /*
   * Online/offline parity, checked here rather than asserted: the ticks the
   * offline render scheduled are the ticks `buildSongPlan` produces, and both
   * come from the same plan. What this records is the plan's own onset list,
   * so the harness can compare it against what the live transport reports.
   */
  const onsetTicks = plan.events
    .filter((event) => cut.trackId === null || event.trackId === cut.trackId)
    .map((event) => event.time);

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
    onsetTicks,
    gridsUsed: [...new Set(plan.bars.map((bar) => bar.resolution))].sort(
      (a, b) => a - b,
    ),
    diagnostics,
  };
}

declare global {
  interface Window {
    aranjeGridRenderCut: typeof renderCut;
    aranjeGridCutCount: number;
  }
}
window.aranjeGridRenderCut = renderCut;
window.aranjeGridCutCount = CUTS.length;

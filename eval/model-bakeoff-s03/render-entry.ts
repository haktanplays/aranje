/**
 * Offline renderer for the bake-off. Evaluation only.
 *
 * The same engine, scheduler, planner and samples as live playback; only the
 * context differs, which `Tone.Offline` supplies. Nothing here is reachable
 * from the app, and the cut names carry the blind candidate letter — never a
 * model name — because these files are what the listener hears.
 *
 * A cut can isolate a section, a track, or both: "the solo with only the
 * backing guitar in it" is the cut that answers whether the backing is
 * audible under the lead, which is a mix question the listener asked about
 * and which a full mix cannot show.
 */
import * as Tone from "tone";

import { createEngine, scheduleSong } from "@/lib/audio/engine";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { buildSongPlan } from "@/lib/audio/schedule";
import { buildTempoMap, secondsAtTicks } from "@/lib/audio/tempo";
import { instrumentFamily } from "@/lib/instruments/registry";
import { PPQ } from "@/lib/music/timing";
import { songSchema, type Song } from "@/lib/song/schema";

/*
 * The songs are handed in at run time rather than imported.
 *
 * A run that did not finish has no final song, and a renderer that imports
 * one cannot even be type-checked until it does — which would make the
 * harness un-compilable exactly when something has gone wrong with the run.
 * The driver loads whichever candidates exist and says which.
 */
const SONGS: Partial<Record<"a" | "b", Song>> = {};

export function loadCandidate(candidate: "a" | "b", raw: unknown): void {
  SONGS[candidate] = songSchema.parse(raw);
  CUTS = [...cutsFor("a"), ...cutsFor("b")];
}

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
  candidate: "a" | "b";
  sectionId: string | null;
  trackId: string | null;
};

/** The section playing a given form role, by the order the piece is in. */
function sectionAt(song: Song, index: number): string | null {
  return song.sections[index]?.id ?? null;
}

function trackByRole(song: Song, wanted: "lead" | "rhythm" | "acoustic" | "drums"): string | null {
  const byId = (fragment: string) =>
    song.tracks.find((track) => track.id.includes(fragment))?.id ?? null;
  if (wanted === "drums") {
    return song.tracks.find((track) => instrumentFamily(track.instrumentId) === "drums")?.id ?? null;
  }
  return byId(wanted);
}

function cutsFor(candidate: "a" | "b"): Cut[] {
  const song = SONGS[candidate];
  if (!song) return [];
  const cuts: Cut[] = [
    { id: `candidate-${candidate}-full-mix`, candidate, sectionId: null, trackId: null },
  ];

  // Sections in playing order, named by position so the two candidates line
  // up even if they planned different display names.
  const labels = ["break", "bridge", "solo", "acoustic-outro"];
  labels.forEach((label, index) => {
    const sectionId = sectionAt(song, index);
    if (sectionId) {
      cuts.push({ id: `candidate-${candidate}-${label}`, candidate, sectionId, trackId: null });
    }
  });

  // The solo, stem by stem: the mix question the listener asked about.
  const soloSection = sectionAt(song, 2);
  const lead = trackByRole(song, "lead");
  const rhythm = trackByRole(song, "rhythm");
  if (soloSection && lead) {
    cuts.push({ id: `candidate-${candidate}-solo-lead`, candidate, sectionId: soloSection, trackId: lead });
  }
  if (soloSection && rhythm) {
    cuts.push({ id: `candidate-${candidate}-solo-backing`, candidate, sectionId: soloSection, trackId: rhythm });
  }

  const drums = trackByRole(song, "drums");
  if (drums) {
    cuts.push({ id: `candidate-${candidate}-drums`, candidate, sectionId: null, trackId: drums });
  }

  return cuts;
}

export let CUTS: readonly Cut[] = [];

function songFor(cut: Cut): Song {
  const song = SONGS[cut.candidate];
  if (!song) throw new Error(`candidate ${cut.candidate} was never loaded`);
  if (cut.sectionId === null) return song;
  return { ...song, sections: song.sections.filter((section) => section.id === cut.sectionId) };
}

export async function renderCut(index: number) {
  const cut = CUTS[index];
  if (!cut) throw new Error(`no cut at ${index}`);

  const song = songFor(cut);
  const plan = buildSongPlan(song);
  const expression = buildExpressionPlan(song);
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
  const perChannelRms: number[] = [];
  for (const channel of list) {
    let channelSquares = 0;
    for (const value of channel) {
      peak = Math.max(peak, Math.abs(value));
      sumSquares += value * value;
      channelSquares += value * value;
      samples += 1;
    }
    perChannelRms.push(Math.sqrt(channelSquares / Math.max(1, channel.length)));
  }

  const events =
    cut.trackId === null
      ? plan.events.length
      : plan.events.filter((event) => event.trackId === cut.trackId).length;
  const notes =
    cut.trackId === null
      ? expression.notes
      : expression.notes.filter((note) => note.trackId === cut.trackId);

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
    candidate: cut.candidate,
    wavBase64: btoa(binary),
    seconds: buffer.duration,
    sampleRate: buffer.sampleRate,
    channels: list.length,
    peak,
    rms: Math.sqrt(sumSquares / Math.max(1, samples)),
    perChannelRms,
    events,
    expressiveVoices: notes.filter((note) => note.expressive).length,
    fallbacks: notes.filter((note) => note.fallbackReason !== undefined).length,
    chains: expression.chains.filter(
      (chain) => cut.trackId === null || chain.trackId === cut.trackId,
    ).length,
    sampleRequests: requests,
    engineBuilds,
    sectionStarts,
    onsetTicks: plan.events
      .filter((event) => cut.trackId === null || event.trackId === cut.trackId)
      .map((event) => event.time),
    diagnostics,
  };
}

declare global {
  interface Window {
    aranjeBakeoffLoad: typeof loadCandidate;
    aranjeBakeoffRenderCut: typeof renderCut;
    aranjeBakeoffCutIds: () => string[];
  }
}
window.aranjeBakeoffLoad = loadCandidate;
window.aranjeBakeoffRenderCut = renderCut;
window.aranjeBakeoffCutIds = () => CUTS.map((cut) => cut.id);

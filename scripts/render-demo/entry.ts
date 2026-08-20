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
import {
  BEND_DEMOS,
  EXPRESSION_DEMOS,
  LEGATO_DEMOS,
  SLIDE_DEMOS,
  type ExpressionDemo,
} from "@/lib/audio/expression-demos";
import { bendStages, buildExpressionPlan } from "@/lib/audio/expression-plan";
import { desiredGlideSeconds } from "@/lib/audio/legato-chain";
import { createEngine, scheduleSong } from "@/lib/audio/engine";
import { drumTrackIds, melodicTrackIds } from "@/lib/audio/tracks";
import { buildSongPlan } from "@/lib/audio/schedule";
import { PPQ } from "@/lib/music/timing";
import { buildTempoMap } from "@/lib/audio/tempo";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { songSchema, type Song } from "@/lib/song/schema";

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
  // The tempo map, not the global tempo: a song may change tempo, and
  // the old formula truncated whatever ran slower (spec 8.3, K-25).
  const seconds = buildTempoMap(song).totalSeconds + 2.5;
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
    diagnostics.scheduledTicks = scheduleSong(engine, buildTempoMap(song));
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
  // The tempo map, not the global tempo: a song may change tempo, and
  // the old formula truncated whatever ran slower (spec 8.3, K-25).
  const seconds = buildTempoMap(song).totalSeconds + 2.5;
  const excludeTrackIds = song.tracks
    .map((track) => track.id)
    .filter((id) => id !== trackId);

  const buffer = await Tone.Offline(async (context) => {
    const engine = await createEngine(song, context, { excludeTrackIds });
    scheduleSong(engine, buildTempoMap(song));
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
  // The tempo map, not the global tempo: a song may change tempo, and
  // the old formula truncated whatever ran slower (spec 8.3, K-25).
  const seconds = buildTempoMap(song).totalSeconds + 2.5;

  const buffer = await Tone.Offline(async (context) => {
    const engine = await createEngine(song, context);
    scheduleSong(engine, buildTempoMap(song));
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
    aranjeRenderExpressionDemo: typeof renderExpressionDemo;
    aranjeExpressionDemoCount: number;
    aranjeLegatoDemoCount: number;
    aranjeBendDemoCount: number;
    aranjeSlideDemoCount: number;
    aranjeTrackIds: string[];
  }
}

window.aranjeRenderVariant = renderVariant;
window.aranjeRenderSolo = renderSolo;
window.aranjeRenderStyleExample = renderStyleExample;
window.aranjeTrackIds = SAMPLE_SONG.tracks.map((track) => track.id);
window.aranjeExpressionDemoCount = EXPRESSION_DEMOS.length;

/**
 * Render one expression A/B case (spec 8.5, phase 2F).
 *
 * The same engine, the same samples, the same scheduler and the same planner
 * as live playback. What is measured alongside the audio is what a listener
 * cannot hear: how many voices were opened, whether any survived the end, how
 * many sample requests the engine made, and how far the pitch was actually
 * moved. None of it is a judgement about how it sounds.
 */
export async function renderExpressionDemo(index: number, pack: DemoPack = "expression") {
  const demos = demoPack(pack);
  const demo = demos[index];
  if (!demo) throw new Error(`no ${pack} demo at index ${index}`);

  const song = demo.song;
  const options = demo.options ?? {};
  const plan = buildSongPlan(song);
  const expression = buildExpressionPlan(song, options);
  // The tempo map, not the global tempo: a song may change tempo, and
  // the old formula truncated whatever ran slower (spec 8.3, K-25).
  const seconds = buildTempoMap(song).totalSeconds + 2.5;

  let requests = 0;
  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/samples/")) requests += 1;
    return originalFetch(input as RequestInfo, init);
  }) as typeof window.fetch;

  const diagnostics: Record<string, unknown> = {};

  const buffer = await Tone.Offline(async (context) => {
    const engine = await createEngine(song, context);
    // Render comparisons plan differently; live playback never does.
    engine.expression.setPlan(buildExpressionPlan(song, options));
    scheduleSong(engine, buildTempoMap(song));
    context.transport.start(0);

    diagnostics.expectedBuffers = engine.expectedBuffers;
    diagnostics.loadedBuffers = engine.loadedBuffers;
    diagnostics.plannedNotes = engine.expression.getPlan().notes.length;
    diagnostics.expressiveNotes = engine.expression.getPlan().expressiveNotes;
    diagnostics.fallbacks = engine.expression.getPlan().fallbacks;

    // Read after the render finishes, so a voice that outlived the music shows.
    context.transport.scheduleOnce(() => {
      diagnostics.voicesAtEnd = engine.expression.counts.active;
      diagnostics.voicesStarted = engine.expression.counts.started;
      diagnostics.voicesDisposed = engine.expression.counts.disposed;
    }, `${Math.max(1, plan.totalTicks)}i`);

    diagnostics.engine = engine;
  }, seconds);

  window.fetch = originalFetch;

  const engine = diagnostics.engine as {
    expression: { counts: { active: number; started: number; disposed: number } };
    dispose(): void;
  };
  diagnostics.countsAtEnd = { ...engine.expression.counts };
  // Disposing after the render proves nothing survives the engine.
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

  const cents = expression.notes.flatMap((note) =>
    note.pitchAutomation.map((point) => point.cents),
  );
  const chainCents = expression.chains.flatMap((chain) =>
    chain.transitions.flatMap((entry) => [0, entry.cumulativeCents]),
  );
  const allCents = [...cents, ...chainCents];

  /**
   * Peak and level in a short window around the second onset.
   *
   * This is where a restrike and a slur differ: a restrike puts a fresh attack
   * there, a hammer-on does not.
   */
  const secondOnset = [...expression.notes]
    .map((note) => note.startSeconds)
    .filter((start) => start > 0)
    .sort((a, b) => a - b)[0];
  const onsetWindow = { peak: 0, rms: 0, atSeconds: secondOnset ?? 0 };
  if (secondOnset !== undefined) {
    const from = Math.floor((secondOnset - 0.01) * buffer.sampleRate);
    const to = Math.floor((secondOnset + 0.09) * buffer.sampleRate);
    let sum = 0;
    let count = 0;
    for (const channel of list) {
      for (let i = Math.max(0, from); i < to && i < channel.length; i += 1) {
        const value = channel[i] ?? 0;
        onsetWindow.peak = Math.max(onsetWindow.peak, Math.abs(value));
        sum += value * value;
        count += 1;
      }
    }
    onsetWindow.rms = Math.sqrt(sum / Math.max(1, count));
  }

  const bendNote = expression.notes.find(
    (note) => note.articulation === "bend_half" || note.articulation === "bend_full",
  );
  // The planned stages describe v2. What was actually rendered is read back off
  // the automation, so a legacy comparison reports its own timing rather than
  // borrowing v2's (spec 8.5, K-22).
  const stages = bendNote ? bendStages(bendNote.durationSeconds) : null;
  const bendCurve = bendNote?.pitchAutomation ?? [];
  const bendPeak = bendCurve.length === 0 ? 0 : Math.max(...bendCurve.map((p) => p.cents));
  const reachedAt = bendCurve.find((point) => point.cents === bendPeak)?.timeSeconds ?? null;
  const returnedAt =
    bendCurve.length === 0
      ? null
      : bendCurve[bendCurve.length - 1]?.cents === 0
        ? bendCurve[bendCurve.length - 1]?.timeSeconds ?? null
        : null;

  /**
   * What each slide actually did, in the plan the render used.
   *
   * A slide is the one articulation whose *timing* is the claim being made, so
   * both ends of the travel are reported: where the hand set off and where it
   * arrived. The arrival is checked against the target note's own written
   * start, because that is what phase 2F.2 changed (spec 8.5, K-23).
   */
  const slides = expression.chains.flatMap((chain) =>
    chain.transitions
      .filter((entry) => entry.kind === "slide")
      .map((entry) => {
        const target = expression.notes.find((note) => note.id === entry.noteId);
        const semitones = entry.intervalCents / 100;
        return {
          noteId: entry.noteId,
          fromPitch: entry.fromPitch,
          toPitch: entry.toPitch,
          intervalSemitones: semitones,
          desiredGlideSeconds: desiredGlideSeconds(semitones),
          actualGlideSeconds: entry.transitionSeconds,
          startsAtSeconds: chain.startSeconds + entry.atSeconds,
          arrivesAtSeconds: chain.startSeconds + entry.arrivesAtSeconds,
          targetWrittenStartSeconds: target?.startSeconds ?? null,
          arrivesOnTheWrittenNote:
            target !== undefined &&
            Math.abs(
              chain.startSeconds + entry.arrivesAtSeconds - target.startSeconds,
            ) < 1e-6,
          automationPoints: entry.points.length,
          centsAtArrival: entry.points[entry.points.length - 1]?.cents ?? null,
          /** A target is never struck again; a restrike would show here. */
          targetChainRole: target?.chainRole ?? null,
        };
      }),
  );

  /** The old shape, for the legacy comparison render, which builds no chain. */
  const legacySlideCurve =
    expression.chains.length > 0
      ? null
      : (expression.notes.find((note) => note.articulation === "slide")
          ?.pitchAutomation ?? null);

  const steady = expression.notes.filter(
    (note) =>
      note.articulation === undefined &&
      note.chainId === undefined &&
      note.pitchAutomation.length === 1,
  );

  const wav = encodeWav(list, buffer.sampleRate);
  let binary = "";
  for (const byte of wav) binary += String.fromCharCode(byte);

  return {
    id: demo.id,
    label: demo.label,
    pairsWith: demo.pairsWith,
    wavBase64: btoa(binary),
    sampleRate: buffer.sampleRate,
    channels: list.length,
    seconds: buffer.duration,
    peak,
    rms: Math.sqrt(sumSquares / Math.max(1, samples)),
    events: plan.events.length,
    sampleRequests: requests,
    centsRange:
      allCents.length === 0 ? [0, 0] : [Math.min(...allCents), Math.max(...allCents)],
    chains: expression.chains.length,
    transitions: expression.chains.reduce(
      (total, chain) => total + chain.transitions.length,
      0,
    ),
    transitionSeconds: expression.chains.flatMap((chain) =>
      chain.transitions.map((entry) => entry.transitionSeconds),
    ),
    /** Notes struck with a full-length source of their own. */
    fullRestrikes: expression.notes.filter((note) => note.chainRole !== "target").length,
    secondOnsetWindow: onsetWindow,
    bendStages: stages,
    bendReachedAtSeconds: reachedAt,
    bendReturnedAtSeconds: returnedAt,
    bendPeakCents: bendPeak,
    bendDurationSeconds: bendNote?.durationSeconds ?? null,
    steadyNoteAutomationPoints: steady.map((note) => note.pitchAutomation.length),
    slides,
    legacySlideCurve,
    diagnostics,
  };
}

export type DemoPack = "expression" | "legato" | "bend" | "slide";

function demoPack(pack: DemoPack): readonly ExpressionDemo[] {
  if (pack === "legato") return LEGATO_DEMOS;
  if (pack === "bend") return BEND_DEMOS;
  if (pack === "slide") return SLIDE_DEMOS;
  return EXPRESSION_DEMOS;
}

window.aranjeRenderExpressionDemo = renderExpressionDemo;
window.aranjeLegatoDemoCount = LEGATO_DEMOS.length;
window.aranjeBendDemoCount = BEND_DEMOS.length;
window.aranjeSlideDemoCount = SLIDE_DEMOS.length;

/**
 * Does the transport actually honour a tempo change? (spec 8.3, K-25)
 *
 * Every event is scheduled in ticks and the tempo curve is written onto
 * `transport.bpm`, which means Tone — not us — decides what second a tick
 * lands on. That is an assumption about a library, so it is measured rather
 * than believed: this renders a bar of clicks either side of a tempo change
 * and reports where the attacks actually appear in the audio, against where
 * the pure timeline said they would.
 */
export async function renderTempoProof() {
  const song = songSchema.parse({
    version: 2,
    title: "tempo proof",
    bpm: 120,
    key: "E minor",
    tracks: [SAMPLE_SONG.tracks.find((t) => t.id === "gtr")],
    sections: [
      {
        id: "fast",
        name: "Fast",
        status: "fixed",
        bars: [
          {
            timeSignature: [4, 4],
            resolution: 8,
            slots: {
              gtr: [
                { notes: [{ pitch: "A3", position: { string: 1, fret: 12 } }] },
                null, null, null,
                { notes: [{ pitch: "A3", position: { string: 1, fret: 12 } }] },
                null, null, null,
              ],
            },
          },
        ],
      },
      {
        id: "slow",
        name: "Slow",
        status: "fixed",
        bpmOverride: 60,
        bars: [
          {
            timeSignature: [4, 4],
            resolution: 8,
            slots: {
              gtr: [
                { notes: [{ pitch: "A3", position: { string: 1, fret: 12 } }] },
                null, null, null,
                { notes: [{ pitch: "A3", position: { string: 1, fret: 12 } }] },
                null, null, null,
              ],
            },
          },
        ],
      },
    ],
  });

  const tempo = buildTempoMap(song);
  const expression = buildExpressionPlan(song);
  const seconds = tempo.totalSeconds + 2;

  const buffer = await Tone.Offline(async (context) => {
    const engine = await createEngine(song, context);
    scheduleSong(engine, tempo);
    context.transport.start(0);
  }, seconds);

  const raw = buffer.toArray() as Float32Array | Float32Array[];
  const list = Array.isArray(raw) ? raw : [raw];
  const channel = list[0] ?? new Float32Array();
  const rate = buffer.sampleRate;

  // Onsets, found as sharp rises in a short-window envelope.
  const win = Math.floor(rate * 0.005);
  const env: number[] = [];
  for (let i = 0; i + win < channel.length; i += win) {
    let peak = 0;
    for (let j = i; j < i + win; j += 1) peak = Math.max(peak, Math.abs(channel[j] ?? 0));
    env.push(peak);
  }
  const attacks: number[] = [];
  for (let i = 1; i < env.length; i += 1) {
    const now = env[i] ?? 0;
    const before = env[i - 1] ?? 0;
    if (now > 0.02 && now > before * 3 && (attacks.length === 0 || (i * win) / rate - (attacks[attacks.length - 1] ?? 0) > 0.15)) {
      attacks.push((i * win) / rate);
    }
  }

  const notes = expression.notes
    .slice()
    .sort((a, b) => a.startSeconds - b.startSeconds);

  /*
   * Reported in separate layers, because they are separate claims.
   *
   * The tempo claim is about **musical time**: which second a tick falls on.
   * The release tail is about the *sample*, and it is nobody's evidence about
   * tempo — a decaying guitar note rings for as long as it rings whatever the
   * tempo is. Conflating the two would let a long tail flatter a wrong clock.
   *
   * What actually proves the tempo is the **interval between onsets**, not
   * any absolute reading: a constant detector offset cancels out of a
   * difference, and a doubling cannot be faked by a tail.
   */
  const musical = notes.map((n) => ({
    pitch: n.pitch,
    timeTicks: n.timeTicks,
    durationTicks: n.durationTicks,
    /** Where the timeline says the note begins. */
    notatedOnsetSeconds: Number(n.startSeconds.toFixed(4)),
    /** How long the timeline says it sounds, articulation hold included. */
    notatedDurationSeconds: Number(n.durationSeconds.toFixed(4)),
    notatedEndSeconds: Number((n.startSeconds + n.durationSeconds).toFixed(4)),
  }));

  const diff = (xs: number[]) =>
    xs.slice(1).map((x, i) => Number((x - (xs[i] ?? 0)).toFixed(4)));

  const predictedOnsets = musical.map((m) => m.notatedOnsetSeconds);
  const measuredAttacks = attacks.map((t) => Number(t.toFixed(4)));

  // Where the audio actually falls silent, so the tail can be named and then
  // set aside rather than quietly counted as music.
  const floor = 0.002;
  let lastLoud = 0;
  for (let i = 0; i < channel.length; i += 1) {
    if (Math.abs(channel[i] ?? 0) > floor) lastLoud = i;
  }
  const audibleEndSeconds = Number((lastLoud / rate).toFixed(4));
  const lastNotatedEnd = musical[musical.length - 1]?.notatedEndSeconds ?? 0;

  return {
    tempoSegments: tempo.segments.map((s) => ({
      sectionId: s.sectionId,
      bpm: s.bpm,
      startTicks: s.startTicks,
      startSeconds: Number(s.startSeconds.toFixed(4)),
      secondsPerTick: Number(s.secondsPerTick.toFixed(7)),
    })),

    /** Layer 1: musical time. Ticks to seconds, and nothing else. */
    musical,

    /** Layer 2: what the rendered audio's attacks measure. */
    measuredAttacks,

    /**
     * Layer 3: the claim itself. Differences, so a constant detector offset
     * cancels; the second gap doubling is the tempo change.
     */
    predictedGaps: diff(predictedOnsets),
    measuredGaps: diff(measuredAttacks),
    detectorOffsets: measuredAttacks.map((m, i) =>
      Number((m - (predictedOnsets[i] ?? 0)).toFixed(4)),
    ),

    /** Layer 4: the release tail, named so it is not mistaken for evidence. */
    lastNotatedEndSeconds: lastNotatedEnd,
    audibleEndSeconds,
    releaseTailSeconds: Number((audibleEndSeconds - lastNotatedEnd).toFixed(4)),
    /** Silence the harness appends after the music, for the tail to decay in. */
    renderPadSeconds: Number((seconds - tempo.totalSeconds).toFixed(4)),
    musicalTotalSeconds: Number(tempo.totalSeconds.toFixed(4)),
    renderedFileSeconds: Number(buffer.duration.toFixed(4)),
  };
}

declare global {
  interface Window {
    aranjeRenderTempoProof: typeof renderTempoProof;
  }
}
window.aranjeRenderTempoProof = renderTempoProof;

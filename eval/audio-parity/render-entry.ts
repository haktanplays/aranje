/**
 * Where the expressive path and the plain path stop being the same signal
 * (2V-D.2 gain parity §4, §5, §6).
 *
 * ## Why a bench and not a reading of the code
 *
 * Read side by side, the two paths look level. The sampler is built with the
 * pack's `trimDb` and struck at the plan's `gain`; the expressive voice
 * multiplies the same `gain` by the same trim as a linear factor and starts
 * its source at unity. Both land on the same `Channel`, the same master and
 * the same limiter. On paper the offset is zero, and the rendered PCM says it
 * is about ten decibels.
 *
 * So this file measures rather than argues. Every case below renders one
 * note, from one buffer, at one pitch, for one duration, at one nominal gain,
 * and reports its peak — first with the whole chain, then with the chain cut
 * back stage by stage until the two paths differ by nothing but the node that
 * actually causes it.
 *
 * ## Evaluation only
 *
 * Nothing in `src/` may import this. It measures the product; it decides
 * nothing about it.
 */
import { acquireBank } from "@/lib/audio/buffer-bank";
import { loadTone } from "@/lib/audio/engine";
import { MASTER_CEILING_DB, masterGain } from "@/lib/audio/master-bus";
import { nearestSample, playbackRateFor, sampleEntries } from "@/lib/audio/sample-map";
import { samplePackFor } from "@/lib/audio/packs";
import { pitchToMidi } from "@/lib/music/pitch";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { buildTempoMap, secondsAtTicks } from "@/lib/audio/tempo";
import { renderSongToBuffer } from "@/lib/export/render-wav";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { pitchAt, settle } from "@/lib/song/edit";
import {
  isDrumSlotArray,
  type Bar,
  type DrumSlot,
  type MelodicSlot,
  type NoteEvent,
} from "@/lib/song/schema";

/** The string the c1 A/B control was written on, kept so the two compare. */
const ORDERING_STRING = 1;

type ToneModule = typeof import("tone");

/* ------------------------------------------------------------- constants */

/** The pack every listening card is written for. */
const INSTRUMENT = "electric_guitar";
const PRESET = "high_gain";
/** One pitch, chosen because the pack records it exactly (no stretching). */
const PITCH = "E3";
/** velocity 96 / 127, which is what the listening fixtures are written at. */
const GAIN = 0.755906;
const DURATION_SECONDS = 0.5;
const SECONDS = 2;
const SAMPLE_RATE = 44100;

const round = (value: number, places = 6): number => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

const dbfs = (linear: number): number =>
  linear <= 0 ? -Infinity : round(20 * Math.log10(linear), 3);

function peakOf(channels: readonly Float32Array[]): number {
  let peak = 0;
  for (const channel of channels) {
    for (const value of channel) {
      const magnitude = Math.abs(value);
      if (magnitude > peak) peak = magnitude;
    }
  }
  return peak;
}

function rmsOf(channels: readonly Float32Array[], from: number, to: number): number {
  let sum = 0;
  let count = 0;
  for (const channel of channels) {
    const start = Math.max(0, Math.min(from, channel.length));
    const end = Math.max(start, Math.min(to, channel.length));
    for (let index = start; index < end; index += 1) {
      const value = channel[index] ?? 0;
      sum += value * value;
      count += 1;
    }
  }
  return count === 0 ? 0 : Math.sqrt(sum / count);
}

/* ------------------------------------------------------------ the render */

type Stage = "source" | "trim" | "track" | "master" | "ceiling";

const STAGES: readonly Stage[] = ["source", "trim", "track", "master", "ceiling"];

type CaseResult = {
  readonly name: string;
  readonly path: "plain" | "expressive";
  readonly stage: Stage;
  readonly nominalGain: number;
  readonly peak: number;
  readonly peakDb: number;
  /** The first 60 ms of sound: what a transient is judged on. */
  readonly transientRms: number;
  /** 200–400 ms in: what a sustained note is judged on. */
  readonly sustainRms: number;
  readonly clipped: number;
};

async function offlineRender(
  tone: ToneModule,
  build: (context: never, destination: unknown) => Promise<void> | void,
): Promise<Float32Array[]> {
  const buffer = (await (tone as unknown as {
    Offline: (
      cb: (context: never) => Promise<void> | void,
      seconds: number,
      channels: number,
      sampleRate: number,
    ) => Promise<{ toArray(): Float32Array | Float32Array[] }>;
  }).Offline(
    async (context) => {
      await build(context, (context as unknown as { destination: unknown }).destination);
    },
    SECONDS,
    1,
    SAMPLE_RATE,
  )) as { toArray(): Float32Array | Float32Array[] };
  const raw = buffer.toArray();
  return Array.isArray(raw) ? raw : [raw];
}

/**
 * The tail of the chain, built to order.
 *
 * `source` connects straight to the destination; each later stage adds the
 * node the production graph adds, in the production order, so the difference
 * between two rows is exactly one node.
 */
function chainFor(
  tone: ToneModule,
  context: never,
  destination: unknown,
  stage: Stage,
  trackVolumeDb: number,
): { input: unknown; dispose: () => void } {
  const made: { dispose(): void }[] = [];
  let tail = destination;
  if (stage === "ceiling") {
    const ceiling = new tone.Limiter({ context, threshold: MASTER_CEILING_DB });
    (ceiling as unknown as { connect(node: unknown): void }).connect(tail);
    made.push(ceiling);
    tail = ceiling;
  }
  if (stage === "master" || stage === "ceiling") {
    const master = new tone.Gain({ context, gain: masterGain() });
    (master as unknown as { connect(node: unknown): void }).connect(tail);
    made.push(master);
    tail = master;
  }
  if (stage === "track" || stage === "master" || stage === "ceiling") {
    const channel = new tone.Channel({ context, volume: trackVolumeDb });
    (channel as unknown as { connect(node: unknown): void }).connect(tail);
    made.push(channel);
    tail = channel;
  }
  return {
    input: tail,
    dispose: () => {
      for (const node of made) node.dispose();
    },
  };
}

/* --------------------------------------------------------------- the API */

export type ParityReport = {
  readonly pack: { readonly id: string; readonly trimDb: number; readonly trimGain: number };
  readonly pitch: string;
  readonly sampleNote: string;
  readonly playbackRate: number;
  readonly nominalGain: number;
  readonly trackVolumeDb: number;
  readonly cases: readonly CaseResult[];
  readonly offsets: readonly {
    readonly stage: Stage;
    readonly plainPeak: number;
    readonly expressivePeak: number;
    readonly ratio: number;
    readonly db: number;
  }[];
};

/**
 * Both production paths, one note each, measured after every stage.
 *
 * "Plain" is `Tone.Sampler` built exactly as `buildVoice` builds it and struck
 * exactly as `scheduleSong` strikes it. "Expressive" is the node graph
 * `ExpressiveVoicePool.play` builds: a bare `ToneBufferSource` into a `Gain`
 * carrying `gain × trim`. Nothing else differs — same buffer, same pitch,
 * same onset, same duration, same nominal gain, no automation, no filter, no
 * attack multiplier.
 */
export async function neutralParity(
  trackVolumeDb = 0,
): Promise<ParityReport | null> {
  const tone = await loadTone();
  const pack = samplePackFor(INSTRUMENT, PRESET);
  if (!pack) return null;
  const trimGain = Math.pow(10, pack.trimDb / 20);
  const entries = sampleEntries(Object.keys(pack.urls));
  const midi = pitchToMidi(PITCH);
  if (midi === null) return null;
  const sample = nearestSample(entries, midi);
  if (!sample) return null;
  const rate = playbackRateFor(sample.midi, midi);

  const cases: CaseResult[] = [];

  for (const stage of STAGES) {
    for (const path of ["plain", "expressive"] as const) {
      const channels = await offlineRender(tone, async (context, destination) => {
        const bank = acquireBank(tone, context as never, pack, () => {});
        await bank.loaded;
        const chain = chainFor(tone, context, destination, stage, trackVolumeDb);

        if (path === "plain") {
          const sampler = new tone.Sampler({
            context: context as never,
            urls: Object.fromEntries(
              Object.keys(pack.urls).map((note) => [note, bank.buffers.get(note)]),
            ) as never,
            volume: stage === "source" ? 0 : pack.trimDb,
          });
          (sampler as unknown as { connect(node: unknown): void }).connect(chain.input);
          sampler.triggerAttackRelease(PITCH, DURATION_SECONDS, 0.25, GAIN);
        } else {
          const level = stage === "source" ? 1 : trimGain;
          const gain = new tone.Gain({ context: context as never, gain: GAIN * level });
          (gain as unknown as { connect(node: unknown): void }).connect(chain.input);
          const source = new tone.ToneBufferSource({
            context: context as never,
            url: bank.buffers.get(sample.note),
            playbackRate: rate,
          });
          source.connect(gain);
          source.start(0.25, 0, DURATION_SECONDS);
        }
        void chain;
      });

      const peak = peakOf(channels);
      const onset = Math.round(0.25 * SAMPLE_RATE);
      cases.push({
        name: `${path}:${stage}`,
        path,
        stage,
        nominalGain: GAIN,
        peak: round(peak),
        peakDb: dbfs(peak),
        transientRms: round(rmsOf(channels, onset, onset + Math.round(0.06 * SAMPLE_RATE))),
        sustainRms: round(
          rmsOf(
            channels,
            onset + Math.round(0.2 * SAMPLE_RATE),
            onset + Math.round(0.4 * SAMPLE_RATE),
          ),
        ),
        clipped: channels.reduce(
          (total, channel) =>
            total + channel.reduce((count, value) => count + (Math.abs(value) > 1 ? 1 : 0), 0),
          0,
        ),
      });
    }
  }

  const offsets = STAGES.map((stage) => {
    const plain = cases.find((entry) => entry.path === "plain" && entry.stage === stage);
    const expressive = cases.find(
      (entry) => entry.path === "expressive" && entry.stage === stage,
    );
    const ratio =
      plain && expressive && plain.peak > 0 ? expressive.peak / plain.peak : Number.NaN;
    return {
      stage,
      plainPeak: plain?.peak ?? 0,
      expressivePeak: expressive?.peak ?? 0,
      ratio: round(ratio),
      db: dbfs(ratio),
    };
  });

  return {
    pack: { id: pack.id, trimDb: pack.trimDb, trimGain: round(trimGain) },
    pitch: PITCH,
    sampleNote: sample.note,
    playbackRate: round(rate),
    nominalGain: GAIN,
    trackVolumeDb,
    cases,
    offsets,
  };
}

/* ------------------------------------------------- who chooses the sample */

export type SampleChoice = {
  readonly pitch: string;
  readonly midi: number;
  /** What `nearestSample` — the expressive voice's authority — picks. */
  readonly expressiveNote: string;
  readonly expressiveRate: number;
  /** What the shared `Tone.Sampler` actually plays, read off the real node. */
  readonly samplerNote: string;
  readonly samplerRate: number;
  readonly agree: boolean;
};

/**
 * Every semitone the pack covers, asked of both choosers.
 *
 * The sampler's answer is taken from a real `Tone.Sampler` built exactly as
 * the engine builds it, not from a second copy of the arithmetic — so this
 * cannot agree with itself by construction.
 */
export async function sampleChoices(): Promise<readonly SampleChoice[] | null> {
  const tone = await loadTone();
  const pack = samplePackFor(INSTRUMENT, PRESET);
  if (!pack) return null;
  const entries = sampleEntries(Object.keys(pack.urls));
  const lowest = entries[0]?.midi ?? 0;
  const highest = entries[entries.length - 1]?.midi ?? 0;

  const rows: SampleChoice[] = [];
  await offlineRender(tone, async (context) => {
    const bank = acquireBank(tone, context as never, pack, () => {});
    await bank.loaded;
    const sampler = new tone.Sampler({
      context: context as never,
      urls: Object.fromEntries(
        Object.keys(pack.urls).map((note) => [note, bank.buffers.get(note)]),
      ) as never,
      volume: pack.trimDb,
    });
    const internals = sampler as unknown as {
      _findClosest(midi: number): number;
    };
    for (let midi = lowest; midi <= highest; midi += 1) {
      const ours = nearestSample(entries, midi);
      if (!ours) continue;
      const difference = internals._findClosest(midi);
      const theirMidi = midi - difference;
      const theirs = entries.find((entry) => entry.midi === theirMidi);
      rows.push({
        pitch: theirs ? `${midi}` : `${midi}`,
        midi,
        expressiveNote: ours.note,
        expressiveRate: round(playbackRateFor(ours.midi, midi), 6),
        samplerNote: theirs?.note ?? "?",
        samplerRate: round(Math.pow(2, difference / 12), 6),
        agree: ours.midi === theirMidi,
      });
    }
    sampler.dispose();
  });
  return rows;
}

/* ------------------------------------------- the same note, both choosers */

export type PitchCase = {
  readonly pitch: string;
  readonly midi: number;
  readonly plain: { readonly peak: number; readonly window25: number; readonly db25: number };
  readonly expressive: {
    readonly peak: number;
    readonly window25: number;
    readonly db25: number;
  };
  readonly peakRatio: number;
  readonly peakDb: number;
  readonly window25Ratio: number;
  readonly window25Db: number;
};

/**
 * One note per pitch, both paths, the whole chain — measured twice.
 *
 * `peak` is the note's own peak wherever it falls; `window25` is the first
 * 25 ms, which is the window the c1 round measured in. A path difference that
 * shows only in the short window is a difference of *attack*, not of level.
 */
export async function pitchSweep(
  pitches: readonly string[] = ["C3", "D3", "E3", "D4", "F3"],
): Promise<readonly PitchCase[] | null> {
  const tone = await loadTone();
  const pack = samplePackFor(INSTRUMENT, PRESET);
  if (!pack) return null;
  const trimGain = Math.pow(10, pack.trimDb / 20);
  const entries = sampleEntries(Object.keys(pack.urls));

  const out: PitchCase[] = [];
  for (const pitch of pitches) {
    const midi = pitchToMidi(pitch);
    if (midi === null) continue;
    const sample = nearestSample(entries, midi);
    if (!sample) continue;
    const measured: Record<string, { peak: number; window25: number }> = {};

    for (const path of ["plain", "expressive"] as const) {
      const channels = await offlineRender(tone, async (context, destination) => {
        const bank = acquireBank(tone, context as never, pack, () => {});
        await bank.loaded;
        const chain = chainFor(tone, context, destination, "ceiling", 0);
        if (path === "plain") {
          const sampler = new tone.Sampler({
            context: context as never,
            urls: Object.fromEntries(
              Object.keys(pack.urls).map((note) => [note, bank.buffers.get(note)]),
            ) as never,
            volume: pack.trimDb,
          });
          (sampler as unknown as { connect(node: unknown): void }).connect(chain.input);
          sampler.triggerAttackRelease(pitch, DURATION_SECONDS, 0.25, GAIN);
        } else {
          const gain = new tone.Gain({
            context: context as never,
            gain: GAIN * trimGain,
          });
          (gain as unknown as { connect(node: unknown): void }).connect(chain.input);
          const source = new tone.ToneBufferSource({
            context: context as never,
            url: bank.buffers.get(sample.note),
            playbackRate: playbackRateFor(sample.midi, midi),
          });
          source.connect(gain);
          source.start(0.25, 0, DURATION_SECONDS);
        }
      });
      const onset = Math.round(0.25 * SAMPLE_RATE);
      const windowEnd = onset + Math.round(0.025 * SAMPLE_RATE);
      let windowPeak = 0;
      for (const channel of channels) {
        for (let index = onset; index < Math.min(windowEnd, channel.length); index += 1) {
          const magnitude = Math.abs(channel[index] ?? 0);
          if (magnitude > windowPeak) windowPeak = magnitude;
        }
      }
      measured[path] = { peak: round(peakOf(channels)), window25: round(windowPeak) };
    }

    const plain = measured.plain ?? { peak: 0, window25: 0 };
    const expressive = measured.expressive ?? { peak: 0, window25: 0 };
    const peakRatio = plain.peak === 0 ? Number.NaN : expressive.peak / plain.peak;
    const windowRatio =
      plain.window25 === 0 ? Number.NaN : expressive.window25 / plain.window25;
    out.push({
      pitch,
      midi,
      plain: { ...plain, db25: dbfs(plain.window25) },
      expressive: { ...expressive, db25: dbfs(expressive.window25) },
      peakRatio: round(peakRatio),
      peakDb: dbfs(peakRatio),
      window25Ratio: round(windowRatio),
      window25Db: dbfs(windowRatio),
    });
  }
  return out;
}

/* ------------------------------------- the contract, through the product */

export type NoteMeasurement = {
  readonly index: number;
  readonly expressive: boolean;
  readonly planGain: number;
  readonly envelopePeak: number | null;
  /** The note's own peak, over its whole sounding window. */
  readonly peak: number;
  readonly peakDb: number;
  /** The first 60 ms: what a transient is judged on. */
  readonly transientRms: number;
  /** 200–400 ms in: what a sustained note is judged on. */
  readonly sustainRms: number;
};

export type OrderingCase = {
  readonly attack: string;
  readonly fret: number;
  readonly pitch: string;
  readonly notes: readonly NoteMeasurement[];
  readonly meanPeak: number;
  readonly meanTransientRms: number;
  readonly meanSustainRms: number;
  readonly clipped: number;
  readonly nonFinite: number;
};

const ATTACKS = [null, "accent", "ghost"] as const;

/**
 * Eight identical notes, one attack, rendered by the export renderer.
 *
 * This is the product's own path — `renderSongToBuffer` is the export
 * button's renderer — so what comes back is audio a reader could receive.
 * Each note is measured over its whole sounding window rather than a fixed
 * 25 ms, because this pack's recordings do not peak until about 66 ms and a
 * short window measures the *rise*, not the level.
 */
export async function techniqueOrdering(
  fret = 5,
): Promise<readonly OrderingCase[] | null> {
  const track = SAMPLE_SONG.tracks.find((entry) => entry.fretboard !== undefined);
  const fretboard = track?.fretboard;
  const section = SAMPLE_SONG.sections[0];
  if (!track || !fretboard || !section) return null;
  const pitch = pitchAt(fretboard, ORDERING_STRING, fret);
  if (pitch === null) return null;

  const out: OrderingCase[] = [];
  for (const attack of ATTACKS) {
    const lane: MelodicSlot[] = Array.from({ length: 8 }, () => ({
      notes: [
        {
          pitch,
          position: { string: ORDERING_STRING, fret },
          ...(attack === null ? {} : { attack }),
        } as NoteEvent,
      ],
    }));
    const slots: Record<string, MelodicSlot[] | DrumSlot[]> = {};
    for (const entry of SAMPLE_SONG.tracks) {
      const existing = section.bars[0]?.slots[entry.id];
      slots[entry.id] =
        existing && isDrumSlotArray(existing)
          ? Array.from({ length: 8 }, () => [] as DrumSlot)
          : Array.from({ length: 8 }, () => null as MelodicSlot);
    }
    slots[track.id] = lane;

    const staged = settle({
      ...SAMPLE_SONG,
      sections: [
        {
          ...section,
          bars: [{ timeSignature: [4, 4], resolution: 8, slots } as Bar],
        },
      ],
    });
    if (!staged.ok) return null;

    const plan = buildExpressionPlan(staged.song);
    const tempo = buildTempoMap(staged.song);
    const planned = plan.notes
      .filter((note) => note.trackId === track.id)
      .sort((a, b) => a.timeTicks - b.timeTicks);
    const rendered = await renderSongToBuffer(staged.song, {
      audibleTrackIds: [track.id],
    });
    const channels = rendered.channels;
    const rate = rendered.sampleRate;

    const notes = planned.map((note, index) => {
      const startSeconds = secondsAtTicks(tempo, note.timeTicks);
      const next = planned[index + 1];
      const endSeconds = next
        ? secondsAtTicks(tempo, next.timeTicks)
        : startSeconds + 0.5;
      const from = Math.round(startSeconds * rate);
      const to = Math.round(endSeconds * rate);
      let peak = 0;
      for (const channel of channels) {
        for (let at = from; at < Math.min(to, channel.length); at += 1) {
          const magnitude = Math.abs(channel[at] ?? 0);
          if (magnitude > peak) peak = magnitude;
        }
      }
      return {
        index,
        expressive: note.expressive,
        planGain: note.gain,
        envelopePeak:
          note.gainEnvelope.length === 0
            ? null
            : round(Math.max(...note.gainEnvelope.map((point) => point.value))),
        peak: round(peak),
        peakDb: dbfs(peak),
        transientRms: round(rmsOf(channels, from, from + Math.round(0.06 * rate))),
        sustainRms: round(
          rmsOf(
            channels,
            from + Math.round(0.2 * rate),
            from + Math.round(0.4 * rate),
          ),
        ),
      };
    });

    const mean = (values: readonly number[]): number =>
      values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

    out.push({
      attack: attack ?? "plain",
      fret,
      pitch,
      notes,
      meanPeak: round(mean(notes.map((note) => note.peak))),
      meanTransientRms: round(mean(notes.map((note) => note.transientRms))),
      meanSustainRms: round(mean(notes.map((note) => note.sustainRms))),
      clipped: channels.reduce(
        (total, channel) =>
          total + channel.reduce((count, value) => count + (Math.abs(value) > 1 ? 1 : 0), 0),
        0,
      ),
      nonFinite: channels.reduce(
        (total, channel) =>
          total + channel.reduce((count, value) => count + (Number.isFinite(value) ? 0 : 1), 0),
        0,
      ),
    });
  }
  return out;
}

declare global {
  interface Window {
    AranjeParityRender: {
      neutralParity: typeof neutralParity;
      sampleChoices: typeof sampleChoices;
      pitchSweep: typeof pitchSweep;
      techniqueOrdering: typeof techniqueOrdering;
    };
  }
}

if (typeof window !== "undefined") {
  window.AranjeParityRender = { neutralParity, sampleChoices, pitchSweep, techniqueOrdering };
}

/**
 * Three renders that settle the palm-mute question in air, not in ticks
 * (2V-D.1-C §10, §15).
 *
 * The unit tests say a span-held palm mute and a legacy `articulation`
 * palm mute now produce the same plan, the same duration and the same
 * envelope. That is a claim about numbers. This renders all three cases —
 * legacy, span, and a plain note that was never muted — through
 * `createEngine` and `scheduleSong` on an offline context, the same path the
 * WAV export uses, and measures the sound that comes out.
 *
 * The plain note is not decoration. Without it, two identical muted renders
 * would also be consistent with a harness that muted everything, or nothing.
 */
import { createEngine, loadTone, scheduleSong, type Engine } from "@/lib/audio/engine";
import { buildTempoMap } from "@/lib/audio/tempo";
import { audioExportLimits } from "@/lib/limits";
import { encodeWav } from "@/lib/export/wav-encoder";
import { pitchAt } from "@/lib/song/edit";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import {
  songSchema,
  type MelodicSlot,
  type NoteEvent,
  type Song,
  type TechniqueSpan,
} from "@/lib/song/schema";

const RATE = audioExportLimits.sampleRate;
const TRACK = "gtr";
const BOARD = SAMPLE_SONG.tracks.find((track) => track.id === TRACK)!.fretboard!;
const BAR = 768;

const round = (value: number): number => Math.round(value * 1e6) / 1e6;

const note = (stringIndex: number, fret: number, extra: Partial<NoteEvent> = {}): NoteEvent =>
  ({
    pitch: pitchAt(BOARD, stringIndex, fret)!,
    position: { string: stringIndex, fret },
    ...extra,
  }) as NoteEvent;

/** One bar, four strikes on the low A string, so a mute is easy to hear. */
function song(input: {
  readonly spans?: readonly TechniqueSpan[];
  readonly extra?: Partial<NoteEvent>;
}): Song {
  const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
  for (const slot of [0, 2, 4, 6]) {
    lane[slot] = { notes: [note(1, 3, input.extra ?? {})] };
  }
  return songSchema.parse({
    ...SAMPLE_SONG,
    tracks: SAMPLE_SONG.tracks.filter((track) => track.id === TRACK),
    sections: [
      {
        ...SAMPLE_SONG.sections[0]!,
        bars: [{ timeSignature: [4, 4], resolution: 8, slots: { [TRACK]: lane } }],
        ...(input.spans ? { techniqueSpans: [...input.spans] } : {}),
      },
    ],
  } satisfies Song);
}

const SPAN: TechniqueSpan = {
  id: "pm1",
  kind: "palm_mute",
  trackId: TRACK,
  startTicks: 0,
  endTicks: BAR,
  stringIndices: [1],
};

export const FIXTURES: Readonly<Record<string, () => Song>> = {
  /** No technique at all. The control. */
  plain: () => song({}),
  /** The accepted character, written the way it has always been written. */
  legacy: () => song({ extra: { articulation: "palm_mute" } }),
  /** The same character, written as a region over the string. */
  span: () => song({ spans: [SPAN] }),
};

async function render(target: Song): Promise<Float32Array[]> {
  const tone = await loadTone();
  const seconds = buildTempoMap(target).totalSeconds + 2;

  let built: Engine | null = null;
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
      const engine = await createEngine(target, context as never);
      built = engine;
      scheduleSong(engine, buildTempoMap(target), { metronomeEnabled: () => false });
      (context as { transport: { start(at: number): void } }).transport.start(0);
    },
    seconds,
    audioExportLimits.channels,
    RATE,
  )) as { toArray(): Float32Array | Float32Array[] };

  const engine = built as Engine | null;
  if (engine) {
    engine.expression.stopAll();
    engine.dispose();
  }

  const raw = buffer.toArray();
  const planar = Array.isArray(raw) ? raw : [raw];
  return planar.length >= 2 ? planar.slice(0, 2) : [planar[0]!, planar[0]!];
}

/**
 * How long the first strike stays audible.
 *
 * Measured against the render's own peak rather than an absolute floor, so a
 * quieter sample bank cannot turn a shortened note into a missing one. -40 dB
 * is well below anything a listener would call sounding and well above the
 * offline context's noise floor.
 */
function decaySeconds(mono: Float32Array, fromSample: number, toSample: number): number {
  let peak = 0;
  for (let index = fromSample; index < toSample; index += 1) {
    peak = Math.max(peak, Math.abs(mono[index] ?? 0));
  }
  const floor = peak * 10 ** (-40 / 20);
  let last = fromSample;
  for (let index = fromSample; index < toSample; index += 1) {
    if (Math.abs(mono[index] ?? 0) > floor) last = index;
  }
  return round((last - fromSample) / RATE);
}

function rms(mono: Float32Array, fromSample: number, toSample: number): number {
  let sum = 0;
  for (let index = fromSample; index < toSample; index += 1) {
    const value = mono[index] ?? 0;
    sum += value * value;
  }
  const count = Math.max(1, toSample - fromSample);
  return round(Math.sqrt(sum / count));
}

export type SpanMeasurement = {
  readonly seconds: number;
  readonly peak: number;
  /** Level over the first strike's own slot, so the four hits do not blur. */
  readonly firstStrikeRms: number;
  /** How long the first strike stays within 40 dB of its own peak. */
  readonly firstStrikeDecaySeconds: number;
  readonly wavBase64: string;
};

export async function renderFixture(name: string): Promise<SpanMeasurement> {
  const build = FIXTURES[name];
  if (!build) throw new Error(`no fixture ${name}`);
  const target = build();
  const channels = await render(target);

  const frames = channels[0]!.length;
  const mono = new Float32Array(frames);
  let peak = 0;
  for (let index = 0; index < frames; index += 1) {
    mono[index] = ((channels[0]![index] ?? 0) + (channels[1]![index] ?? 0)) / 2;
    peak = Math.max(peak, Math.abs(mono[index]!));
  }

  /* One slot at 120 BPM, 8 slots to the bar: a quarter of a second. The
     window stops before the second strike so the decay is this note's. */
  const slotSamples = Math.floor(RATE * 0.25);

  const wav = encodeWav({ channels, sampleRate: RATE });
  if (!wav.ok) throw new Error(`wav refused: ${wav.code}`);
  let binary = "";
  for (const byte of wav.bytes) binary += String.fromCharCode(byte);

  return {
    seconds: round(frames / RATE),
    peak: round(peak),
    firstStrikeRms: rms(mono, 0, slotSamples),
    firstStrikeDecaySeconds: decaySeconds(mono, 0, slotSamples),
    wavBase64: btoa(binary),
  };
}

export function fixtureNames(): string[] {
  return Object.keys(FIXTURES);
}

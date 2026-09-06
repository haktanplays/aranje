/**
 * Real rendered audio for the D.2 completion round: the L31 accent question
 * and the WAV bar-boundary question (§4, §10, §11).
 *
 * ## Why this exists at all
 *
 * The c3 round measured the *timeline* — what the production planners say a
 * bar starts at — and named the rendered half an open debt, because the node
 * test environment has no audio context and no sample bank. That was true of
 * node and false of the product: `renderSongToBuffer` is the export button's
 * own renderer, and it runs in a browser. So this file is bundled into a page
 * served by the running app, where the sample URLs resolve exactly as they do
 * for a reader, and every number below comes out of PCM that a person could
 * have listened to.
 *
 * ## The detector does not ask the planner where the notes are
 *
 * `detectOnsets` is handed a buffer and nothing else. It measures the noise
 * floor from the quietest part of the file, derives its threshold from that
 * floor rather than from a constant, and reports every rise it finds. The
 * planner's ticks are compared with that list afterwards, by the caller — so
 * a test can never "confirm" an onset by reading back the number it started
 * from. If the detector finds nothing it says so, and a run that finds
 * nothing is a failed run rather than a silent pass.
 *
 * ## Evaluation only
 *
 * Nothing in `src/` may import this. It measures the product; it does not
 * decide anything about it.
 */
import { buildTempoMap, secondsAtTicks } from "@/lib/audio/tempo";
import { CLICK_GAIN, metronomeClicks } from "@/lib/audio/position";
import { barTimeline, buildSongPlan } from "@/lib/audio/schedule";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { encodeWav } from "@/lib/export/wav-encoder";
import { renderDuration } from "@/lib/export/export-plan";
import { renderSongToBuffer } from "@/lib/export/render-wav";
import { barTicks, type Resolution, type TimeSignature } from "@/lib/music/timing";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { pitchAt, settle } from "@/lib/song/edit";
import { buildRhythmTakes, type RhythmTakeId } from "@/lib/listening/rhythm-take";
import {
  isDrumSlotArray,
  type Bar,
  type DrumSlot,
  type MelodicSlot,
  type NoteEvent,
  type Song,
} from "@/lib/song/schema";

/* ------------------------------------------------------------- measuring */

const round = (value: number, places = 6): number => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

const dbfs = (linear: number): number =>
  linear <= 0 ? -Infinity : round(20 * Math.log10(linear), 3);

/** Mono sum of the channels, which is what an onset is heard in. */
function mono(channels: readonly Float32Array[]): Float32Array {
  const frames = channels[0]?.length ?? 0;
  const out = new Float32Array(frames);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[frame] ?? 0;
    out[frame] = sum / Math.max(1, channels.length);
  }
  return out;
}

function windowStats(
  samples: Float32Array,
  from: number,
  to: number,
): { rms: number; peak: number } {
  const start = Math.max(0, Math.min(from, samples.length));
  const end = Math.max(start, Math.min(to, samples.length));
  let sum = 0;
  let peak = 0;
  for (let index = start; index < end; index += 1) {
    const value = samples[index] ?? 0;
    sum += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  const count = Math.max(1, end - start);
  return { rms: Math.sqrt(sum / count), peak };
}

/**
 * The noise floor, measured rather than assumed.
 *
 * The quietest tenth of the file's 10ms windows: silence between notes, the
 * tail of a decay, the lead-in. Taking a percentile rather than the minimum
 * keeps one pathologically empty window from setting a floor of zero, which
 * would make every threshold derived from it meaningless.
 */
function noiseFloor(samples: Float32Array, sampleRate: number): number {
  const window = Math.max(1, Math.round(sampleRate * 0.01));
  const levels: number[] = [];
  for (let start = 0; start + window <= samples.length; start += window) {
    levels.push(windowStats(samples, start, start + window).rms);
  }
  if (levels.length === 0) return 0;
  levels.sort((a, b) => a - b);
  return levels[Math.floor(levels.length * 0.1)] ?? 0;
}

export type DetectedOnset = {
  /** Where the rise crossed the threshold, in seconds. */
  readonly seconds: number;
  /** The 10ms RMS just after it. */
  readonly rms10: number;
  readonly peak: number;
};

/**
 * Every onset in the buffer, found without being told where to look.
 *
 * A rise is a 5ms window whose RMS is both above the floor-derived threshold
 * and at least `riseRatio` times the window before it. The refractory gap
 * stops one pick from being counted as several as its transient develops.
 */
export function detectOnsets(
  samples: Float32Array,
  sampleRate: number,
  options: { readonly riseRatio?: number; readonly refractorySeconds?: number } = {},
): { readonly floor: number; readonly threshold: number; readonly onsets: DetectedOnset[] } {
  const riseRatio = options.riseRatio ?? 2.5;
  const refractory = Math.round(sampleRate * (options.refractorySeconds ?? 0.03));
  const window = Math.max(1, Math.round(sampleRate * 0.005));
  const floor = noiseFloor(samples, sampleRate);
  /* Eight times the measured floor, and a hard minimum so a digitally silent
     file cannot report a threshold of zero and then "find" every sample. */
  const threshold = Math.max(floor * 8, 1e-4);

  const onsets: DetectedOnset[] = [];
  let previous = 0;
  let lastAt = -refractory * 2;
  for (let start = 0; start + window <= samples.length; start += window) {
    const level = windowStats(samples, start, start + window).rms;
    const rising = level > threshold && level > previous * riseRatio;
    if (rising && start - lastAt >= refractory) {
      const after = windowStats(samples, start, start + Math.round(sampleRate * 0.01));
      onsets.push({
        seconds: round(start / sampleRate),
        rms10: round(after.rms),
        peak: round(after.peak),
      });
      lastAt = start;
    }
    previous = level;
  }
  return { floor: round(floor), threshold: round(threshold), onsets };
}

/** Everything §4 asks about one struck note. */
export type OnsetMeasurement = {
  readonly label: string;
  readonly expectedTicks: number;
  readonly expectedSeconds: number;
  /** The detected rise nearest the expectation, or null when none is near. */
  readonly detectedSeconds: number | null;
  readonly errorMs: number | null;
  readonly firstEnergySeconds: number | null;
  readonly rms10: number;
  readonly rms25: number;
  readonly rms50: number;
  readonly peak: number;
  readonly crest: number;
  readonly sustainRms: number;
  readonly peakDb: number;
};

function measureOnset(
  samples: Float32Array,
  sampleRate: number,
  input: {
    readonly label: string;
    readonly expectedTicks: number;
    readonly expectedSeconds: number;
    readonly detected: readonly DetectedOnset[];
    readonly threshold: number;
    readonly searchSeconds: number;
  },
): OnsetMeasurement {
  const at = Math.round(input.expectedSeconds * sampleRate);
  const near = input.detected
    .filter((onset) => Math.abs(onset.seconds - input.expectedSeconds) <= input.searchSeconds)
    .sort(
      (a, b) =>
        Math.abs(a.seconds - input.expectedSeconds) -
        Math.abs(b.seconds - input.expectedSeconds),
    )[0];

  /* The first sample past the threshold inside the search window, which is a
     different question from "where did the detector say the rise was". */
  let firstEnergy: number | null = null;
  const from = Math.max(0, at - Math.round(input.searchSeconds * sampleRate));
  const to = Math.min(samples.length, at + Math.round(input.searchSeconds * sampleRate));
  for (let index = from; index < to; index += 1) {
    if (Math.abs(samples[index] ?? 0) > input.threshold) {
      firstEnergy = round(index / sampleRate);
      break;
    }
  }

  const at10 = windowStats(samples, at, at + Math.round(sampleRate * 0.01));
  const at25 = windowStats(samples, at, at + Math.round(sampleRate * 0.025));
  const at50 = windowStats(samples, at, at + Math.round(sampleRate * 0.05));
  const sustain = windowStats(
    samples,
    at + Math.round(sampleRate * 0.08),
    at + Math.round(sampleRate * 0.16),
  );

  return {
    label: input.label,
    expectedTicks: input.expectedTicks,
    expectedSeconds: round(input.expectedSeconds),
    detectedSeconds: near ? near.seconds : null,
    errorMs: near ? round((near.seconds - input.expectedSeconds) * 1000, 3) : null,
    firstEnergySeconds: firstEnergy,
    rms10: round(at10.rms),
    rms25: round(at25.rms),
    rms50: round(at50.rms),
    peak: round(at50.peak),
    crest: at50.rms > 0 ? round(at50.peak / at50.rms, 4) : 0,
    sustainRms: round(sustain.rms),
    peakDb: dbfs(at50.peak),
  };
}

function healthOf(channels: readonly Float32Array[]): {
  readonly peak: number;
  readonly rms: number;
  readonly clippedFrames: number;
  readonly nonFinite: number;
} {
  const frames = channels[0]?.length ?? 0;
  let peak = 0;
  let sum = 0;
  let clippedFrames = 0;
  let nonFinite = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    let clipped = false;
    for (const channel of channels) {
      const value = channel[frame] ?? 0;
      if (!Number.isFinite(value)) nonFinite += 1;
      const magnitude = Math.abs(value);
      peak = Math.max(peak, magnitude);
      sum += value * value;
      if (magnitude >= 1) clipped = true;
    }
    if (clipped) clippedFrames += 1;
  }
  return {
    peak: round(peak),
    rms: round(Math.sqrt(sum / Math.max(1, frames * channels.length))),
    clippedFrames,
    nonFinite,
  };
}

/* --------------------------------------------------------- the L31 takes */

/** What the planner intends for one note, before any of it is rendered. */
export type PlannedNote = {
  readonly timeTicks: number;
  readonly startSeconds: number;
  readonly pitch: string;
  readonly fret: number | null;
  readonly stringIndex: number | null;
  readonly durationTicks: number;
  readonly durationSeconds: number;
  readonly velocity: number;
  /** Linear gain **before** articulation shaping, which is where accent is not. */
  readonly gain: number;
  /**
   * The peak of the shaped envelope, or null when the note has no envelope.
   *
   * A note with nothing shaping it carries an empty envelope and plays at
   * `gain`; reporting that as a peak of zero would read as a silent note.
   */
  readonly envelopePeak: number | null;
  /** `envelopePeak / gain` — the accent multiplier, as the plan applied it. */
  readonly gainRatio: number;
  /** What the *song* says, read from the note rather than from the plan. */
  readonly authoredAttack: string | null;
  readonly expressive: boolean;
};

/** Every authored attack in the window, by tick, straight out of the song. */
function authoredAttacks(
  song: Song,
  trackId: string,
): ReadonlyMap<number, string> {
  const out = new Map<number, string>();
  let barStart = 0;
  for (const section of song.sections) {
    for (const bar of section.bars) {
      const lane = bar.slots[trackId];
      const per = 768 / bar.resolution;
      if (lane && !isDrumSlotArray(lane)) {
        lane.forEach((slot, index) => {
          if (!slot || slot === "-") return;
          const attack = slot.notes[0]?.attack;
          if (attack) out.set(barStart + index * per, attack);
        });
      }
      barStart +=
        barTicks({ timeSignature: bar.timeSignature, resolution: bar.resolution });
    }
  }
  return out;
}

function plannedNotes(song: Song, trackId: string, fromTicks: number, toTicks: number) {
  const plan = buildExpressionPlan(song);
  const authored = authoredAttacks(song, trackId);
  return plan.notes
    .filter(
      (note) =>
        note.trackId === trackId && note.timeTicks >= fromTicks && note.timeTicks < toTicks,
    )
    .sort((a, b) => a.timeTicks - b.timeTicks)
    .map((note): PlannedNote => {
      const peak =
        note.gainEnvelope.length === 0
          ? null
          : round(note.gainEnvelope.reduce((top, point) => Math.max(top, point.value), 0));
      return {
        timeTicks: note.timeTicks,
        startSeconds: round(note.startSeconds),
        pitch: note.pitch,
        fret: note.position?.fret ?? null,
        stringIndex: note.position?.stringIndex ?? null,
        durationTicks: note.durationTicks,
        durationSeconds: round(note.durationSeconds),
        velocity: note.velocity,
        gain: round(note.gain),
        envelopePeak: peak,
        gainRatio: peak === null || note.gain === 0 ? 1 : round(peak / note.gain, 4),
        authoredAttack: authored.get(note.timeTicks) ?? null,
        expressive: note.expressive,
      };
    });
}

export type TakeAnalysis = {
  readonly id: string;
  readonly sampleRate: number;
  readonly frames: number;
  readonly seconds: number;
  readonly barNumber: number;
  readonly barCount: number;
  readonly windowStartTicks: number;
  readonly windowEndTicks: number;
  readonly windowStartSeconds: number;
  readonly windowEndSeconds: number;
  readonly planned: readonly PlannedNote[];
  readonly detector: { readonly floor: number; readonly threshold: number; readonly count: number };
  readonly onsets: readonly OnsetMeasurement[];
  readonly health: ReturnType<typeof healthOf>;
  readonly activeAfterDispose: number;
  readonly wavBase64: string;
};

const base64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary);
};

/**
 * Render one listening take and measure every struck note in its window.
 *
 * Only the take's own track is audible, because the question is about that
 * riff's accents and a drum kit playing over it would be measuring the mix.
 */
export async function renderTake(id: RhythmTakeId): Promise<TakeAnalysis | null> {
  const takes = buildRhythmTakes(SAMPLE_SONG);
  const take = takes?.[id];
  if (!take) return null;

  const bars = barTimeline(take.song);
  const first = bars.find((bar) => bar.barNumber === take.barNumber);
  if (!first) return null;
  const tempo = buildTempoMap(take.song);
  const windowStartTicks = first.time;
  const windowEndTicks = windowStartTicks + take.ticks;

  const rendered = await renderSongToBuffer(take.song, {
    audibleTrackIds: [take.trackId],
  });
  const samples = mono(rendered.channels);
  const detected = detectOnsets(samples, rendered.sampleRate);
  const planned = plannedNotes(take.song, take.trackId, windowStartTicks, windowEndTicks);

  const onsets = planned.map((note, index) =>
    measureOnset(samples, rendered.sampleRate, {
      label: `${index + 1}`,
      expectedTicks: note.timeTicks,
      expectedSeconds: note.startSeconds,
      detected: detected.onsets,
      threshold: detected.threshold,
      /* Half the shortest gap in these takes, so a window can never reach the
         neighbouring note and report it as this one. */
      searchSeconds: 0.05,
    }),
  );

  const wav = encodeWav({
    channels: rendered.channels,
    sampleRate: rendered.sampleRate,
  });

  return {
    id,
    sampleRate: rendered.sampleRate,
    frames: rendered.frames,
    seconds: round(rendered.frames / rendered.sampleRate),
    barNumber: take.barNumber,
    barCount: take.barCount,
    windowStartTicks,
    windowEndTicks,
    windowStartSeconds: round(secondsAtTicks(tempo, windowStartTicks)),
    windowEndSeconds: round(secondsAtTicks(tempo, windowEndTicks)),
    planned,
    detector: {
      floor: detected.floor,
      threshold: detected.threshold,
      count: detected.onsets.length,
    },
    onsets,
    health: healthOf(rendered.channels),
    activeAfterDispose: rendered.activeAfterDispose,
    wavBase64: wav.ok ? base64(wav.bytes) : "",
  };
}

/** The string every fixture in this file is written on. */
const STRING = 1;

/* ------------------------------------------------- the sample's own onset */

export type SampleProfile = {
  readonly sampleRate: number;
  readonly startSeconds: number;
  /** How long after the scheduled start the energy first passes the floor. */
  readonly toThresholdMs: number;
  /** How long after it the sample reaches its own peak. */
  readonly toPeakMs: number;
  /** What the detector says about the same note, given only the buffer. */
  readonly detectedMs: number | null;
  readonly threshold: number;
  readonly peak: number;
};

/**
 * How long a struck note takes to arrive, measured on a note with nothing
 * around it (§11).
 *
 * This is the number a bar-boundary tolerance has to be built from. A
 * sampled guitar does not reach full level at its scheduled instant — the
 * pick has a ramp — so an onset detector reports a note *later* than the
 * scheduler placed it, by an amount that belongs to the sample rather than
 * to any drift. Measuring it here, on a single note in an otherwise empty
 * bar, keeps the tolerance from being either a guess or a circular reading
 * of the very errors it is meant to bound.
 */
export async function renderSampleProfile(): Promise<SampleProfile | null> {
  const built = songOf([
    { meter: [4, 4], resolution: 8, hits: [{ slot: 2, fret: 5, hold: 5 }] },
  ]);
  if (!built) return null;
  const tempo = buildTempoMap(built.song);
  const planned = plannedNotes(built.song, built.trackId, 0, 768);
  const note = planned[0];
  if (!note) return null;
  const rendered = await renderSongToBuffer(built.song, {
    audibleTrackIds: [built.trackId],
  });
  const samples = mono(rendered.channels);
  const detected = detectOnsets(samples, rendered.sampleRate);
  const startSeconds = secondsAtTicks(tempo, note.timeTicks);
  const at = Math.round(startSeconds * rendered.sampleRate);

  let crossed: number | null = null;
  let peakAt = at;
  let peak = 0;
  for (let index = at; index < Math.min(samples.length, at + rendered.sampleRate); index += 1) {
    const value = Math.abs(samples[index] ?? 0);
    if (crossed === null && value > detected.threshold) crossed = index;
    if (value > peak) {
      peak = value;
      peakAt = index;
    }
  }
  const near = detected.onsets.find((onset) => Math.abs(onset.seconds - startSeconds) < 0.2);

  return {
    sampleRate: rendered.sampleRate,
    startSeconds: round(startSeconds),
    toThresholdMs:
      crossed === null ? -1 : round(((crossed - at) / rendered.sampleRate) * 1000, 3),
    toPeakMs: round(((peakAt - at) / rendered.sampleRate) * 1000, 3),
    detectedMs: near ? round((near.seconds - startSeconds) * 1000, 3) : null,
    threshold: detected.threshold,
    peak: round(peak),
  };
}

/* ------------------------------------------------ the metronome's own events */

export type ClickRow = {
  readonly tick: number;
  readonly role: string;
  readonly velocity: number;
};

export type MetronomeCase = {
  readonly name: string;
  readonly meter: string;
  readonly grouping: string;
  readonly barTicks: number;
  readonly beats: readonly ClickRow[];
  readonly units: readonly ClickRow[];
  /** True when no tick carries two clicks in either setting. */
  readonly onePulseOneClick: boolean;
  /** True when every main beat keeps its tick and its role under `units`. */
  readonly mainBeatsUnmoved: boolean;
};

const CLICK_CASES: Readonly<Record<string, BarSpec>> = {
  "4-4": { meter: [4, 4], resolution: 8, hits: [] },
  "6-8-33": { meter: [6, 8], resolution: 8, grouping: [3, 3], hits: [] },
  "7-8-223": { meter: [7, 8], resolution: 8, grouping: [2, 2, 3], hits: [] },
  "7-8-322": { meter: [7, 8], resolution: 8, grouping: [3, 2, 2], hits: [] },
  "9-8": { meter: [9, 8], resolution: 8, grouping: [3, 3, 3], hits: [] },
  "12-8": { meter: [12, 8], resolution: 8, grouping: [3, 3, 3, 3], hits: [] },
};

export const metronomeCaseNames = (): string[] => Object.keys(CLICK_CASES);

/**
 * Every click the production metronome would schedule for one bar.
 *
 * The same `metronomeClicks` the engine calls, on a plan built by the same
 * `buildSongPlan`; nothing here is a second implementation of the click.
 */
export function metronomeTable(name: string): MetronomeCase | null {
  const spec = CLICK_CASES[name];
  if (!spec) return null;
  const built = songOf([spec]);
  if (!built) return null;
  const plan = buildSongPlan(built.song);
  const rows = (subdivisions: boolean): ClickRow[] =>
    metronomeClicks(plan, { subdivisions }).map((beat) => ({
      tick: beat.time,
      role: beat.strength,
      velocity: CLICK_GAIN[beat.strength],
    }));
  const beats = rows(false);
  const units = rows(true);
  const unique = (list: readonly ClickRow[]) =>
    new Set(list.map((row) => row.tick)).size === list.length;
  return {
    name,
    meter: `${spec.meter[0]}/${spec.meter[1]}`,
    grouping: (spec.grouping ?? []).join("+") || "-",
    barTicks: barTicks({ timeSignature: spec.meter, resolution: spec.resolution }),
    beats,
    units,
    onePulseOneClick: unique(beats) && unique(units),
    mainBeatsUnmoved: beats.every((beat) =>
      units.some((unit) => unit.tick === beat.tick && unit.role === beat.role),
    ),
  };
}

/* ------------------------------------------------- the accent A/B control */

export type AccentContrast = {
  readonly mode: string;
  readonly sampleRate: number;
  /** The loudest measured onset in this render, for a cross-mode comparison. */
  readonly absolutePeak: number;
  readonly planGainRatio: number;
  readonly notes: readonly {
    readonly index: number;
    readonly accented: boolean;
    /** True when the note is played by a voice of its own rather than the sampler. */
    readonly expressive: boolean;
    readonly planGain: number;
    readonly planEnvelopePeak: number | null;
    readonly rms25: number;
    readonly peak: number;
    readonly peakDb: number;
  }[];
  /** Mean accented ÷ mean plain, in the PCM. */
  readonly measuredPeakRatio: number;
  readonly measuredRmsRatio: number;
  readonly measuredDb: number;
  readonly health: ReturnType<typeof healthOf>;
  readonly wavBase64: string;
};

/**
 * Eight identical notes, every other one accented.
 *
 * One pitch, one string, one duration, one velocity — so the only thing that
 * can differ between an odd note and an even one is the accent, and the ratio
 * measured in the PCM is the accent's whole contribution with nothing else
 * to confound it. This is the control §5 asks for.
 */
/**
 * Which attack every note of the control bar carries.
 *
 * `alternating` is the A/B the accent question needs; the rest are the
 * regression matrix §5 asks for when a global attack behaviour changes —
 * every attack the layer knows, measured against the same eight plain notes.
 */
export type AccentMode =
  | "alternating"
  | "all-plain"
  | "all-accent"
  | "all-ghost"
  | "all-dead"
  | "all-tapping"
  | "all-natural_harmonic"
  | "all-pinch_harmonic";

export const accentModes = (): AccentMode[] => [
  "alternating",
  "all-plain",
  "all-accent",
  "all-ghost",
  "all-dead",
  "all-tapping",
  "all-natural_harmonic",
  "all-pinch_harmonic",
];

export async function renderAccentContrast(
  mode: AccentMode = "alternating",
): Promise<AccentContrast | null> {
  const track = SAMPLE_SONG.tracks.find((entry) => entry.fretboard !== undefined);
  const fretboard = track?.fretboard;
  const section = SAMPLE_SONG.sections[0];
  if (!track || !fretboard || !section) return null;
  const pitch = pitchAt(fretboard, STRING, 5);
  if (pitch === null) return null;

  const lane: MelodicSlot[] = Array.from({ length: 8 }, (_unused, index) => ({
    notes: [
      {
        pitch,
        position: { string: STRING, fret: 5 },
        ...(mode === "alternating"
          ? index % 2 === 1
            ? { attack: "accent" as const }
            : {}
          : mode === "all-plain"
            ? {}
            : { attack: mode.slice("all-".length) as NoteEvent["attack"] }),
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
        bars: [
          {
            timeSignature: [4, 4] as Bar["timeSignature"],
            resolution: 8,
            slots,
          } satisfies Bar,
        ],
      },
    ],
  });
  if (!staged.ok) return null;

  const planned = plannedNotes(staged.song, track.id, 0, 768);
  const rendered = await renderSongToBuffer(staged.song, {
    audibleTrackIds: [track.id],
  });
  const samples = mono(rendered.channels);

  const notes = planned.map((note, index) => {
    const at = Math.round(note.startSeconds * rendered.sampleRate);
    const stats = windowStats(samples, at, at + Math.round(rendered.sampleRate * 0.025));
    return {
      index,
      accented: note.authoredAttack !== null,
      expressive: note.expressive,
      planGain: note.gain,
      planEnvelopePeak: note.envelopePeak,
      rms25: round(stats.rms),
      peak: round(stats.peak),
      peakDb: dbfs(stats.peak),
    };
  });

  const mean = (values: readonly number[]): number =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  const accented = notes.filter((note) => note.accented);
  const plain = notes.filter((note) => !note.accented);
  const peakRatio = mean(plain.map((n) => n.peak)) === 0
    ? 0
    : mean(accented.map((n) => n.peak)) / mean(plain.map((n) => n.peak));

  const wav = encodeWav({ channels: rendered.channels, sampleRate: rendered.sampleRate });

  return {
    mode,
    sampleRate: rendered.sampleRate,
    absolutePeak: round(Math.max(...notes.map((note) => note.peak))),
    planGainRatio: round(
      (planned.find((n) => n.authoredAttack === "accent")?.gainRatio ?? 1),
      4,
    ),
    notes,
    measuredPeakRatio: round(peakRatio, 4),
    measuredRmsRatio: round(
      mean(plain.map((n) => n.rms25)) === 0
        ? 0
        : mean(accented.map((n) => n.rms25)) / mean(plain.map((n) => n.rms25)),
      4,
    ),
    measuredDb: dbfs(peakRatio),
    health: healthOf(rendered.channels),
    wavBase64: wav.ok ? base64(wav.bytes) : "",
  };
}

/* ---------------------------------------------- the bar-boundary fixtures */

type Hit = { readonly slot: number; readonly fret: number; readonly hold?: number };

type BarSpec = {
  readonly meter: TimeSignature;
  readonly resolution: Resolution;
  readonly grouping?: readonly number[];
  readonly hits: readonly Hit[];
};

/** A song of exactly these bars, on one fretted track of the sample song. */
function songOf(specs: readonly BarSpec[]): { song: Song; trackId: string } | null {
  const track = SAMPLE_SONG.tracks.find((entry) => entry.fretboard !== undefined);
  const fretboard = track?.fretboard;
  const section = SAMPLE_SONG.sections[0];
  if (!track || !fretboard || !section) return null;

  const bars = specs.map((spec) => {
    const width = (spec.meter[0] * spec.resolution) / spec.meter[1];
    const lane: MelodicSlot[] = Array.from({ length: width }, () => null);
    for (const hit of spec.hits) {
      const pitch = pitchAt(fretboard, STRING, hit.fret);
      if (pitch === null) continue;
      const note: NoteEvent = { pitch, position: { string: STRING, fret: hit.fret } };
      lane[hit.slot] = { notes: [note] };
      for (let step = 1; step <= (hit.hold ?? 0); step += 1) {
        if (hit.slot + step < width) lane[hit.slot + step] = "-";
      }
    }
    const slots: Record<string, MelodicSlot[] | DrumSlot[]> = {};
    for (const entry of SAMPLE_SONG.tracks) {
      const existing = section.bars[0]?.slots[entry.id];
      slots[entry.id] =
        existing && isDrumSlotArray(existing)
          ? Array.from({ length: width }, () => [] as DrumSlot)
          : Array.from({ length: width }, () => null as MelodicSlot);
    }
    slots[track.id] = lane;
    return {
      timeSignature: [spec.meter[0], spec.meter[1]] as Bar["timeSignature"],
      resolution: spec.resolution,
      ...(spec.grouping ? { grouping: [...spec.grouping] } : {}),
      slots,
    } satisfies Bar;
  });

  const staged = settle({
    ...SAMPLE_SONG,
    sections: [{ ...section, bars }],
  });
  if (!staged.ok) return null;
  return { song: staged.song, trackId: track.id };
}

/** One struck note on every notated unit of the bar, so every unit is visible. */
const everyUnit = (units: number, resolution: number, meter: TimeSignature): Hit[] => {
  const perUnit = resolution / meter[1];
  return Array.from({ length: units }, (_unused, index) => ({
    slot: index * perUnit,
    fret: 5 + (index % 3),
    hold: perUnit - 1,
  }));
};

export const BOUNDARY_FIXTURES: Readonly<Record<string, readonly BarSpec[]>> = {
  "4-4": [
    { meter: [4, 4], resolution: 8, hits: everyUnit(4, 8, [4, 4]) },
    { meter: [4, 4], resolution: 8, hits: everyUnit(4, 8, [4, 4]) },
  ],
  "6-8-compound": [
    { meter: [6, 8], resolution: 8, grouping: [3, 3], hits: everyUnit(6, 8, [6, 8]) },
    { meter: [6, 8], resolution: 8, grouping: [3, 3], hits: everyUnit(6, 8, [6, 8]) },
  ],
  "6-8-triplet-run": [
    {
      meter: [6, 8],
      resolution: 48,
      grouping: [3, 3],
      hits: [
        { slot: 0, fret: 5, hold: 5 },
        { slot: 6, fret: 7, hold: 5 },
        { slot: 12, fret: 5, hold: 5 },
        ...Array.from({ length: 9 }, (_unused, index) => ({
          slot: 18 + index * 2,
          fret: index % 2 === 0 ? 7 : 5,
          hold: 1,
        })),
      ],
    },
    { meter: [6, 8], resolution: 8, grouping: [3, 3], hits: everyUnit(6, 8, [6, 8]) },
  ],
  "7-8-223": [
    { meter: [7, 8], resolution: 8, grouping: [2, 2, 3], hits: everyUnit(7, 8, [7, 8]) },
    { meter: [7, 8], resolution: 8, grouping: [2, 2, 3], hits: everyUnit(7, 8, [7, 8]) },
  ],
  "7-8-322": [
    { meter: [7, 8], resolution: 8, grouping: [3, 2, 2], hits: everyUnit(7, 8, [7, 8]) },
    { meter: [7, 8], resolution: 8, grouping: [3, 2, 2], hits: everyUnit(7, 8, [7, 8]) },
  ],
  mixed: [
    { meter: [5, 8], resolution: 8, grouping: [2, 3], hits: everyUnit(5, 8, [5, 8]) },
    { meter: [7, 8], resolution: 8, grouping: [2, 2, 3], hits: everyUnit(7, 8, [7, 8]) },
    { meter: [6, 8], resolution: 8, grouping: [3, 3], hits: everyUnit(6, 8, [6, 8]) },
  ],
  "cross-meter-phrase": [
    {
      meter: [7, 8],
      resolution: 8,
      grouping: [2, 2, 3],
      hits: [
        { slot: 0, fret: 5, hold: 1 },
        { slot: 2, fret: 7, hold: 1 },
        /* Held to the bar line, so what crosses it is a real ringing note. */
        { slot: 4, fret: 9, hold: 2 },
      ],
    },
    {
      meter: [6, 8],
      resolution: 8,
      grouping: [3, 3],
      hits: [
        { slot: 0, fret: 9, hold: 2 },
        { slot: 3, fret: 7, hold: 2 },
      ],
    },
  ],
  "loop-selection": [
    { meter: [7, 8], resolution: 8, grouping: [2, 2, 3], hits: everyUnit(7, 8, [7, 8]) },
    { meter: [7, 8], resolution: 8, grouping: [2, 2, 3], hits: everyUnit(7, 8, [7, 8]) },
    { meter: [7, 8], resolution: 8, grouping: [2, 2, 3], hits: everyUnit(7, 8, [7, 8]) },
  ],
  "release-tail": [
    { meter: [6, 8], resolution: 8, grouping: [3, 3], hits: everyUnit(6, 8, [6, 8]) },
    /* One long note at the top of the last bar and nothing after it, so the
       tail is the only thing left to mistake for a bar. */
    { meter: [6, 8], resolution: 8, grouping: [3, 3], hits: [{ slot: 0, fret: 5, hold: 5 }] },
  ],
};

export const boundaryNames = (): string[] => Object.keys(BOUNDARY_FIXTURES);

export type BarBoundary = {
  readonly barNumber: number;
  readonly meter: string;
  readonly startTicks: number;
  readonly startSeconds: number;
  readonly endTicks: number;
  readonly endSeconds: number;
  /** The first PCM rise the detector found at or after this bar's start. */
  readonly firstOnsetSeconds: number | null;
  readonly onsetErrorMs: number | null;
  /** Seconds of silence between the previous bar's last rise and this one. */
  readonly gapFromPreviousMs: number | null;
};

export type BoundaryAnalysis = {
  readonly name: string;
  readonly sampleRate: number;
  readonly frames: number;
  readonly seconds: number;
  readonly notatedEndTicks: number;
  readonly notatedEndSeconds: number;
  readonly renderSeconds: number;
  readonly tailSeconds: number;
  readonly expressionSeconds: number;
  readonly loopEndTicks: number;
  readonly barTickSum: number;
  readonly detector: { readonly floor: number; readonly threshold: number; readonly count: number };
  readonly bars: readonly BarBoundary[];
  readonly lastEventEndSeconds: number;
  readonly health: ReturnType<typeof healthOf>;
  readonly activeAfterDispose: number;
  readonly wavBase64: string;
};

/**
 * Render one fixture and read its bar lines out of the PCM.
 *
 * The expected times come from the production tempo map and the production
 * bar timeline; the measured ones come from the detector, which was given
 * only the buffer. Neither is derived from the other.
 */
export async function renderBoundary(name: string): Promise<BoundaryAnalysis | null> {
  const specs = BOUNDARY_FIXTURES[name];
  if (!specs) return null;
  const built = songOf(specs);
  if (!built) return null;

  const bars = barTimeline(built.song);
  const tempo = buildTempoMap(built.song);
  const duration = renderDuration(built.song);
  const rendered = await renderSongToBuffer(built.song, {
    audibleTrackIds: [built.trackId],
  });
  const samples = mono(rendered.channels);
  const detected = detectOnsets(samples, rendered.sampleRate);

  const rows: BarBoundary[] = bars.map((bar, index) => {
    const startSeconds = secondsAtTicks(tempo, bar.time);
    const endTicks = bar.time + bar.durationTicks;
    const first = detected.onsets.find(
      (onset) => onset.seconds >= startSeconds - 0.03 && onset.seconds < startSeconds + 0.08,
    );
    const previousStart = index === 0 ? null : secondsAtTicks(tempo, bars[index - 1]!.time);
    const previousLast =
      previousStart === null
        ? null
        : [...detected.onsets].reverse().find((onset) => onset.seconds < startSeconds - 0.03);
    return {
      barNumber: bar.barNumber,
      meter: `${bar.timeSignature[0]}/${bar.timeSignature[1]}`,
      startTicks: bar.time,
      startSeconds: round(startSeconds),
      endTicks,
      endSeconds: round(secondsAtTicks(tempo, endTicks)),
      firstOnsetSeconds: first ? first.seconds : null,
      onsetErrorMs: first ? round((first.seconds - startSeconds) * 1000, 3) : null,
      gapFromPreviousMs:
        first && previousLast ? round((first.seconds - previousLast.seconds) * 1000, 3) : null,
    };
  });

  const barTickSum = specs.reduce(
    (total, spec) =>
      total + barTicks({ timeSignature: spec.meter, resolution: spec.resolution }),
    0,
  );
  const notatedEndTicks = bars.reduce((end, bar) => Math.max(end, bar.time + bar.durationTicks), 0);
  const wav = encodeWav({
    channels: rendered.channels,
    sampleRate: rendered.sampleRate,
  });

  return {
    name,
    sampleRate: rendered.sampleRate,
    frames: rendered.frames,
    seconds: round(rendered.frames / rendered.sampleRate),
    notatedEndTicks,
    notatedEndSeconds: round(secondsAtTicks(tempo, notatedEndTicks)),
    renderSeconds: round(duration.totalSeconds),
    tailSeconds: round(duration.tailSeconds),
    expressionSeconds: round(duration.expressionSeconds),
    loopEndTicks: notatedEndTicks,
    barTickSum,
    detector: {
      floor: detected.floor,
      threshold: detected.threshold,
      count: detected.onsets.length,
    },
    bars: rows,
    lastEventEndSeconds: round(duration.notatedSeconds),
    health: healthOf(rendered.channels),
    activeAfterDispose: rendered.activeAfterDispose,
    wavBase64: wav.ok ? base64(wav.bytes) : "",
  };
}

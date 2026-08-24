/**
 * The bend and slide benchmark, rendered for real (2P-A §10, §11, §12).
 *
 * Evaluation only. Every render goes through the production `createEngine`
 * and the production `scheduleSong`, on an offline context, with the
 * production expression plan — and a candidate is expressed by *replacing
 * the plan's automation*, never by adding a field to a Song or an option to
 * the product. Nothing here is reachable from the interface, and the
 * `articulation` values written into the fixture songs are the ones the
 * schema already has.
 *
 * The current production behaviour is one of the candidates, and it is
 * produced by leaving the plan alone. A "baseline" reconstructed by hand
 * would prove nothing about what ships.
 */
import {
  attackRatioAt,
  bandEnergy,
  centsBetween,
  centsTrack,
  seedFrom,
  seededNoise,
  spectralCentroid,
  trackPitch,
} from "./analysis";
import {
  FRET_NOISE_CANDIDATES,
  SHIFT_ATTACK_LEVELS,
  bendCandidateAutomation,
  slideCandidateAutomation,
  type BendCandidate,
  type SlideCandidate,
} from "./candidates";
import { barOf, guitar, held, note, songOf, struck, tie } from "./fixtures";

import {
  createEngine,
  loadTone,
  scheduleSong,
  type Engine,
} from "@/lib/audio/engine";
import type {
  ExpressionPlan,
  ExpressiveNotePlan,
} from "@/lib/audio/expression-plan";
import { nearestSample, playbackRateFor } from "@/lib/audio/sample-map";
import { buildTempoMap } from "@/lib/audio/tempo";
import { audioExportLimits } from "@/lib/limits";
import { pitchToMidi } from "@/lib/music/pitch";
import { encodeWav } from "@/lib/export/wav-encoder";
import type { Song } from "@/lib/song/schema";

const RATE = audioExportLimits.sampleRate;
const round = (value: number): number => Math.round(value * 1e6) / 1e6;

/* ------------------------------------------------------------- the render */

/**
 * Extra sound a candidate needs that the production engine does not make.
 *
 * Given the Tone module rather than the raw context: a native `GainNode`
 * cannot be connected to a Tone `Channel` — its `input` is a Tone node, not
 * an `AudioNode` — and the first version of this failed at exactly that
 * point. Everything a candidate adds is built with the same node types the
 * engine uses, on the same injected context.
 */
type Extras = (
  tone: typeof import("tone"),
  context: unknown,
  engine: Engine,
) => number;

type Rendered = {
  channels: Float32Array[];
  plan: ExpressionPlan | null;
  mono: Float32Array;
  seconds: number;
  activeAfterDispose: number;
  logicalVoices: number;
  physicalSources: number;
  extraSources: number;
};

/**
 * Render one song with one plan.
 *
 * The plan is set **before** `scheduleSong`, because that is where the
 * scheduler reads it: the same door the practice-rate change uses, and not a
 * new one opened for the benchmark.
 */
async function renderWithPlan(
  song: Song,
  makePlan: (base: ExpressionPlan) => ExpressionPlan,
  extras?: Extras,
): Promise<Rendered> {
  const tone = await loadTone();
  const seconds = buildTempoMap(song).totalSeconds + 2.5;

  let built: Engine | null = null;
  let applied: ExpressionPlan | null = null;
  let extraSources = 0;

  const buffer = (await (
    tone as unknown as {
      Offline: (
        build: (context: unknown) => Promise<void>,
        seconds: number,
        channels: number,
        rate: number,
      ) => Promise<{
        numberOfChannels: number;
        length: number;
        sampleRate: number;
        toArray(): Float32Array | Float32Array[];
      }>;
    }
  ).Offline(
    async (context) => {
      const engine = await createEngine(song, context as never);
      built = engine;
      applied = makePlan(engine.expression.getPlan());
      engine.expression.setPlan(applied);
      scheduleSong(engine, buildTempoMap(song), { metronomeEnabled: () => false });
      if (extras) extraSources = extras(tone, context, engine);
      (context as { transport: { start(at: number): void } }).transport.start(0);
    },
    seconds,
    audioExportLimits.channels,
    RATE,
  )) as {
    sampleRate: number;
    toArray(): Float32Array | Float32Array[];
  };

  const raw = buffer.toArray();
  const planar = Array.isArray(raw) ? raw : [raw];
  const channels = planar.length >= 2 ? planar.slice(0, 2) : [planar[0]!, planar[0]!];

  const engine = built as Engine | null;
  let activeAfterDispose = -1;
  let logicalVoices = 0;
  let physicalSources = 0;
  if (engine) {
    /*
     * Two different questions, kept apart on purpose.
     *
     * A **logical voice** is a note a listener would say they heard. A
     * **physical source** is a buffer that actually played. The first version
     * of this counted only the expressive pool, so the shift candidate's
     * extra sampler onset was invisible and the render cheerfully reported
     * the same cost as the legato one — which is the exact claim §11 says
     * must not be made. Sampler onsets are counted now, and so is anything a
     * candidate added by hand.
     */
    // Cast for the same reason `built` needs one: the assignment happens
    // inside the render callback, where control-flow analysis cannot see it.
    const plan = applied as ExpressionPlan | null;
    const samplerOnsets = (plan?.notes ?? []).filter(
      (entry) => entry.chainId === undefined && !entry.expressive,
    );
    const shiftAttacks = samplerOnsets.filter((entry) =>
      entry.id.endsWith(":shift-attack"),
    ).length;
    logicalVoices =
      engine.expression.counts.primary + samplerOnsets.length - shiftAttacks;
    physicalSources =
      engine.expression.counts.started + samplerOnsets.length + extraSources;
    engine.expression.stopAll();
    engine.dispose();
    activeAfterDispose = engine.expression.counts.active;
  }

  const frames = channels[0]!.length;
  const mono = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1) {
    mono[index] = ((channels[0]![index] ?? 0) + (channels[1]![index] ?? 0)) / 2;
  }

  return {
    channels,
    plan: applied,
    mono,
    seconds: frames / RATE,
    activeAfterDispose,
    logicalVoices,
    physicalSources,
    extraSources,
  };
}

/* ---------------------------------------------------------- plan surgery */

/** Replace one note's pitch automation, leaving everything else alone. */
const withAutomation = (
  match: (note: ExpressiveNotePlan) => boolean,
  points: (note: ExpressiveNotePlan) => ExpressiveNotePlan["pitchAutomation"],
) =>
  (base: ExpressionPlan): ExpressionPlan => ({
    ...base,
    notes: base.notes.map((entry) =>
      match(entry)
        ? { ...entry, expressive: true, pitchAutomation: points(entry) }
        : entry,
    ),
  });

const keepPlan = (base: ExpressionPlan): ExpressionPlan => base;

/* ------------------------------------------------------------- measuring */

function energy(samples: Float32Array): { peak: number; rms: number } {
  let peak = 0;
  let sum = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index]!;
    peak = Math.max(peak, Math.abs(value));
    sum += value * value;
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, samples.length)) };
}

function clippedSamples(channels: readonly Float32Array[]): number {
  let count = 0;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      if (Math.abs(channel[index]!) >= 1) count += 1;
    }
  }
  return count;
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary);
};

export type PitchMeasurement = {
  /** Where the pitch settled, in cents from the written note. */
  readonly reachedCents: number | null;
  /** The single furthest frame, kept so the plateau can be checked against it. */
  readonly peakCents: number | null;
  readonly reachedAtSeconds: number | null;
  readonly heldSeconds: number | null;
  readonly releaseStartSeconds: number | null;
  readonly returnedToZeroAtSeconds: number | null;
  readonly centsAtNoteEnd: number | null;
  readonly overshootCents: number;
  readonly voicedFrames: number;
  readonly totalFrames: number;
};

/**
 * What the pitch did, read off the rendered audio.
 *
 * Deliberately not read off the automation: automation is what was asked
 * for, and the whole question is whether the sound did it.
 */
function measurePitch(
  mono: Float32Array,
  referenceHz: number,
  noteStart: number,
  noteEnd: number,
): PitchMeasurement {
  const frames = trackPitch(mono, { sampleRate: RATE });
  const cents = centsTrack(frames, referenceHz).filter(
    (frame) => frame.timeSeconds >= noteStart && frame.timeSeconds <= noteEnd,
  );
  if (cents.length === 0) {
    return {
      reachedCents: null,
      peakCents: null,
      reachedAtSeconds: null,
      heldSeconds: null,
      releaseStartSeconds: null,
      returnedToZeroAtSeconds: null,
      centsAtNoteEnd: null,
      overshootCents: 0,
      voicedFrames: 0,
      totalFrames: frames.length,
    };
  }

  /*
   * The plateau, found by time and then averaged — not picked by value.
   *
   * Two wrong versions of this came first, and both were the same mistake.
   * Taking the frame furthest from zero is a maximum over a noisy series, so
   * it lands wherever the tracker over-read: +208.9 on a +200 cent bend.
   * Taking the median of the highest fifteen percent of frames is the same
   * selection bias, quieter: +206.3. Both were choosing frames *because*
   * they read high, which guarantees an over-estimate.
   *
   * So the region is located by value and the value is read from the region.
   * A rough top figure says where to look; the number reported is the median
   * of every frame between arrival and departure, whatever each one read.
   */
  const magnitudes = [...cents].map((frame) => Math.abs(frame.cents)).sort((a, b) => a - b);
  const roughTop = magnitudes[Math.floor(magnitudes.length * 0.9)] ?? 0;
  const sorted = [...cents].sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
  const extreme = sorted[0]!;
  const sign = extreme.cents < 0 ? -1 : 1;

  const arrival =
    cents.find((frame) => Math.abs(frame.cents) >= roughTop - 50 && frame.cents * sign > 0) ??
    extreme;
  const afterArrival = cents.filter((frame) => frame.timeSeconds >= arrival.timeSeconds);
  const leaving = afterArrival.find(
    (frame) => Math.abs(Math.abs(frame.cents) - roughTop) > 50,
  );
  const plateau = afterArrival
    .filter(
      (frame) =>
        frame.timeSeconds >= arrival.timeSeconds + 0.04 &&
        (leaving === undefined || frame.timeSeconds < leaving.timeSeconds),
    )
    .map((frame) => frame.cents)
    .sort((a, b) => a - b);
  const target =
    plateau.length > 0 ? plateau[Math.floor(plateau.length / 2)]! : extreme.cents;
  const zeroed = afterArrival.find((frame) => Math.abs(frame.cents) <= 25);
  const end = cents[cents.length - 1]!;

  return {
    reachedCents: round(target),
    peakCents: round(extreme.cents),
    reachedAtSeconds: round(arrival.timeSeconds - noteStart),
    heldSeconds: round((leaving?.timeSeconds ?? end.timeSeconds) - arrival.timeSeconds),
    releaseStartSeconds: leaving ? round(leaving.timeSeconds - noteStart) : null,
    returnedToZeroAtSeconds: zeroed ? round(zeroed.timeSeconds - noteStart) : null,
    centsAtNoteEnd: round(end.cents),
    // How far past the plateau the loudest excursion went. On a well-behaved
    // curve this is the tracker's own noise; on a badly-behaved one it is
    // overshoot, and the two are told apart by comparing it with the
    // instrument's measured error.
    overshootCents: round(Math.max(0, Math.abs(extreme.cents) - Math.abs(target))),
    voicedFrames: cents.length,
    totalFrames: frames.length,
  };
}

export type FixtureMeasurement = {
  readonly name: string;
  readonly group: "bend" | "slide" | "timbre";
  readonly what: string;
  readonly isProductionBaseline: boolean;
  readonly notatedOnsetSeconds: number;
  readonly noteDurationSeconds: number;
  readonly nominalTargetCents: number | null;
  readonly pitch: PitchMeasurement | null;
  readonly automationPoints: number;
  readonly steadyVoiceAutomationPoints: number | null;
  readonly targetAttackRatio: number | null;
  readonly noiseBandEnergy: number | null;
  readonly centroidAtTargetHz: number | null;
  readonly logicalVoices: number;
  readonly physicalSources: number;
  readonly extraSources: number;
  readonly activeAfterDispose: number;
  readonly peak: number;
  readonly rms: number;
  readonly clippedSamples: number;
  readonly seconds: number;
  readonly wavBase64: string;
};

/* ------------------------------------------------------------- fixtures */

type Fixture = {
  readonly what: string;
  readonly group: "bend" | "slide" | "timbre";
  readonly song: Song;
  readonly plan: (base: ExpressionPlan) => ExpressionPlan;
  readonly isProductionBaseline?: boolean;
  /** The written note the pitch is measured against. */
  readonly referencePitch: string;
  readonly onsetSlot: number;
  readonly noteSlots: number;
  readonly nominalTargetCents?: number;
  /** Seconds from the start of the song where a target arrival is expected. */
  readonly targetAtSlot?: number;
  readonly extras?: Extras;
  /** A second, deliberately steady note, to prove it was not modulated. */
  readonly steadyPitch?: string;
};

const BPM = 90;
const SLOT_SECONDS = (60 / BPM) / 2; // an eighth note at 90 bpm

/** A single note held for the whole bar, with an articulation of its own. */
function oneNote(articulation: string | undefined, slots = 8): Song {
  const track = guitar();
  return songOf(
    track,
    [
      barOf(
        track.id,
        held(
          struck(
            note("A3", 3, 2, articulation ? { articulation: articulation as never } : {}),
          ),
          slots,
        ),
      ),
    ],
    BPM,
  );
}

/** Two notes on one string: a source and, four slots later, a target. */
function twoNotes(
  targetPitch: string,
  targetFret: number,
  articulation: string | undefined,
  sourcePitch = "A3",
  sourceFret = 2,
): Song {
  const track = guitar();
  return songOf(
    track,
    [
      barOf(track.id, [
        ...held(struck(note(sourcePitch, 3, sourceFret)), 4),
        ...held(
          struck(
            note(targetPitch, 3, targetFret, articulation ? { articulation: articulation as never } : {}),
          ),
          4,
        ),
      ]),
    ],
    BPM,
  );
}

/** A chord where one string moves and the others are written to stay still. */
function chordWithOneMoving(articulation: string): Song {
  const track = guitar();
  return songOf(
    track,
    [
      barOf(
        track.id,
        held(
          struck(
            note("E3", 5, 0),
            note("A3", 3, 2, { articulation: articulation as never }),
            note("C4", 2, 1),
          ),
          8,
        ),
      ),
    ],
    BPM,
  );
}

/** Four notes with the gesture in the middle, so it is heard in context. */
function riff(articulation: string | undefined): Song {
  const track = guitar();
  return songOf(
    track,
    [
      barOf(track.id, [
        struck(note("E3", 5, 0)),
        struck(note("G3", 4, 0)),
        ...held(
          struck(note("A3", 3, 2, articulation ? { articulation: articulation as never } : {})),
          4,
        ),
        struck(note("C4", 2, 1)),
        tie,
      ]),
    ],
    BPM,
  );
}

const bendPlan = (candidate: BendCandidate) =>
  withAutomation(
    (entry) => entry.pitch === "A3",
    (entry) => bendCandidateAutomation(candidate, entry.durationSeconds),
  );

const slidePlan = (candidate: SlideCandidate, pitch: string) =>
  withAutomation(
    (entry) => entry.pitch === pitch,
    (entry) => slideCandidateAutomation(candidate, entry.durationSeconds),
  );


/**
 * The shift-slide candidate: the same travel, plus a real attack on arrival.
 *
 * The chain still owns the glide, so the pitch behaves exactly as the legato
 * candidate's does — and a second, ordinary onset is added at the target's
 * tick at a chosen level. That is the whole difference between the two
 * candidates, and keeping it to one difference is what makes the listening
 * test answerable.
 *
 * It costs a second physical source. The measurement reports logical voices
 * and physical sources separately, because calling this "one voice" and
 * leaving it there would be the kind of claim this checkpoint exists to stop.
 */
function withTargetAttack(targetPitch: string, level: number) {
  return (base: ExpressionPlan): ExpressionPlan => {
    const target = base.notes.find(
      (entry) => entry.pitch === targetPitch && entry.chainRole === "target",
    );
    if (!target) return base;
    return {
      ...base,
      notes: [
        ...base.notes,
        {
          ...target,
          id: `${target.id}:shift-attack`,
          gain: round(target.gain * level),
          // Struck by the sampler, not by a voice of its own: this is an
          // attack, not a second interpretation of the note.
          expressive: false,
          pitchAutomation: [{ timeSeconds: 0, cents: 0, curve: "step" as const }],
          chainId: undefined,
          chainRole: undefined,
          articulation: undefined,
        },
      ],
    };
  };
}

/**
 * A short, quiet, deterministic noise burst under the travel (2P-A §11).
 *
 * No external sample: the noise is generated here from a seed derived from
 * the fixture's own name, so two runs produce identical audio and the seed
 * never goes anywhere near a Song. It is band-limited and short, because the
 * question is whether a little movement noise helps the ear read a slide —
 * not whether an obvious effect is audible.
 */
function fretNoiseExtras(fixtureName: string, candidateIndex: number): Extras {
  return (tone, context, engine) => {
    const candidate = FRET_NOISE_CANDIDATES[candidateIndex];
    if (!candidate || candidate.kind !== "fret_noise") return 0;
    const voice = engine.voices.get("gtr");
    if (!voice || voice.kind !== "sampler") return 0;

    const length = Math.round(candidate.seconds * RATE);
    const noise = NOISE_OF(SEED_OF(fixtureName), length);
    const shaped = new Float32Array(length);
    // A short fade at each end, so the burst is movement rather than a click.
    for (let index = 0; index < length; index += 1) {
      const edge = Math.min(index, length - index) / (length * 0.25);
      shaped[index] = noise[index]! * Math.min(1, edge);
    }

    const buffer = new tone.ToneAudioBuffer().fromArray(shaped);
    const filter = new tone.Filter({
      context: context as never,
      type: "bandpass",
      frequency: candidate.filterHz,
      Q: 0.8,
    });
    const gain = new tone.Gain({ context: context as never, gain: candidate.gain });
    const source = new tone.ToneBufferSource({ context: context as never, url: buffer });

    source.connect(filter);
    filter.connect(gain);
    // Into the track's own channel, so the mix applies to it like everything
    // else on that track.
    gain.connect(voice.channel);

    // The travel ends when the target is written; the noise sits just before.
    const arrivesAt = 4 * SLOT_SECONDS;
    source.start(Math.max(0, arrivesAt - candidate.seconds * 0.8));
    return 1;
  };
}

/**
 * Two neighbouring recordings crossfaded under one logical voice.
 *
 * The production engine plays a slide by moving one sample's playback rate,
 * which moves its whole spectrum with it — the reason a wide slide can sound
 * like a bend. This candidate keeps the source sample for the first half of
 * the travel and fades into the sample nearest the destination for the
 * second, so the timbre arrives where the pitch does.
 *
 * It is **two physical sources**. The render says so.
 */
function crossfadeExtras(targetPitch: string): Extras {
  return (tone, context, engine) => {
    const voice = engine.voices.get("gtr");
    if (!voice || voice.kind !== "sampler") return 0;
    const targetMidi = pitchToMidi(targetPitch);
    if (targetMidi === null) return 0;
    const entry = NEAREST(voice.entries, targetMidi);
    if (!entry) return 0;

    const source = new tone.ToneBufferSource({
      context: context as never,
      url: voice.buffers.get(entry.note),
      playbackRate: RATE_FOR(entry.midi, targetMidi),
    });
    const gain = new tone.Gain({ context: context as never, gain: 0 });

    const arrivesAt = 4 * SLOT_SECONDS;
    const overlap = 0.12;
    const from = Math.max(0, arrivesAt - overlap);
    gain.gain.setValueAtTime(0, from);
    gain.gain.linearRampToValueAtTime(voice.trimGain * 0.5, arrivesAt);

    source.connect(gain);
    gain.connect(voice.channel);
    source.start(from);
    return 1;
  };
}

/** A four-note riff with the slide in the middle of it. */
function slideRiff(): Song {
  const track = guitar();
  return songOf(
    track,
    [
      barOf(track.id, [
        struck(note("E3", 5, 0)),
        struck(note("G3", 4, 0)),
        ...held(struck(note("A3", 3, 2)), 2),
        ...held(struck(note("C4", 3, 5, { articulation: "slide" })), 2),
        struck(note("G3", 4, 0)),
        tie,
      ]),
    ],
    BPM,
  );
}

const FIXTURES: Readonly<Record<string, Fixture>> = {
  /* ------------------------------------------------------------- bend */
  "bend-01-current-half": {
    what: "bugünkü yarım bend, olduğu gibi",
    group: "bend",
    song: oneNote("bend_half"),
    plan: keepPlan,
    isProductionBaseline: true,
    referencePitch: "A3",
    onsetSlot: 0,
    noteSlots: 8,
    nominalTargetCents: 100,
  },
  "bend-02-current-full": {
    what: "bugünkü tam bend, olduğu gibi",
    group: "bend",
    song: oneNote("bend_full"),
    plan: keepPlan,
    isProductionBaseline: true,
    referencePitch: "A3",
    onsetSlot: 0,
    noteSlots: 8,
    nominalTargetCents: 200,
  },
  "bend-03-plain-hold-100": {
    what: "düz bend +100: yüksel, tut, geri dönme",
    group: "bend",
    song: oneNote("bend_half"),
    plan: bendPlan({ kind: "bend", targetCents: 100 }),
    referencePitch: "A3",
    onsetSlot: 0,
    noteSlots: 8,
    nominalTargetCents: 100,
  },
  "bend-04-plain-hold-200": {
    what: "düz bend +200: yüksel, tut, geri dönme",
    group: "bend",
    song: oneNote("bend_full"),
    plan: bendPlan({ kind: "bend", targetCents: 200 }),
    referencePitch: "A3",
    onsetSlot: 0,
    noteSlots: 8,
    nominalTargetCents: 200,
  },
  "bend-05-release-100": {
    what: "bend/release +100: yüksel, tut, in",
    group: "bend",
    song: oneNote("bend_half"),
    plan: bendPlan({ kind: "bend_release", targetCents: 100 }),
    referencePitch: "A3",
    onsetSlot: 0,
    noteSlots: 8,
    nominalTargetCents: 100,
  },
  "bend-06-release-200": {
    what: "bend/release +200: yüksel, tut, in",
    group: "bend",
    song: oneNote("bend_full"),
    plan: bendPlan({ kind: "bend_release", targetCents: 200 }),
    referencePitch: "A3",
    onsetSlot: 0,
    noteSlots: 8,
    nominalTargetCents: 200,
  },
  "bend-07-prebend-200": {
    what: "prebend +200: ilk duyulan anda hedefte",
    group: "bend",
    song: oneNote("bend_full"),
    plan: bendPlan({ kind: "prebend", targetCents: 200 }),
    referencePitch: "A3",
    onsetSlot: 0,
    noteSlots: 8,
    nominalTargetCents: 200,
  },
  "bend-08-prebend-release-200": {
    what: "prebend/release +200: hedefte başla, aşağı in",
    group: "bend",
    song: oneNote("bend_full"),
    plan: bendPlan({ kind: "prebend_release", targetCents: 200 }),
    referencePitch: "A3",
    onsetSlot: 0,
    noteSlots: 8,
    nominalTargetCents: 200,
  },
  "bend-09-vibrato-200": {
    what: "bend + vibrato: vibrato hedefe vardıktan sonra",
    group: "bend",
    song: oneNote("bend_full"),
    plan: bendPlan({
      kind: "bend",
      targetCents: 200,
      vibrato: { startAfterTarget: true, depthCents: 14, rateHz: 5 },
    }),
    referencePitch: "A3",
    onsetSlot: 0,
    noteSlots: 8,
    nominalTargetCents: 200,
  },
  "bend-10-short-note": {
    what: "kısa notada bend (tek slot)",
    group: "bend",
    song: oneNote("bend_full", 1),
    plan: keepPlan,
    isProductionBaseline: true,
    referencePitch: "A3",
    onsetSlot: 0,
    noteSlots: 1,
    nominalTargetCents: 200,
  },
  "bend-11-long-note": {
    what: "uzun notada bend (iki ölçü)",
    group: "bend",
    song: (() => {
      const track = guitar();
      return songOf(
        track,
        [
          barOf(track.id, held(struck(note("A3", 3, 2, { articulation: "bend_full" })), 8)),
          barOf(track.id, Array.from({ length: 8 }, () => tie)),
        ],
        BPM,
      );
    })(),
    plan: keepPlan,
    isProductionBaseline: true,
    referencePitch: "A3",
    onsetSlot: 0,
    noteSlots: 16,
    nominalTargetCents: 200,
  },
  "bend-12-tie-hold": {
    what: "tie boyunca bend tutuluyor (aday: sonda sıfırlanmıyor)",
    group: "bend",
    song: (() => {
      const track = guitar();
      return songOf(
        track,
        [
          barOf(track.id, held(struck(note("A3", 3, 2, { articulation: "bend_full" })), 8)),
          barOf(track.id, Array.from({ length: 8 }, () => tie)),
        ],
        BPM,
      );
    })(),
    plan: bendPlan({ kind: "bend", targetCents: 200 }),
    referencePitch: "A3",
    onsetSlot: 0,
    noteSlots: 16,
    nominalTargetCents: 200,
  },
  "bend-13-tie-release-at-end": {
    what: "tie'ın sonunda release",
    group: "bend",
    song: (() => {
      const track = guitar();
      return songOf(
        track,
        [
          barOf(track.id, held(struck(note("A3", 3, 2, { articulation: "bend_full" })), 8)),
          barOf(track.id, Array.from({ length: 8 }, () => tie)),
        ],
        BPM,
      );
    })(),
    plan: bendPlan({ kind: "bend_release", targetCents: 200 }),
    referencePitch: "A3",
    onsetSlot: 0,
    noteSlots: 16,
    nominalTargetCents: 200,
  },
  "bend-14-chord-one-string": {
    what: "akorda tek tel bend, diğerleri sabit",
    group: "bend",
    song: chordWithOneMoving("bend_full"),
    plan: keepPlan,
    isProductionBaseline: true,
    referencePitch: "A3",
    onsetSlot: 0,
    noteSlots: 8,
    nominalTargetCents: 200,
    steadyPitch: "E3",
  },
  "bend-15-riff-current": {
    what: "riff içinde bugünkü bend",
    group: "bend",
    song: riff("bend_full"),
    plan: keepPlan,
    isProductionBaseline: true,
    referencePitch: "A3",
    onsetSlot: 2,
    noteSlots: 4,
    nominalTargetCents: 200,
  },
  "bend-16-riff-plain-hold": {
    what: "aynı riff, düz tutulan bend adayı",
    group: "bend",
    song: riff("bend_full"),
    plan: bendPlan({ kind: "bend", targetCents: 200 }),
    referencePitch: "A3",
    onsetSlot: 2,
    noteSlots: 4,
    nominalTargetCents: 200,
  },
  "bend-17-riff-explicit-release": {
    what: "aynı riff, açık release adayı",
    group: "bend",
    song: riff("bend_full"),
    plan: bendPlan({ kind: "bend_release", targetCents: 200 }),
    referencePitch: "A3",
    onsetSlot: 2,
    noteSlots: 4,
    nominalTargetCents: 200,
  },

  /* ------------------------------------------------------------ slide */
  "slide-01-normal-restrike": {
    what: "iki nota, slide yok: yeniden vuruşun kendisi",
    group: "slide",
    song: twoNotes("C4", 5, undefined),
    plan: keepPlan,
    isProductionBaseline: true,
    referencePitch: "C4",
    onsetSlot: 4,
    noteSlots: 4,
    targetAtSlot: 4,
    steadyPitch: "A3",
  },
  "slide-02-current-up-4": {
    what: "bugünkü slide, +4 yarım ton",
    group: "slide",
    song: twoNotes("C4", 5, "slide"),
    plan: keepPlan,
    isProductionBaseline: true,
    referencePitch: "C4",
    onsetSlot: 4,
    noteSlots: 4,
    nominalTargetCents: 0,
    targetAtSlot: 4,
  },
  "slide-03-current-down-4": {
    what: "bugünkü slide, −4 yarım ton",
    group: "slide",
    song: twoNotes("F3", 3, "slide", "A3", 2),
    plan: keepPlan,
    isProductionBaseline: true,
    referencePitch: "F3",
    onsetSlot: 4,
    noteSlots: 4,
    targetAtSlot: 4,
  },
  "slide-04-current-up-7": {
    what: "bugünkü slide, +7 yarım ton",
    group: "slide",
    song: twoNotes("E4", 9, "slide"),
    plan: keepPlan,
    isProductionBaseline: true,
    referencePitch: "E4",
    onsetSlot: 4,
    noteSlots: 4,
    targetAtSlot: 4,
  },
  "slide-05-current-down-7": {
    what: "bugünkü slide, −7 yarım ton",
    group: "slide",
    song: twoNotes("D3", 3, "slide", "A3", 2),
    plan: keepPlan,
    isProductionBaseline: true,
    referencePitch: "D3",
    onsetSlot: 4,
    noteSlots: 4,
    targetAtSlot: 4,
  },
  "slide-06-legato-up-4": {
    what: "legato slide adayı, +4 — bugünküyle aynı semantik",
    group: "slide",
    song: twoNotes("C4", 5, "slide"),
    plan: keepPlan,
    referencePitch: "C4",
    onsetSlot: 4,
    noteSlots: 4,
    targetAtSlot: 4,
  },
  "slide-07-legato-down-4": {
    what: "legato slide adayı, −4",
    group: "slide",
    song: twoNotes("F3", 3, "slide", "A3", 2),
    plan: keepPlan,
    referencePitch: "F3",
    onsetSlot: 4,
    noteSlots: 4,
    targetAtSlot: 4,
  },
  "slide-08-shift-up-4-attack-035": {
    what: "shift slide adayı, +4, hedefte 0.35 seviyeli gerçek atak",
    group: "slide",
    song: twoNotes("C4", 5, "slide"),
    plan: withTargetAttack("C4", 0.35),
    referencePitch: "C4",
    onsetSlot: 4,
    noteSlots: 4,
    targetAtSlot: 4,
  },
  "slide-09-shift-up-4-attack-060": {
    what: "shift slide adayı, +4, hedefte 0.60 seviyeli gerçek atak",
    group: "slide",
    song: twoNotes("C4", 5, "slide"),
    plan: withTargetAttack("C4", 0.6),
    referencePitch: "C4",
    onsetSlot: 4,
    noteSlots: 4,
    targetAtSlot: 4,
  },
  "slide-09b-shift-up-4-attack-100": {
    what: "shift slide adayı, +4, hedefte tam seviyeli atak (üst sınır)",
    group: "slide",
    song: twoNotes("C4", 5, "slide"),
    plan: withTargetAttack("C4", 1),
    referencePitch: "C4",
    onsetSlot: 4,
    noteSlots: 4,
    targetAtSlot: 4,
  },
  "slide-10-shift-down-4": {
    what: "shift slide adayı, −4, hedefte 0.60 seviyeli atak",
    group: "slide",
    song: twoNotes("F3", 3, "slide", "A3", 2),
    plan: withTargetAttack("F3", 0.6),
    referencePitch: "F3",
    onsetSlot: 4,
    noteSlots: 4,
    targetAtSlot: 4,
  },
  "slide-11-wide-legato-7": {
    what: "geniş legato slide, +7",
    group: "slide",
    song: twoNotes("E4", 9, "slide"),
    plan: keepPlan,
    referencePitch: "E4",
    onsetSlot: 4,
    noteSlots: 4,
    targetAtSlot: 4,
  },
  "slide-12-wide-legato-12": {
    what: "geniş legato slide, +12 (motorun tavanı)",
    group: "slide",
    song: twoNotes("A4", 14, "slide"),
    plan: keepPlan,
    referencePitch: "A4",
    onsetSlot: 4,
    noteSlots: 4,
    targetAtSlot: 4,
  },
  "slide-13-slide-in-below": {
    what: "aşağıdan slide-in, kesin fret uydurmadan",
    group: "slide",
    song: oneNote(undefined),
    plan: slidePlan({ kind: "slide_in_below", intervalSemitones: 0, approxSemitones: 2 }, "A3"),
    referencePitch: "A3",
    onsetSlot: 0,
    noteSlots: 8,
  },
  "slide-14-slide-in-above": {
    what: "yukarıdan slide-in",
    group: "slide",
    song: oneNote(undefined),
    plan: slidePlan({ kind: "slide_in_above", intervalSemitones: 0, approxSemitones: 2 }, "A3"),
    referencePitch: "A3",
    onsetSlot: 0,
    noteSlots: 8,
  },
  "slide-15-slide-out-down": {
    what: "aşağı slide-out, hedef nota uydurmadan",
    group: "slide",
    song: oneNote(undefined),
    plan: slidePlan({ kind: "slide_out_down", intervalSemitones: 0, approxSemitones: 3 }, "A3"),
    referencePitch: "A3",
    onsetSlot: 0,
    noteSlots: 8,
  },
  "slide-16-slide-out-up": {
    what: "yukarı slide-out",
    group: "slide",
    song: oneNote(undefined),
    plan: slidePlan({ kind: "slide_out_up", intervalSemitones: 0, approxSemitones: 3 }, "A3"),
    referencePitch: "A3",
    onsetSlot: 0,
    noteSlots: 8,
  },
  "slide-17-chain-up-down": {
    what: "yukarı sonra aşağı slide zinciri",
    group: "slide",
    song: (() => {
      const track = guitar();
      return songOf(
        track,
        [
          barOf(track.id, [
            ...held(struck(note("A3", 3, 2)), 3),
            ...held(struck(note("C4", 3, 5, { articulation: "slide" })), 3),
            ...held(struck(note("A3", 3, 2, { articulation: "slide" })), 2),
          ]),
        ],
        BPM,
      );
    })(),
    plan: keepPlan,
    isProductionBaseline: true,
    referencePitch: "C4",
    onsetSlot: 3,
    noteSlots: 3,
    targetAtSlot: 3,
  },
  "slide-18-chord-one-string": {
    what: "akor çalarken tek tel slide, diğerleri sabit",
    group: "slide",
    song: (() => {
      const track = guitar();
      return songOf(
        track,
        [
          barOf(track.id, [
            ...held(struck(note("E3", 5, 0), note("A3", 3, 2), note("C4", 2, 1)), 4),
            ...held(struck(note("C4", 3, 5, { articulation: "slide" })), 4),
          ]),
        ],
        BPM,
      );
    })(),
    plan: keepPlan,
    isProductionBaseline: true,
    referencePitch: "C4",
    onsetSlot: 4,
    noteSlots: 4,
    targetAtSlot: 4,
    steadyPitch: "E3",
  },
  "slide-19-riff-current": {
    what: "riff içinde bugünkü slide",
    group: "slide",
    song: slideRiff(),
    plan: keepPlan,
    isProductionBaseline: true,
    referencePitch: "C4",
    onsetSlot: 4,
    noteSlots: 2,
    targetAtSlot: 4,
  },
  "slide-20-riff-shift": {
    what: "aynı riff, shift slide adayı",
    group: "slide",
    song: slideRiff(),
    plan: withTargetAttack("C4", 0.6),
    referencePitch: "C4",
    onsetSlot: 4,
    noteSlots: 2,
    targetAtSlot: 4,
  },

  /* ----------------------------------------------------------- timbre */
  "timbre-01-single-sample-7": {
    what: "bugünkü timbre: tek sample, playbackRate ile +7 taşınıyor",
    group: "timbre",
    song: twoNotes("E4", 9, "slide"),
    plan: keepPlan,
    isProductionBaseline: true,
    referencePitch: "E4",
    onsetSlot: 4,
    noteSlots: 4,
    targetAtSlot: 4,
  },
  "timbre-02-fret-noise-quiet-7": {
    what: "aynı slide + sessiz deterministik fret gürültüsü",
    group: "timbre",
    song: twoNotes("E4", 9, "slide"),
    plan: keepPlan,
    referencePitch: "E4",
    onsetSlot: 4,
    noteSlots: 4,
    targetAtSlot: 4,
    extras: fretNoiseExtras("timbre-02-fret-noise-quiet-7", 0),
  },
  "timbre-03-fret-noise-louder-7": {
    what: "aynı slide + biraz daha duyulur fret gürültüsü",
    group: "timbre",
    song: twoNotes("E4", 9, "slide"),
    plan: keepPlan,
    referencePitch: "E4",
    onsetSlot: 4,
    noteSlots: 4,
    targetAtSlot: 4,
    extras: fretNoiseExtras("timbre-03-fret-noise-louder-7", 1),
  },
  "timbre-04-crossfade-7": {
    what: "tek mantıksal ses altında komşu sample crossfade — iki fiziksel kaynak",
    group: "timbre",
    song: twoNotes("E4", 9, "slide"),
    plan: keepPlan,
    referencePitch: "E4",
    onsetSlot: 4,
    noteSlots: 4,
    targetAtSlot: 4,
    extras: crossfadeExtras("E4"),
  },
};

export function fixtureNames(): readonly string[] {
  return Object.keys(FIXTURES);
}

export async function renderFixture(name: string): Promise<FixtureMeasurement> {
  const fixture = FIXTURES[name];
  if (!fixture) throw new Error(`unknown fixture: ${name}`);

  const rendered = await renderWithPlan(fixture.song, fixture.plan, fixture.extras);
  const onset = fixture.onsetSlot * SLOT_SECONDS;
  const duration = fixture.noteSlots * SLOT_SECONDS;
  const referenceMidi = pitchToMidi(fixture.referencePitch);
  const referenceHz = referenceMidi === null ? 0 : 440 * Math.pow(2, (referenceMidi - 69) / 12);

  /*
   * The window closes a little before the note does.
   *
   * The first run measured a riff's bend as ending at +309 cents, which is
   * exactly the interval to the *next* note: the last analysis frame had
   * already caught it. A note's own pitch is only its own until the next
   * onset, so the window stops one frame short of it.
   */
  const pitch =
    referenceHz > 0
      ? measurePitch(rendered.mono, referenceHz, onset + 0.05, onset + duration - 0.07)
      : null;

  const encoded = encodeWav({ channels: rendered.channels, sampleRate: RATE });
  if (!encoded.ok) throw new Error(`encode refused: ${encoded.code}`);

  const measuredNote = rendered.plan?.notes.find(
    (entry) => entry.pitch === fixture.referencePitch,
  );
  const targetAt = fixture.targetAtSlot === undefined ? null : fixture.targetAtSlot * SLOT_SECONDS;
  /*
   * Centred on the travel, not on the arrival.
   *
   * The fret-noise burst sits *before* the target — that is what makes it a
   * hand moving rather than a second pick — so a window starting at the
   * arrival catches only its tail. Measured at the arrival, the louder
   * candidate read *less* band energy than the quieter one, which is the
   * window's fault and not the candidate's.
   */
  const windowStart = Math.max(0, Math.round(((targetAt ?? onset) - 0.11) * RATE));
  const windowLength = 4096;

  return {
    name,
    group: fixture.group,
    what: fixture.what,
    isProductionBaseline: fixture.isProductionBaseline === true,
    notatedOnsetSeconds: round(onset),
    noteDurationSeconds: round(duration),
    nominalTargetCents: fixture.nominalTargetCents ?? null,
    pitch,
    // Read off the plan the render actually used, not off the fixture's
    // intent. A steady string is proven steady by carrying no movement.
    automationPoints: measuredNote?.pitchAutomation.length ?? 0,
    steadyVoiceAutomationPoints:
      fixture.steadyPitch === undefined
        ? null
        : (rendered.plan?.notes
            .filter((entry) => entry.pitch === fixture.steadyPitch)
            .reduce((total, entry) => total + entry.pitchAutomation.length, 0) ?? 0),
    targetAttackRatio:
      targetAt === null ? null : round(attackRatioAt(rendered.mono, RATE, targetAt).ratio),
    noiseBandEnergy: round(
      bandEnergy(rendered.mono, windowStart, windowLength, RATE, 2000, 6000),
    ),
    centroidAtTargetHz: round(
      spectralCentroid(rendered.mono, windowStart, windowLength, RATE),
    ),
    logicalVoices: rendered.logicalVoices,
    physicalSources: rendered.physicalSources,
    extraSources: rendered.extraSources,
    activeAfterDispose: rendered.activeAfterDispose,
    peak: round(energy(rendered.mono).peak),
    rms: round(energy(rendered.mono).rms),
    clippedSamples: clippedSamples(rendered.channels),
    seconds: round(rendered.seconds),
    wavBase64: toBase64(encoded.bytes),
  };
}

/** Exposed so the harness can report what the noise candidate actually is. */
export const NOISE_CANDIDATES = FRET_NOISE_CANDIDATES;
export const SHIFT_LEVELS = SHIFT_ATTACK_LEVELS;
export const SEED_OF = seedFrom;
export const NOISE_OF = seededNoise;
export const NEAREST = nearestSample;
export const RATE_FOR = playbackRateFor;
export const CENTS_BETWEEN = centsBetween;

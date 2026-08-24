/**
 * What the pure work costs, in Node (2P-A §18).
 *
 * Twenty timed rounds after a warm-up, reported as median / p95 / max. No
 * threshold is invented here: a number nobody measured is not a budget, and
 * this file's job is to produce the numbers a budget could later be argued
 * from.
 *
 * This is a desktop container, not a phone. Everything below is a lower
 * bound on what a reader's device would take.
 *
 *   npx tsx eval/chord-audio/measure-perf.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";

import {
  audioPresetAvailability,
  corePresetOptions,
  playableCorePresets,
  silentTracks,
} from "@/lib/audio/preset-availability";
import { getOrLoad, openBankRetention } from "@/lib/audio/buffer-bank";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { auditionSong } from "@/lib/chords/chord-audition";
import { chordVoicings } from "@/lib/chords/chord-voicing";
import { materializeTemplate } from "@/lib/song/song-templates";
import { SAMPLE_SONG } from "@/lib/song/sample-song";

import {
  bendCandidateAutomation,
  slideCandidateAutomation,
} from "../expression-benchmark/candidates";
import { energyWindows, trackPitch } from "../expression-benchmark/analysis";
import { guitar } from "./fixtures";

const OUT = "eval/chord-audio/artifacts";
mkdirSync(OUT, { recursive: true });

const ROUNDS = 20;
const WARMUP = 5;

type Timing = {
  readonly name: string;
  readonly rounds: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly note?: string;
};

function time(name: string, run: () => void, note?: string): Timing {
  for (let index = 0; index < WARMUP; index += 1) run();
  const samples: number[] = [];
  for (let index = 0; index < ROUNDS; index += 1) {
    const started = process.hrtime.bigint();
    run();
    samples.push(Number(process.hrtime.bigint() - started) / 1e6);
  }
  samples.sort((a, b) => a - b);
  const at = (fraction: number) =>
    Math.round(samples[Math.min(samples.length - 1, Math.floor(samples.length * fraction))]! * 1000) /
    1000;
  return {
    name,
    rounds: ROUNDS,
    medianMs: at(0.5),
    p95Ms: at(0.95),
    maxMs: Math.round(samples[samples.length - 1]! * 1000) / 1000,
    ...(note === undefined ? {} : { note }),
  };
}

/* ------------------------------------------------------------ the fixtures */

const track = guitar();
const chord = chordVoicings({ track, rootPitchClass: 9, quality: "minor_7" });
const voicing = chord.ok ? chord.voicings[0]! : null;
const rockBand = materializeTemplate("rock_band")!;

/** A fake bank, so the cache is timed rather than the network. */
const fakeBank = () => ({
  buffers: { dispose() {} } as never,
  loaded: Promise.resolve(),
  bufferCount: 7,
});
const context = {} as never;
const retention = openBankRetention(context);
const warmHandle = getOrLoad(context, "perf-bank", fakeBank);

const timings: Timing[] = [
  time("availability lookup (one pair)", () => {
    audioPresetAvailability("electric_guitar", "high_gain");
  }),
  time("availability: playable core presets", () => {
    playableCorePresets("electric_guitar");
  }),
  time("availability: preset picker options", () => {
    corePresetOptions("electric_guitar", "clean");
  }),
  time("availability: silent tracks of a four-track song", () => {
    silentTracks(SAMPLE_SONG);
  }),
  time("template materialisation (rock band)", () => {
    materializeTemplate("rock_band");
  }),
  time("bank: first load orchestration", () => {
    // A cold key every round, so this times the miss path rather than the hit.
    getOrLoad(context, `cold-${Math.round(performance.now() * 1e6)}`, fakeBank).release();
  }, "her turda yeni bir anahtar: bu kacirma yolunun maliyeti"),
  time("bank: warm lookup", () => {
    getOrLoad(context, "perf-bank", fakeBank).release();
  }),
  time("bank: eight concurrent handles on one key", () => {
    const handles = Array.from({ length: 8 }, () =>
      getOrLoad(context, "perf-bank", fakeBank),
    );
    for (const handle of handles) handle.release();
  }, "coalescing: sekiz talep, tek yukleme"),
  time("chord preview plan (audition song)", () => {
    if (voicing) auditionSong(SAMPLE_SONG, track, voicing, { velocity: 100 });
  }),
  time("expression plan of the demo song", () => {
    buildExpressionPlan(SAMPLE_SONG);
  }),
  time("expression plan of a launch template", () => {
    buildExpressionPlan(rockBand);
  }),
  time("bend candidate plan", () => {
    bendCandidateAutomation(
      {
        kind: "bend",
        targetCents: 200,
        vibrato: { startAfterTarget: true, depthCents: 12, rateHz: 5 },
      },
      1.5,
    );
  }),
  time("slide candidate plan", () => {
    slideCandidateAutomation({ kind: "legato", intervalSemitones: 7 }, 1.5);
  }),
];

/* --------------------------------------------- the analysis, on real length */

const ONE_SECOND = new Float32Array(44100);
for (let index = 0; index < ONE_SECOND.length; index += 1) {
  ONE_SECOND[index] = 0.3 * Math.sin((2 * Math.PI * 220 * index) / 44100);
}

timings.push(
  time(
    "F0 analysis of one second",
    () => {
      trackPitch(ONE_SECOND, { sampleRate: 44100 });
    },
    "44100 ornek, 60 ms pencere, 10 ms adim",
  ),
  time("transient windows of one second", () => {
    energyWindows(ONE_SECOND, 44100, 5);
  }),
);

retention.dispose();
warmHandle.release();

writeFileSync(
  `${OUT}/PERFORMANCE.json`,
  `${JSON.stringify(
    {
      what: "2P-A §18 — Node tarafındaki saf işin maliyeti",
      measuredOn:
        "masaüstü container, Node " +
        process.version +
        " — telefon DEĞİL ve telefon hakkında kanıt değil",
      method: `${WARMUP} ısınma turu, sonra ${ROUNDS} ölçülen tur; median / p95 / max`,
      noThresholds:
        "Bu dosyada eşik yok. Ölçülmemiş bir sayı bütçe değildir; buradaki " +
        "sayılar ileride bir bütçenin tartışılabileceği zemindir.",
      timings,
    },
    null,
    2,
  )}\n`,
);

for (const entry of timings) {
  console.log(
    `${entry.name.padEnd(46)} median ${entry.medianMs.toFixed(3)}ms  p95 ${entry.p95Ms.toFixed(3)}ms  max ${entry.maxMs.toFixed(3)}ms`,
  );
}

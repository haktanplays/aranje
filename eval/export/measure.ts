/**
 * What an export costs, measured rather than asserted (spec 13.19 §11).
 *
 * The `node` section is a desktop **Node** measurement and is labelled as
 * one: it says how the pure encoders and planners behave on this machine,
 * and nothing about a phone. The Chromium section (`measure-browser.mjs`)
 * carries the offline render, which is the expensive half and cannot be run
 * in Node at all.
 *
 *   NODE_OPTIONS=--expose-gc npx tsx eval/export/measure.ts
 */
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { sizes, worstCasePlayableSong } from "../shared/worst-case-song";

import { audioExportLimits } from "@/lib/limits";
import { estimateWav, renderDuration } from "@/lib/export/export-plan";
import { buildMidiPlan } from "@/lib/export/midi-plan";
import { writeMidiFile } from "@/lib/export/midi-writer";
import { encodeWav } from "@/lib/export/wav-encoder";
import { exportProject } from "@/lib/project/project-file";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { songSchema, type Song } from "@/lib/song/schema";

const ROUNDS = 25;
const WARMUP = 5;

type Stats = { rounds: number; medianMs: number; p95Ms: number; maxMs: number };

function bench(run: () => unknown, rounds = ROUNDS): Stats {
  for (let i = 0; i < WARMUP; i += 1) run();
  const samples: number[] = [];
  for (let i = 0; i < rounds; i += 1) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const at = (q: number) =>
    samples[Math.min(samples.length - 1, Math.ceil(q * samples.length) - 1)] ?? 0;
  const round = (value: number) => Number(value.toFixed(3));
  return {
    rounds,
    medianMs: round(at(0.5)),
    p95Ms: round(at(0.95)),
    maxMs: round(samples[samples.length - 1] ?? 0),
  };
}

/* --------------------------------------------------------------- subjects */

const worst = songSchema.parse(worstCasePlayableSong());

/**
 * Sample data the size a real export produces, without rendering it.
 *
 * The encoder's cost is a function of frame count, not of what the frames
 * contain, so silence of the right length measures the same work as music of
 * the right length — and lets the encoder be timed in Node at all.
 */
function silence(song: Song) {
  const estimate = estimateWav(song);
  return {
    estimate,
    channels: [
      new Float32Array(estimate.frames),
      new Float32Array(estimate.frames),
    ],
  };
}

const sampleSilence = silence(SAMPLE_SONG);
const worstSilence = silence(worst);

const expectOk = <T extends { ok: boolean }>(name: string, value: T): T => {
  if (!value.ok) throw new Error(`${name} refused — measurement invalid`);
  return value;
};

expectOk("sample wav", encodeWav({
  channels: sampleSilence.channels,
  sampleRate: audioExportLimits.sampleRate,
}));
const worstMidi = expectOk("worst midi", buildMidiPlan(worst));

/* ------------------------------------------------------------ the numbers */

const durationPlan = bench(() => renderDuration(worst));
const wavEstimate = bench(() => estimateWav(worst));

const wavEncodeSample = bench(() =>
  encodeWav({
    channels: sampleSilence.channels,
    sampleRate: audioExportLimits.sampleRate,
  }),
);
const wavEncodeWorst = bench(
  () =>
    encodeWav({
      channels: worstSilence.channels,
      sampleRate: audioExportLimits.sampleRate,
    }),
  10, // fewer rounds: each one writes tens of megabytes
);

const midiPlanSample = bench(() => buildMidiPlan(SAMPLE_SONG));
const midiPlanWorst = bench(() => buildMidiPlan(worst));
const midiWriteWorst = bench(() =>
  writeMidiFile(
    (worstMidi as { ok: true; plan: Parameters<typeof writeMidiFile>[0] }).plan,
  ),
);

const projectExportWorst = bench(() => exportProject(worst), 10);

/* ------------------------------------------------------------- byte sizes */

const wavBytes = (song: Song) => estimateWav(song).bytes;
const midiBytes = (song: Song) => {
  const plan = buildMidiPlan(song);
  if (!plan.ok) return 0;
  const file = writeMidiFile(plan.plan);
  return file.ok ? file.bytes.length : 0;
};

/* --------------------------------------------------------- a heap snapshot */

function measureHeap() {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc === undefined) {
    return { note: "run with NODE_OPTIONS=--expose-gc for a controlled heap delta" };
  }
  gc();
  const before = process.memoryUsage().heapUsed;
  const encoded = encodeWav({
    channels: worstSilence.channels,
    sampleRate: audioExportLimits.sampleRate,
  });
  const bytes = encoded.ok ? encoded.bytes.length : 0;
  gc();
  const after = process.memoryUsage().heapUsed;
  return {
    encodedBytes: bytes,
    deltaBytes: after - before,
    deltaMiB: Number(((after - before) / (1024 * 1024)).toFixed(2)),
    note:
      "Worst-case WAV'ın encode edilmesi sırasında tutulan Node heap farkı " +
      "(kontrollü ölçüm, telefon sayısı değil).",
  };
}

/* ------------------------------------------------------------------ report */

const report = {
  method: {
    rounds: ROUNDS,
    warmupRounds: WARMUP,
    statistic: "median / p95 / max over timed rounds after warm-up",
    note:
      "WAV encode worst-case ve project export 10 turda ölçüldü: her tur " +
      "onlarca MB yazıyor ve 25 tur ölçümü daha doğru yapmıyor, yalnız uzatıyor.",
  },
  honesty: [
    "Bu bölümdeki sayılar masaüstü Node ölçümüdür; fiziksel telefon kanıtı değildir.",
    "Offline render Node'da koşamaz; onun süresi Chromium bölümündedir.",
    "Encode süresi frame sayısının fonksiyonudur, içeriğin değil: sessizlik aynı işi ölçer.",
  ],
  node: {
    version: process.version,
    subjects: {
      sample: {
        ...sizes(SAMPLE_SONG),
        seconds: Number(renderDuration(SAMPLE_SONG).totalSeconds.toFixed(2)),
        wavBytes: wavBytes(SAMPLE_SONG),
        midiBytes: midiBytes(SAMPLE_SONG),
        midiEvents: buildMidiPlan(SAMPLE_SONG).ok
          ? (buildMidiPlan(SAMPLE_SONG) as { ok: true; plan: { eventCount: number } })
              .plan.eventCount
          : 0,
      },
      worstCase: {
        ...sizes(worst),
        seconds: Number(renderDuration(worst).totalSeconds.toFixed(2)),
        wavBytes: wavBytes(worst),
        wavMiB: Number((wavBytes(worst) / (1024 * 1024)).toFixed(2)),
        midiBytes: midiBytes(worst),
        midiEvents: (worstMidi as { ok: true; plan: { eventCount: number } }).plan
          .eventCount,
      },
    },
    durationPlan,
    wavEstimate,
    wavEncodeSample,
    wavEncodeWorst,
    midiPlanSample,
    midiPlanWorst,
    midiWriteWorst,
    projectExportWorst,
    heap: measureHeap(),
  },
  chromium: null as unknown,
};

writeFileSync("eval/export/PERFORMANCE.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.node, null, 2));

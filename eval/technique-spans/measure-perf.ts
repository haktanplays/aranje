/**
 * What a technique span costs, at one, four and eight times the density
 * (2V-D.1-C §16).
 *
 *   npx tsx eval/technique-spans/measure-perf.ts
 *
 * A span is looked up per onset per string, so the honest question is not
 * "is one span fast" — it obviously is — but how the cost moves when a
 * reader marks a whole song. Three densities over the same music answer that:
 * if the numbers are flat the index is doing its job, and if they climb with
 * the span count the binary search is not being used.
 *
 * Every stage the span passes through is timed on its own, on the same song,
 * so a slow number names a layer rather than a feeling:
 *
 *   index     — building the sorted span index for a section
 *   timeline  — trackLegatoOnsets, where a span becomes a note's length
 *   plan      — buildExpressionPlan, the whole audio plan
 *   edit      — applyTransform move, which rewrites every span it touches
 *   settle    — schema plus validators, the gate every edit goes through
 *
 * Node on this machine, not a phone. The absolute numbers are a desktop
 * measurement and are labelled as such in the artefact; what carries over to
 * a device is the *shape* — flat or climbing — not the milliseconds.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { indexSpans } from "@/lib/music/technique-span";
import { trackLegatoOnsets } from "@/lib/music/legato";
import { settle } from "@/lib/song/edit";
import { pitchAt } from "@/lib/song/edit";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { applyTransform } from "@/lib/song/transform";
import {
  songSchema,
  type MelodicSlot,
  type NoteEvent,
  type Song,
  type TechniqueSpan,
} from "@/lib/song/schema";

const HERE = new URL(".", import.meta.url).pathname;
const ROUNDS = 30;
const WARMUP = 8;
const BAR = 768;
/** The contract's own ceiling: eight bars to a section, so four sections. */
const BARS_PER_SECTION = 8;
const SECTIONS = 4;
const TRACK = "gtr";
const BOARD = SAMPLE_SONG.tracks.find((track) => track.id === TRACK)!.fretboard!;

const round = (value: number, places = 3) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

function bench(run: () => unknown) {
  for (let i = 0; i < WARMUP; i += 1) run();
  const samples: number[] = [];
  for (let i = 0; i < ROUNDS; i += 1) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return {
    rounds: ROUNDS,
    p50: round(samples[Math.floor(samples.length / 2)]!),
    p95: round(samples[Math.floor(samples.length * 0.95)]!),
    max: round(samples[samples.length - 1]!),
  };
}

const note = (stringIndex: number, fret: number): NoteEvent =>
  ({
    pitch: pitchAt(BOARD, stringIndex, fret)!,
    position: { string: stringIndex, fret },
  }) as NoteEvent;

/** Thirty-two bars, four strikes a bar on two strings. Real, not a stub. */
function lane(): MelodicSlot[] {
  const slots: MelodicSlot[] = Array.from({ length: 8 }, () => null);
  for (const slot of [0, 2, 4, 6]) {
    slots[slot] = { notes: [note(1, 3), note(4, 5)] };
  }
  return slots;
}

/**
 * `multiple` spans per section, alternating kind and string set.
 *
 * Density is what is varied and nothing else: the notes, the tempo and the
 * section count are identical in all three songs, so a difference between
 * them is the spans and not the music.
 *
 * Per *section* rather than per bar, because the Song Contract caps a
 * section at `songLimits.barsPerSection` spans — eight — and 8x is therefore
 * the densest song the product can currently hold. That ceiling is itself
 * worth knowing and is recorded in the artefact.
 */
function songAt(multiple: number): Song {
  const width = (BARS_PER_SECTION / multiple) * BAR;
  const sections = Array.from({ length: SECTIONS }, (_, sectionIndex) => {
    const spans: TechniqueSpan[] = [];
    for (let step = 0; step < multiple; step += 1) {
      const startTicks = step * width;
      spans.push({
        id: `pm-${sectionIndex}-${step}`,
        kind: step % 2 === 0 ? "palm_mute" : "let_ring",
        trackId: TRACK,
        startTicks,
        endTicks: startTicks + width,
        stringIndices: step % 2 === 0 ? [1] : [4],
      });
    }
    return {
      ...SAMPLE_SONG.sections[0]!,
      id: `s${sectionIndex + 1}`,
      name: `S${sectionIndex + 1}`,
      bars: Array.from({ length: BARS_PER_SECTION }, () => ({
        timeSignature: [4, 4],
        resolution: 8,
        slots: { [TRACK]: lane() },
      })),
      techniqueSpans: spans,
    };
  });

  return songSchema.parse({
    ...SAMPLE_SONG,
    tracks: SAMPLE_SONG.tracks.filter((track) => track.id === TRACK),
    sections,
  });
}

const DENSITIES = [1, 4, 8] as const;

const densities: Record<string, unknown> = {};
for (const multiple of DENSITIES) {
  const target = songAt(multiple);
  const section = target.sections[0]!;
  const spanCount = target.sections.reduce(
    (total, entry) => total + (entry.techniqueSpans?.length ?? 0),
    0,
  );

  const selection = {
    sectionId: section.id,
    trackId: TRACK,
    startTicks: 0,
    endTicks: BAR,
  };

  densities[`x${multiple}`] = {
    spanCount,
    /* The two the reader waits on while playing. */
    index: bench(() => indexSpans(section.techniqueSpans)),
    timeline: bench(() => trackLegatoOnsets(target, TRACK)),
    plan: bench(() => buildExpressionPlan(target)),
    /* And the two they wait on while editing. */
    edit: bench(() =>
      applyTransform(target, selection, { kind: "move_selection_time", deltaTicks: 96 }),
    ),
    settle: bench(() => settle(target)),
  };
  const row = densities[`x${multiple}`] as Record<string, { p50: number; p95: number }>;
  console.log(
    `  x${multiple} (${String(spanCount).padStart(3)} span)  ` +
      `index ${row.index!.p50.toFixed(3)}/${row.index!.p95.toFixed(3)} · ` +
      `timeline ${row.timeline!.p50.toFixed(2)}/${row.timeline!.p95.toFixed(2)} · ` +
      `plan ${row.plan!.p50.toFixed(2)}/${row.plan!.p95.toFixed(2)} · ` +
      `edit ${row.edit!.p50.toFixed(2)}/${row.edit!.p95.toFixed(2)} · ` +
      `settle ${row.settle!.p50.toFixed(2)}/${row.settle!.p95.toFixed(2)} ms`,
  );
}

mkdirSync(HERE, { recursive: true });
writeFileSync(
  `${HERE}PERFORMANCE.json`,
  `${JSON.stringify(
    {
      what: "2V-D.1-C §16 — span yoğunluğu 1x / 4x / 8x, her katman ayrı",
      surface: "Node/desktop",
      note:
        "Node üzerinde ölçüldü; telefon rakamları değil. Taşınan şey mutlak " +
        "milisaniye değil, yoğunlukla birlikte düz kalıp kalmadığı.",
      measuredAt: new Date().toISOString(),
      commit: process.env.MEASURE_COMMIT ?? null,
      bars: BARS_PER_SECTION * SECTIONS,
      unit: "ms",
      contractCeiling:
        "Bir section en fazla 8 span tutabiliyor (schema: barsPerSection). " +
        "8x bu tavanın kendisi; daha yoğun bir şarkı bugün yazılamıyor.",
      statistic: "p50 / p95 over 30 rounds after 8 warmups",
      densities,
    },
    null,
    2,
  )}\n`,
);
console.log(`\n${HERE}PERFORMANCE.json`);

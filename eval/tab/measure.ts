/**
 * What 2N-A costs, measured rather than asserted (spec 13.20 §11).
 *
 * Every number here is a desktop **Node** measurement and is honest about
 * being one. It says how the pure cores behave on this machine; it says
 * nothing about a phone, and physical Android/iOS latency stays open at the
 * release gate. The browser half — DOM nodes, the playhead's frame rate and
 * the AudioContext count — lives in `measure-browser.mjs` and merges into the
 * same report.
 *
 *   npx tsx eval/tab/measure.ts
 */
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { songLimits } from "@/lib/limits";
import { RESOLUTIONS, type Resolution, type TimeSignature } from "@/lib/music/timing";
import { slotCount } from "@/lib/music/timing";
import { changeTiming } from "@/lib/song/timing-change";
import { songSchema, type Bar, type MelodicSlot, type Song } from "@/lib/song/schema";
import { buildRhythmGuide } from "@/lib/tab/rhythm-guide";
import { frettedRhythm, buildTrackTimeline } from "@/lib/tab/timeline";

const ROUNDS = 60;
/*
 * Generous, on purpose. With a short warm-up the first subject measured pays
 * for compiling code every later subject then reuses, and the six-string bar
 * came out *faster* than the single-line one — an artefact of the order they
 * ran in rather than anything about beams.
 */
const WARMUP = 60;

type Stats = { rounds: number; medianMs: number; p95Ms: number; maxMs: number };

function bench(run: () => unknown): Stats {
  for (let index = 0; index < WARMUP; index += 1) run();
  const samples: number[] = [];
  for (let index = 0; index < ROUNDS; index += 1) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const at = (q: number) =>
    samples[Math.min(samples.length - 1, Math.ceil(q * samples.length) - 1)] ?? 0;
  const round = (value: number) => Number(value.toFixed(4));
  return {
    rounds: ROUNDS,
    medianMs: round(at(0.5)),
    p95Ms: round(at(0.95)),
    maxMs: round(samples[samples.length - 1] ?? 0),
  };
}

/* ------------------------------------------------------------- the subjects */

const STRINGS = ["E2", "A2", "D3", "G3", "B3", "E4"] as const;

/**
 * One bar at a given grid, every slot struck.
 *
 * `voices` strings sound at once, so the same builder produces both the
 * single-line worst case and the chord-density one. Notes are written without
 * explicit positions: the tab's placement engine is not what is being timed
 * here, and pinning positions would measure a different thing on each call.
 */
function denseBar(
  resolution: Resolution,
  voices: number,
  timeSignature: TimeSignature = [4, 4],
): Bar {
  const count = slotCount(timeSignature, resolution);
  const slots: MelodicSlot[] = Array.from({ length: count }, () => ({
    notes: Array.from({ length: voices }, (_, voice) => ({
      pitch: STRINGS[voice % STRINGS.length]!,
      velocity: 90,
      // Open strings: the fret a note is on is not what any of this measures,
      // and an explicit position that does not sound its own pitch would be
      // rejected by `fretboardIntegrity` before the timing change ran.
      position: { string: voice % STRINGS.length, fret: 0 },
    })),
  }));
  return {
    /* A fresh pair per bar: `Bar` holds a mutable tuple. */
    timeSignature: [timeSignature[0], timeSignature[1]] as Bar["timeSignature"],
    resolution,
    slots: { g: slots },
  };
}

function songOf(bars: Bar[], sections = 1): Song {
  return songSchema.parse({
    version: 2,
    title: "Ölçüm",
    key: "E minor",
    bpm: 120,
    tracks: [
      {
        id: "g",
        name: "Gitar",
        instrumentId: "electric_guitar",
        presetId: "clean",
        volumeDb: 0,
        fretboard: { tuning: [...STRINGS], capo: 0 },
      },
    ],
    sections: Array.from({ length: sections }, (_, index) => ({
      id: `s${index}`,
      name: `Bölüm ${index + 1}`,
      status: "fixed",
      bars: bars.map((bar) => ({ ...bar, slots: { g: [...(bar.slots.g as MelodicSlot[])] } })),
    })),
  });
}

/* ---- the two subjects: an eight-bar 1/32 tab, single line and in chords */

const fineSong = songOf(Array.from({ length: songLimits.barsPerSection }, () => denseBar(32, 1)));
const fineTimeline = buildTrackTimeline(fineSong, "g");
if (fineTimeline.kind !== "fretted") throw new Error("timeline invalid — measurement void");

/*
 * Warm both subjects before timing either.
 *
 * They share every function, so whichever ran first paid for compiling code
 * the second then reused — which showed up as the six-string bar being twice
 * as fast as the single-line one, with six times the spans. Warming both
 * first removes an ordering artefact from a comparison whose whole point is
 * the ratio between them.
 */
const warmAll = (timeline: typeof fineTimeline) => {
  for (let round = 0; round < 200; round += 1) {
    for (const bar of timeline.bars) {
      buildRhythmGuide(frettedRhythm(bar), bar.timeSignature, bar.resolution);
    }
  }
};

/* ---- 2. the same, at the worst chord density the tab can actually draw */

const chordSong = songOf(
  Array.from({ length: songLimits.barsPerSection }, () => denseBar(32, STRINGS.length)),
);
const chordTimeline = buildTrackTimeline(chordSong, "g");
if (chordTimeline.kind !== "fretted") throw new Error("timeline invalid — measurement void");

warmAll(fineTimeline);
warmAll(chordTimeline);

/* -------- 1. the guide for the finest grid, single line, and 2. in chords */

const fineGuide = bench(() => {
  for (const bar of fineTimeline.bars) {
    buildRhythmGuide(frettedRhythm(bar), bar.timeSignature, bar.resolution);
  }
});

const chordGuide = bench(() => {
  for (const bar of chordTimeline.bars) {
    buildRhythmGuide(frettedRhythm(bar), bar.timeSignature, bar.resolution);
  }
});

/*
 * The model half on its own, with the slot states read once beforehand.
 *
 * `frettedRhythm` is the tab's own traversal and existed before this
 * checkpoint; separating it says how much of the cost above 2N-A really added.
 */
const chordStates = chordTimeline.bars.map((bar) => ({
  states: frettedRhythm(bar),
  timeSignature: bar.timeSignature,
  resolution: bar.resolution,
}));
const chordGuideOnly = bench(() => {
  for (const entry of chordStates) {
    buildRhythmGuide(entry.states, entry.timeSignature, entry.resolution);
  }
});

/* ------------- 3. a whole section's timing change, validators included */

/*
 * Eight bars of 1/16 taken to 1/8: every bar is rewritten and the resulting
 * song goes through the strict schema and the whole validator chain, which is
 * the part the reader waits for. Written as eighths so the conversion really
 * succeeds — a refusal returns before the validators and would time the wrong
 * thing.
 */
const eighths = (): Bar => {
  const count = slotCount([4, 4], 16);
  const slots: MelodicSlot[] = Array.from({ length: count }, (_, index) =>
    index % 2 === 0
      ? {
          notes: [
            {
              pitch: STRINGS[index % STRINGS.length]!,
              velocity: 90,
              position: { string: index % STRINGS.length, fret: 0 },
            },
          ],
        }
      : "-",
  );
  return { timeSignature: [4, 4], resolution: 16, slots: { g: slots } };
};

const timingSong = songOf(Array.from({ length: songLimits.barsPerSection }, eighths));
const timingChange = {
  sectionId: "s0",
  scope: { kind: "section" } as const,
  timeSignature: [4, 4] as TimeSignature,
  resolution: 8 as Resolution,
};
const trial = changeTiming(timingSong, timingChange);
if (!trial.ok) throw new Error(`timing change refused (${trial.error.code}) — measurement void`);

const sectionTiming = bench(() => changeTiming(timingSong, timingChange));

/* ------------------------------------------------------------------ report */

const report = {
  measuredOn: "desktop Node — not a phone, and not evidence about one",
  node: process.version,
  grids: RESOLUTIONS,
  rhythmGuide: {
    "8 bars × 1/32, single line (states + guide)": fineGuide,
    "8 bars × 1/32, six-string chords (states + guide)": chordGuide,
    "8 bars × 1/32, six-string chords (guide model alone)": chordGuideOnly,
    onsetsPerBar: slotCount([4, 4], 32),
    barsPerSection: songLimits.barsPerSection,
  },
  sectionTimingChange: {
    "8 bars, 1/16 → 1/8, strict schema and validators included": sectionTiming,
    barsChanged: trial.barsChanged,
    warnings: trial.warnings.length,
  },
};

writeFileSync("eval/tab/PERFORMANCE.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

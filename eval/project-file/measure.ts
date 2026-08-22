/**
 * What the project file costs, measured rather than asserted (2L-A).
 *
 * Every number here is a desktop **Node** measurement — honest about being
 * one. It says how the pure code behaves on this machine; it says nothing
 * about a phone. The browser-side numbers (`setItem`, Object URLs, Chromium
 * heap) come from `measure-browser.mjs`, which merges into the same report,
 * and the physical Android/iOS latency question stays open at the release
 * gate.
 *
 *   NODE_OPTIONS=--expose-gc npx tsx eval/project-file/measure.ts
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { sizes, worstCasePlayableSong } from "../shared/worst-case-song";

import {
  exportProject,
  parseProjectText,
  serializeProjectFile,
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_VERSION,
} from "@/lib/project/project-file";
import { historyLimits } from "@/lib/limits";
import { createEditHistory, recordEdit, type EditHistory } from "@/lib/song/edit-history";
import { decideLoad, nextEnvelope } from "@/lib/song/storage-envelope";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { songSchema, type Song } from "@/lib/song/schema";
import { runValidators } from "@/lib/validators";

const ROUNDS = 30;
const WARMUP = 5;

type Stats = {
  rounds: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
};

/** Median / p95 / max over `ROUNDS` timed runs, after `WARMUP` unrecorded ones. */
function bench(run: () => unknown): Stats {
  for (let i = 0; i < WARMUP; i += 1) run();
  const samples: number[] = [];
  for (let i = 0; i < ROUNDS; i += 1) {
    const start = performance.now();
    run();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const at = (q: number) =>
    samples[Math.min(samples.length - 1, Math.ceil(q * samples.length) - 1)] ?? 0;
  const round = (value: number) => Number(value.toFixed(3));
  return {
    rounds: ROUNDS,
    medianMs: round(at(0.5)),
    p95Ms: round(at(0.95)),
    maxMs: round(samples[samples.length - 1] ?? 0),
  };
}

function measureSong(song: Song) {
  const file = {
    format: PROJECT_FILE_FORMAT,
    version: PROJECT_FILE_VERSION,
    song,
  } as const;
  const text = serializeProjectFile(file);

  return {
    fileBytes: sizes(file),
    exportSerialize: bench(() => serializeProjectFile(file)),
    importJsonParse: bench(() => JSON.parse(text)),
    strictSongValidation: bench(() => songSchema.safeParse(song)),
    validatorPipeline: bench(() => runValidators(song)),
    /*
     * Not on the spec's list, but it is the path a real import takes —
     * everything above plus the shell and the reference checks — so the
     * user-facing wait is this line, not any single one of the others.
     */
    fullImportDecision: bench(() => parseProjectText(text)),
  };
}

/**
 * A realistic session at the limit: fifty single-bar edits on the heaviest
 * supported song, held as `historyLimits.maxUndoSteps + 1` snapshots.
 *
 * Two numbers, because they answer different questions. The JSON-equivalent
 * total is what fifty-one *independent* copies would weigh — an upper bound,
 * and the honest one to quote against "each snapshot is a whole Song". The
 * heap delta is what the snapshots actually retain, which is far smaller
 * because an edit copies one bar and shares every other object with its
 * neighbours.
 */
function measureHistory(base: Song) {
  /** One single-bar edit: copies the touched bar, shares everything else. */
  const editOnce = (previous: Song, step: number): Song => {
    const sectionIndex = step % previous.sections.length;
    const section = previous.sections[sectionIndex]!;
    const barIndex = step % section.bars.length;
    const bar = section.bars[barIndex]!;
    const trackId = Object.keys(bar.slots)[0]!;
    const slots = bar.slots[trackId]!;
    const first = slots[0];
    const editedSlot =
      first !== null && first !== "-" && !Array.isArray(first) && first !== undefined
        ? { notes: [{ ...first.notes[0]!, velocity: 1 + (step % 126) }] }
        : first;
    return {
      ...previous,
      sections: previous.sections.map((entry, index) =>
        index !== sectionIndex
          ? entry
          : {
              ...entry,
              bars: entry.bars.map((barEntry, position) =>
                position !== barIndex
                  ? barEntry
                  : {
                      ...barEntry,
                      slots: { ...barEntry.slots, [trackId]: [editedSlot, ...slots.slice(1)] },
                    },
              ),
            },
      ),
    } as Song;
  };

  /*
   * The derived songs are created *inside* the measured region and reachable
   * only through the history afterwards, so the delta is what the fifty-one
   * snapshots actually retain — not the cost of some scaffolding around them.
   */
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  const heapBefore = process.memoryUsage().heapUsed;

  let history: EditHistory = createEditHistory(base);
  let previous = base;
  for (let step = 0; step < historyLimits.maxUndoSteps; step += 1) {
    const next = editOnce(previous, step);
    history = recordEdit(history, next, { kind: "note_edit" });
    previous = next;
  }

  gc?.();
  const heapAfter = process.memoryUsage().heapUsed;

  let jsonEquivalentUtf8Bytes = 0;
  for (const snapshot of history.snapshots) {
    jsonEquivalentUtf8Bytes += sizes(snapshot.song).utf8Bytes;
  }

  return {
    snapshots: history.snapshots.length,
    jsonEquivalentUtf8Bytes,
    jsonEquivalentMiB: Number((jsonEquivalentUtf8Bytes / (1024 * 1024)).toFixed(2)),
    heap:
      gc === undefined
        ? { note: "run with NODE_OPTIONS=--expose-gc for a controlled heap delta" }
        : {
            deltaBytes: heapAfter - heapBefore,
            deltaMiB: Number(((heapAfter - heapBefore) / (1024 * 1024)).toFixed(2)),
            note:
              "Node heap retained by the 50 edit snapshots ON TOP of an already-loaded baseline song (the app case: the baseline is shared, each edit copies one bar); a controlled measurement, not a phone number.",
          },
  };
}

const worst = songSchema.parse(worstCasePlayableSong());
const demo = songSchema.parse(SAMPLE_SONG);

// The export gate itself, once per song, so a refusal would be loud here.
for (const [name, song] of [["worst", worst], ["demo", demo]] as const) {
  const gate = exportProject(song);
  if (!gate.ok) throw new Error(`export refused for ${name} song`);
}

const report = {
  method: {
    rounds: ROUNDS,
    warmupRounds: WARMUP,
    statistic: "median / p95 / max over timed rounds after warm-up",
  },
  honesty: [
    "Bu bölümdeki sayılar masaüstü Node ölçümüdür; fiziksel telefon kanıtı değildir.",
    "Android/iOS gerçek cihaz gecikmesi release gate'inde açık kalır.",
  ],
  node: {
    version: process.version,
    worstCaseSong: measureSong(worst),
    demoSong: measureSong(demo),
    historyAtLimit: measureHistory(worst),
  },
  chromium: null as unknown,
};

writeFileSync(
  "eval/project-file/PERFORMANCE.json",
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);

/*
 * Payloads for the browser half (`measure-browser.mjs`), which cannot import
 * TypeScript: the two songs' export texts, and the two full durable envelopes
 * (current *and* previous occupied — the heaviest write a commit makes).
 * Scratch files, not artifacts: they are written outside the repo by default.
 */
const payloadDir = process.env.PAYLOAD_DIR ?? tmpdir();
const payload = (name: string, text: string) => {
  writeFileSync(join(payloadDir, name), text, "utf8");
};
for (const [name, song] of [["worst", worst], ["demo", demo]] as const) {
  const first = nextEnvelope(song, { kind: "empty" });
  const full = nextEnvelope(song, decideLoad(JSON.stringify(first)));
  payload(`aranje-perf-${name}-envelope.json`, JSON.stringify(full));
  const exported = exportProject(song);
  if (exported.ok) payload(`aranje-perf-${name}-project.json`, exported.text);
}
console.log("node measurements written to eval/project-file/PERFORMANCE.json");
console.log(`browser payloads written to ${payloadDir}`);

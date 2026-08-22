/**
 * What the lifecycle costs, measured rather than asserted (2L-B §17).
 *
 * Every number here is a desktop **Node** measurement — honest about being
 * one. It says how the pure cores behave on this machine and nothing about a
 * phone; Android/iOS latency stays open at the release gate. The browser
 * half (`measure-browser.mjs`) adds the real `localStorage.setItem` of a
 * lifecycle commit's envelope and merges into the same report.
 *
 * The duplicate measurements need room to succeed: the worst-case song sits
 * exactly at the 32-bar / 8-track limits, where a duplicate is (rightly)
 * refused. So the section number is taken on the worst song minus one
 * section, and the track number on the worst song minus one track — the
 * heaviest inputs on which the operation actually runs, and labelled as
 * such.
 *
 *   NODE_OPTIONS=--expose-gc npx tsx eval/lifecycle/measure.ts
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

import { sizes, worstCasePlayableSong } from "../shared/worst-case-song";

import { historyLimits } from "@/lib/limits";
import {
  createEditHistory,
  recordEdit,
  type EditHistory,
} from "@/lib/song/edit-history";
import { applySectionCommand } from "@/lib/song/section-lifecycle";
import { applyTrackCommand } from "@/lib/song/track-lifecycle";
import { materializeTemplate, SONG_TEMPLATES } from "@/lib/song/song-templates";
import { decideLoad, nextEnvelope } from "@/lib/song/storage-envelope";
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

/* --------------------------------------------------------------- subjects */

const worst = songSchema.parse(worstCasePlayableSong());

/** Room for one duplicated section: the worst song minus its last section. */
const sectionRoom: Song = {
  ...worst,
  sections: worst.sections.slice(0, -1),
};

/** Room for one duplicated track: the worst song minus its last track. */
const lastTrackId = worst.tracks.at(-1)!.id;
const trackRoom: Song = {
  ...worst,
  tracks: worst.tracks.slice(0, -1),
  sections: worst.sections.map((section) => ({
    ...section,
    bars: section.bars.map((bar) => {
      if (!(lastTrackId in bar.slots)) return bar;
      const slots = { ...bar.slots };
      delete slots[lastTrackId];
      return { ...bar, slots };
    }),
  })),
};

const expectOk = <T extends { ok: boolean }>(name: string, result: T): T => {
  if (!result.ok) throw new Error(`${name} refused — measurement invalid`);
  return result;
};

expectOk(
  "section duplicate",
  applySectionCommand(sectionRoom, {
    kind: "duplicate_section",
    sectionId: sectionRoom.sections[0]!.id,
  }),
);
expectOk(
  "track duplicate",
  applyTrackCommand(trackRoom, {
    kind: "duplicate_track",
    trackId: trackRoom.tracks[0]!.id,
  }),
);

/* ---------------------------------------------------- the §17 measurements */

const templates: Record<string, unknown> = {};
for (const template of SONG_TEMPLATES) {
  templates[template.id] = bench(() => {
    const song = materializeTemplate(template.id);
    if (!song) throw new Error("template failed");
    return song;
  });
}

const sectionDuplicate = bench(() =>
  applySectionCommand(sectionRoom, {
    kind: "duplicate_section",
    sectionId: sectionRoom.sections[0]!.id,
  }),
);

const trackDuplicate = bench(() =>
  applyTrackCommand(trackRoom, {
    kind: "duplicate_track",
    trackId: trackRoom.tracks[0]!.id,
  }),
);

const validatorPipeline = bench(() => runValidators(worst));

/* -------------------------------------------- 51 snapshots, JSON and heap */

function measureHistory(base: Song) {
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
                      slots: {
                        ...barEntry.slots,
                        [trackId]: [editedSlot, ...slots.slice(1)],
                      },
                    },
              ),
            },
      ),
    } as Song;
  };

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
    jsonEquivalentMiB: Number(
      (jsonEquivalentUtf8Bytes / (1024 * 1024)).toFixed(2),
    ),
    heap:
      gc === undefined
        ? { note: "run with NODE_OPTIONS=--expose-gc for a controlled heap delta" }
        : {
            deltaBytes: heapAfter - heapBefore,
            deltaMiB: Number(
              ((heapAfter - heapBefore) / (1024 * 1024)).toFixed(2),
            ),
            note:
              "Node heap retained by the 50 edit snapshots on top of an already-loaded baseline song (single-bar edits, structural sharing); a controlled measurement, not a phone number.",
          },
  };
}

/* ------------------------- payload for the browser's setItem measurement */

const duplicated = expectOk(
  "payload duplicate",
  applySectionCommand(sectionRoom, {
    kind: "duplicate_section",
    sectionId: sectionRoom.sections[0]!.id,
  }),
);
// The envelope a lifecycle commit writes: previous = the song before the
// duplicate, current = the song after — exactly what one apply puts on disk.
const before = nextEnvelope(sectionRoom, decideLoad(null));
const commitEnvelope = JSON.stringify(
  nextEnvelope(
    (duplicated as { ok: true; song: Song }).song,
    decideLoad(JSON.stringify(before)),
  ),
);
writeFileSync(
  join(tmpdir(), "aranje-2lb-commit-envelope.json"),
  commitEnvelope,
  "utf8",
);

/* ------------------------------------------------------------------ report */

const report = {
  method: {
    rounds: ROUNDS,
    warmupRounds: WARMUP,
    statistic: "median / p95 / max over timed rounds after warm-up",
  },
  honesty: [
    "Bu bölümdeki sayılar masaüstü Node ölçümüdür; fiziksel telefon kanıtı değildir.",
    "Android/iOS gerçek cihaz gecikmesi release gate'inde açık kalır.",
    "Duplicate ölçümleri limitin bir altındaki en ağır girdide alınmıştır: tam limitte işlem haklı olarak reddedilir ve ölçülecek bir iş kalmaz.",
  ],
  node: {
    version: process.version,
    subjects: {
      worstCase: sizes(worst),
      sectionRoom: {
        sections: sectionRoom.sections.length,
        bars: sectionRoom.sections.reduce((sum, s) => sum + s.bars.length, 0),
        tracks: sectionRoom.tracks.length,
      },
      trackRoom: {
        sections: trackRoom.sections.length,
        bars: trackRoom.sections.reduce((sum, s) => sum + s.bars.length, 0),
        tracks: trackRoom.tracks.length,
      },
    },
    templateMaterialization: templates,
    sectionDuplicate,
    trackDuplicate,
    validatorPipeline,
    historyAtLimit: measureHistory(worst),
  },
  chromium: null as unknown,
};

writeFileSync(
  "eval/lifecycle/PERFORMANCE.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log("eval/lifecycle/PERFORMANCE.json written (node half)");

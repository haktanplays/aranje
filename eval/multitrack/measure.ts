/**
 * What the multi-track view costs, measured rather than asserted (2Q-A §17).
 *
 * Desktop **Node**, and honest about being one: these numbers say how the
 * pure cores behave on this machine and nothing about a phone. The browser
 * half — DOM nodes, listeners, observers, animation frames, real view
 * switches — lives in `measure-browser.mjs` and merges into the same report.
 *
 * No invented thresholds. Every number is reported as measured, and where
 * one looks expensive it is written down rather than designed around.
 *
 *   npx tsx eval/multitrack/measure.ts
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { applyEdit } from "@/lib/song/edit";
import { applyTrackCommand } from "@/lib/song/track-lifecycle";
import { buildMultiTrackModel } from "@/lib/multitrack/model";
import { buildSongAxis, xAtTicks } from "@/lib/tab/song-axis";
import { withEmptyLanes } from "@/lib/song/track-lanes";
import type { Song } from "@/lib/song/schema";

const ROUNDS = 30;
const WARMUP = 20;
const SLOT_WIDTH = 34;

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
    Math.round((samples[Math.min(samples.length - 1, Math.floor(q * samples.length))] ?? 0) * 1000) /
    1000;
  return { rounds: ROUNDS, medianMs: at(0.5), p95Ms: at(0.95), maxMs: at(0.999) };
}

const SEEDS = JSON.parse(
  readFileSync(new URL("./seeds.json", import.meta.url), "utf8"),
) as Record<string, Song>;

const seed = (name: string): Song => structuredClone(SEEDS[name]!);

const firstSection = (song: Song) => song.sections[0]!.id;
const firstTrack = (song: Song) => song.tracks[0]!.id;

/* ------------------------------------------------------------ the model */

const model: Record<string, unknown> = {};
for (const name of ["fourPart", "maxTracks", "realistic", "worstCase"]) {
  const song = seed(name);
  const trackId = firstTrack(song);
  const built = buildMultiTrackModel(song, trackId);
  model[name] = {
    tracks: song.tracks.length,
    sections: song.sections.length,
    barsInSong: built.bars.length,
    lanes: built.lanes.length,
    "build the whole song's model": bench(() =>
      buildMultiTrackModel(song, trackId),
    ),
    /*
     * Switching section is no longer a rebuild at all — the model is the
     * whole song — so the only argument left to change is the active lane
     * (2Q-C §4).
     */
    "switch the active lane": bench(() =>
      buildMultiTrackModel(song, song.tracks.at(-1)!.id),
    ),
  };
}

/* --------------------------------------------------------- the geometry */

const geometry: Record<string, unknown> = {};
for (const name of ["fourPart", "worstCase", "mixedGrid"]) {
  const song = seed(name);
  const axis = buildSongAxis(song, SLOT_WIDTH);
  geometry[name] = {
    bars: axis.bars.length,
    contentWidthPx: axis.totalWidthPx,
    songTicks: axis.totalTicks,
    "lay out the axis": bench(() => buildSongAxis(song, SLOT_WIDTH)),
    "place the playhead": bench(() => xAtTicks(axis, axis.totalTicks / 2)),
  };
}

/* ------------------------------------------- making a track writable */

const guitar = {
  name: "Yeni",
  instrumentId: "electric_guitar",
  presetId: "high_gain",
  fretboard: { tuning: ["E2", "A2", "D3", "G3", "B3", "E4"], capo: 0 },
};

/**
 * `realistic` sits on `songLimits.maxTracks`, so the eighth track is the last
 * one a reader can make. The ceiling is measured by removing a track through
 * the real command — a hand-trimmed track list is a song the validators
 * refuse, which would measure nothing.
 */
function sevenOfEight(): Song {
  const full = seed("realistic");
  const trimmed = applyTrackCommand(full, {
    kind: "delete_track",
    trackId: full.tracks.at(-1)!.id,
  });
  if (!trimmed.ok) throw new Error(`delete_track refused: ${trimmed.error.code}`);
  return trimmed.song;
}

const lifecycle: Record<string, unknown> = {};
for (const name of ["fourPart", "sevenOfEight"]) {
  /*
   * `realistic` is already at `songLimits.maxTracks`, so the eighth track is
   * the last one a reader can make: the ceiling is measured by dropping one
   * track from it rather than by pretending the limit is higher.
   */
  const fresh = () => (name === "sevenOfEight" ? sevenOfEight() : seed(name));
  const song = fresh();
  const created = applyTrackCommand(song, { kind: "create_track", setup: guitar });
  if (!created.ok) throw new Error(`create_track refused on ${name}: ${created.error.code}`);
  const track = created.song.tracks.at(-1)!;
  lifecycle[name] = {
    tracksBefore: song.tracks.length,
    barsInSong: created.song.sections.reduce((sum, s) => sum + s.bars.length, 0),
    "create a track (lanes materialised)": bench(() =>
      applyTrackCommand(fresh(), { kind: "create_track", setup: guitar }),
    ),
    "materialise empty lanes alone": bench(() => withEmptyLanes(song, track)),
    /*
     * The first note on a legacy track whose key is missing: the write path
     * has to materialise the lane and write the note as one command.
     */
    "first note on a missing-key lane": bench(() =>
      applyEdit(created.song, {
        kind: "set_note",
        target: {
          sectionId: firstSection(created.song),
          trackId: track.id,
          barIndex: 0,
          slotIndex: 0,
        },
        stringIndex: 0,
        fret: 3,
      }),
    ),
    "an ordinary note on a written lane": bench(() =>
      applyEdit(created.song, {
        kind: "set_note",
        target: {
          sectionId: firstSection(created.song),
          trackId: firstTrack(created.song),
          barIndex: 0,
          slotIndex: 0,
        },
        stringIndex: 0,
        fret: 3,
      }),
    ),
  };
}

const report = {
  what: "2Q-A §17 — çoklu görünümün saf çekirdek maliyeti",
  measuredOn: "desktop Node — not a phone, and not evidence about one",
  node: process.version,
  slotWidthPx: SLOT_WIDTH,
  note:
    "DOM node counts, listeners, observers, animation frames and real view " +
    "switches are browser facts and are measured in measure-browser.mjs.",
  model,
  geometry,
  lifecycle,
};

mkdirSync("eval/multitrack/artifacts", { recursive: true });
writeFileSync(
  "eval/multitrack/artifacts/PERFORMANCE.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));

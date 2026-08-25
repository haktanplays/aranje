/**
 * What writing one event costs, measured rather than asserted (2Q-B §16).
 *
 * Desktop **Node**, and honest about being one: these numbers say how the
 * pure cores behave on this machine and nothing about a phone. The browser
 * half — how many nodes a step grid puts on the page, how long a tap takes
 * to become a rendered cell — lives in `measure-browser.mjs`.
 *
 * No invented thresholds. Every number is reported as measured, and where
 * one looks expensive it is written down rather than designed around.
 *
 *   npx tsx eval/cross-instrument/measure.ts
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { buildDrumStepModel, stepRowsFor } from "@/lib/tab/drum-step-model";
import { buildPitchedStepModel, suggestedOctave } from "@/lib/tab/pitched-step-model";
import { insertDrumHit, insertPitchedNote, removeDrumHit, landOn } from "@/lib/song/event-entry";
import { ticksPerSlot } from "@/lib/music/timing";
import type { Song } from "@/lib/song/schema";

const ROUNDS = 30;
const WARMUP = 20;

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
    Math.round(
      (samples[Math.min(samples.length - 1, Math.floor(q * samples.length))] ?? 0) * 1000,
    ) / 1000;
  return { rounds: ROUNDS, medianMs: at(0.5), p95Ms: at(0.95), maxMs: at(0.999) };
}

const OWN = JSON.parse(
  readFileSync(new URL("./fixtures/songs.json", import.meta.url), "utf8"),
) as Record<string, Song>;

/*
 * The heavy songs come from 2Q-A's generated seeds rather than being written
 * again here: they were built through the same schema and validator chain,
 * and a second copy of "what a big song looks like" would be a second thing
 * to keep true.
 */
const BIG = JSON.parse(
  readFileSync(new URL("../multitrack/seeds.json", import.meta.url), "utf8"),
) as Record<string, Song>;

const songs: Record<string, Song> = {
  kit: OWN.kit!,
  pitched: OWN.pitched!,
  fourPart: BIG.fourPart!,
  maxTracks: BIG.maxTracks!,
  worstCase: BIG.worstCase!,
};

const clone = (song: Song): Song => structuredClone(song);

const drumTrackOf = (song: Song) =>
  song.tracks.find((track) => track.instrumentId === "drum_kit");
const pitchedTrackOf = (song: Song) =>
  song.tracks.find(
    (track) => track.instrumentId !== "drum_kit" && track.fretboard === undefined,
  );

/* ------------------------------------------------------------ the models */

const models: Record<string, unknown> = {};
for (const [name, song] of Object.entries(songs)) {
  const sectionId = song.sections[0]!.id;
  const drums = drumTrackOf(song);
  const pitched = pitchedTrackOf(song);
  const entry: Record<string, unknown> = {
    bars: song.sections.reduce((total, section) => total + section.bars.length, 0),
    tracks: song.tracks.length,
  };
  if (drums) {
    const built = buildDrumStepModel(song, sectionId, drums.id);
    entry.drumStep = {
      rows: built.rows.length,
      cells: built.rows.reduce((total, row) => total + row.cells.length, 0),
      build: bench(() => buildDrumStepModel(song, sectionId, drums.id)),
      rowsScan: bench(() => stepRowsFor(song, drums.id)),
    };
  }
  if (pitched) {
    const built = buildPitchedStepModel(song, sectionId, pitched.id);
    entry.pitchedStep = {
      cells: built.cells.length,
      build: bench(() => buildPitchedStepModel(song, sectionId, pitched.id)),
      octave: bench(() => suggestedOctave(song, pitched.id)),
    };
  }
  models[name] = entry;
}

/* ---------------------------------------------------------- the commands */

const commands: Record<string, unknown> = {};
for (const [name, song] of Object.entries(songs)) {
  const sectionId = song.sections[0]!.id;
  const per = ticksPerSlot(song.sections[0]!.bars[0]!.resolution);
  const drums = drumTrackOf(song);
  const pitched = pitchedTrackOf(song);
  const entry: Record<string, unknown> = {};

  if (drums) {
    const target = { sectionId, trackId: drums.id, ticks: per };
    const base = clone(song);
    entry.landOn = bench(() => landOn(base, target));
    entry.insertDrumHit = bench(() => insertDrumHit(base, target, { piece: "snare" }));
    const written = insertDrumHit(base, target, { piece: "snare" });
    if (written.ok) {
      entry.removeDrumHit = bench(() => removeDrumHit(written.song, target, "snare"));
    }
  }
  if (pitched) {
    const target = { sectionId, trackId: pitched.id, ticks: per };
    const base = clone(song);
    entry.insertPitchedNote = bench(() =>
      insertPitchedNote(base, target, { pitch: "A3" }),
    );
  }
  commands[name] = entry;
}

mkdirSync("eval/cross-instrument/artifacts", { recursive: true });
writeFileSync(
  "eval/cross-instrument/artifacts/PERFORMANCE.json",
  `${JSON.stringify(
    {
      what: "2Q-B §16 — nota girişi çekirdeklerinin maliyeti",
      measuredOn: "masaüstü Node — telefon değil",
      method: `${WARMUP} ısınma turu, sonra ${ROUNDS} ölçüm; medyan/p95/maks`,
      note:
        "Her komut settle()'den geçiyor: yani bu sayılar şema + doğrulayıcı " +
        "zincirinin tamamını içeriyor, sadece slot yazmayı değil.",
      models,
      commands,
    },
    null,
    2,
  )}\n`,
);
console.log("eval/cross-instrument/artifacts/PERFORMANCE.json yazıldı");

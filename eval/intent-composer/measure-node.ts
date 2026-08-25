/**
 * What the intent layer costs, layer by layer, before anything is drawn (§16).
 *
 *   npx tsx eval/intent-composer/measure-node.ts
 *
 * The point is attribution, not a verdict. Every command the reader can give
 * the composer passes through the same four stations, and each one is timed on
 * its own so a slow tap is a fact about a named layer rather than a feeling:
 *
 *   command   — the pure core: writePowerChord / applyBrush / continuePattern
 *   validator — songSchema.parse and the central validator chain, which every
 *               candidate goes through before it is allowed to be the song
 *   storage   — serialising the project record, which is what `setItem` costs
 *   render    — the pure geometry the tab is drawn from: the fret glyphs and
 *               the legato arcs of a bar, without React and without a DOM
 *
 * The fifth station, sample audio, cannot be honestly measured here: there is
 * no AudioContext in node and a decode that never happened is not a cost. It
 * is measured in a real browser by `measure-perf-browser.mjs` and merged into
 * the same artefact.
 *
 * No threshold is invented. These are the numbers, and where they are large
 * they are written down large.
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { writePowerChord } from "@/lib/chords/power-chord-pen";
import { applyBrush, planBrush } from "@/lib/song/legato-brush";
import { continuePattern } from "@/lib/song/continue-pattern";
import { settle } from "@/lib/song/edit";
import { songSchema, type Song, type Track } from "@/lib/song/schema";
import { runValidators } from "@/lib/validators";
import { buildFretGlyph } from "@/lib/tab/glyph-model";
import { buildLegatoArcs } from "@/lib/tab/legato-arc";
import { sectionSlotStream } from "@/lib/song/onset-block";
import { buildTrackTimeline } from "@/lib/tab/timeline";
import { SLOT_WIDTH } from "@/components/workspace/geometry";

import { REPORTED, songFor } from "./fixtures";

const OUT = "eval/intent-composer";
const ROUNDS = 30;
const WARMUP = 8;

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
    median: round(samples[Math.floor(samples.length / 2)]!),
    p95: round(samples[Math.floor(samples.length * 0.95)]!),
    max: round(samples[samples.length - 1]!),
  };
}

/* --------------------------------------------------------------- the song */

/*
 * Not the one-bar fixtures the audio work used. A tap costs what it costs on
 * the song a reader actually has open, and the validator chain and the
 * serialiser both scale with the whole song rather than with the bar under
 * the finger. So: eight bars of 1/32 on one track — the contract ceiling for
 * a grid — with room left for the pen to write into.
 */
const HEAVY: Song = songFor({
  ...REPORTED,
  name: "perf-heavy",
  resolution: 32,
  bars: 8,
  /*
   * A moving line rather than the reported repeated fret. The brush asks the
   * sounding pitch which way the hand went, and eight of the same note is a
   * typed refusal — which would have been a cheap command to time.
   */
  onsets: [
    { fret: 5 },
    { fret: 7 },
    { fret: 8 },
    { fret: 10 },
    { fret: 12 },
    { fret: 10 },
    { fret: 8 },
    { fret: 7 },
  ],
});
/** And the everyday case beside it, so the ceiling is not read as normal. */
const ROOMY: Song = songFor({
  ...REPORTED,
  name: "perf-roomy",
  resolution: 8,
  bars: 2,
  onsets: [{ fret: 5 }],
});

const parsedHeavy = songSchema.parse(HEAVY) as Song;
const parsedRoomy = songSchema.parse(ROOMY) as Song;

const TRACK: Track = parsedHeavy.tracks[0]!;
const SECTION = parsedHeavy.sections[0]!.id;
const ROOMY_SECTION = parsedRoomy.sections[0]!.id;

/** A moment in the heavy song with nothing on it: the eighth bar's first beat. */
const EMPTY_TICKS = 768 * 7;
/** And the very first onset, which is where "replace" has something to replace. */
const OCCUPIED_TICKS = 0;

const penRequest = (song: Song, timeTicks: number, mode: "insert" | "replace_onset") => ({
  song,
  track: song.tracks[0]!,
  sectionId: song.sections[0]!.id,
  timeTicks,
  durationTicks: 768 / 32,
  stringIndex: 0,
  fret: 5,
  voices: 2 as const,
  mode,
});

/* Prove each measured command actually succeeds before it is timed: a refusal
   is a cheap command and would flatter every number in this file. */
const penOk = writePowerChord(penRequest(parsedHeavy, EMPTY_TICKS, "insert"));
if (!penOk.ok) throw new Error(`pen refused: ${penOk.error.code}`);

const brushRequest = {
  song: parsedHeavy,
  trackId: TRACK.id,
  sectionId: SECTION,
  fromTicks: 0,
  toTicks: (768 / 32) * 7,
  choice: "auto" as const,
  overrideExisting: true,
};
const brushOk = applyBrush(brushRequest);
if (!brushOk.ok) throw new Error(`brush refused: ${brushOk.reason}`);

const selection = {
  trackId: TRACK.id,
  sectionId: ROOMY_SECTION,
  startTicks: 0,
  endTicks: 768,
};
const continueOk = continuePattern({
  song: parsedRoomy,
  selection,
  mode: { kind: "repeat" },
  repeats: 1,
});
if (!continueOk.ok) throw new Error(`continue refused: ${continueOk.error.code}`);

/* --------------------------------------------------- the render geometry */

const stream = sectionSlotStream(parsedHeavy.sections[0]!, TRACK.id);

/*
 * The drawing layers get their own song, because the command layers' song is
 * the wrong shape for them: eight onsets in eight bars is what a *command*
 * costs, and it would say nothing about what a screenful of tab costs. This
 * one fills every slot of eight 1/32 bars — 256 onsets, the most a fretted
 * section can carry at this grid — and every link is a slur, so the arc
 * builder has the most work it will ever have.
 */
const RENDER_SONG: Song = songSchema.parse(
  songFor({
    ...REPORTED,
    name: "perf-render",
    resolution: 32,
    bars: 8,
    onsets: Array.from({ length: 32 * 8 }, (_, index) => ({
      fret: 5 + (index % 2),
      articulation: (index % 2 === 1 ? "hammer_on" : "pull_off") as const,
    })),
  }),
) as Song;
const renderStream = sectionSlotStream(RENDER_SONG.sections[0]!, RENDER_SONG.tracks[0]!.id);
const timeline = buildTrackTimeline(RENDER_SONG, RENDER_SONG.tracks[0]!.id);
if (timeline.kind !== "fretted") throw new Error(`timeline is ${timeline.kind}`);
const firstBar = timeline.bars[0]!;

/** Every fret glyph of the heavy song, built the way the component builds one. */
function everyGlyph(): number {
  let built = 0;
  for (const entry of renderStream) {
    const slot = entry.slot;
    if (!slot || slot === "-") continue;
    for (const note of slot.notes) {
      buildFretGlyph({
        fret: note.position?.fret ?? null,
        state: "normal",
        ...(note.articulation ? { articulation: note.articulation } : {}),
      });
      built += 1;
    }
  }
  return built;
}

const arcLayout = {
  slotWidth: SLOT_WIDTH,
  stringRowHeight: 44,
  rowTop: (stringIndex: number) => stringIndex * 44,
};

/* ------------------------------------------------------------- the layers */

const layers = {
  "command: power chord pen, insert": bench(() =>
    writePowerChord(penRequest(parsedHeavy, EMPTY_TICKS, "insert")),
  ),
  "command: power chord pen, replace an onset": bench(() =>
    writePowerChord(penRequest(parsedHeavy, OCCUPIED_TICKS, "replace_onset")),
  ),
  "command: legato brush, plan eight onsets": bench(() => planBrush(brushRequest)),
  "command: legato brush, apply eight onsets": bench(() => applyBrush(brushRequest)),
  "command: continue the pattern once": bench(() =>
    continuePattern({ song: parsedRoomy, selection, mode: { kind: "repeat" }, repeats: 1 }),
  ),
  "command: continue the pattern four times": bench(() =>
    continuePattern({ song: parsedRoomy, selection, mode: { kind: "repeat" }, repeats: 4 }),
  ),
  "command: continue by moving the shape": bench(() =>
    continuePattern({
      song: parsedRoomy,
      selection,
      mode: { kind: "shape", stringDelta: 0, fretDelta: 2 },
      repeats: 1,
    }),
  ),
  "validator: parse the candidate": bench(() => songSchema.parse(penOk.song)),
  "validator: the whole chain": bench(() => runValidators(penOk.song)),
  "validator: settle, the central gate": bench(() => settle(penOk.song)),
  "storage: serialise the project record": bench(() =>
    JSON.stringify({
      format: "aranje.project-record",
      version: 1,
      projectId: "project-1",
      revision: 2,
      updatedAt: 1_700_000_000_000,
      current: penOk.song,
      previous: parsedHeavy,
    }),
  ),
  "render: every fret glyph of the section": bench(everyGlyph),
  "render: the legato arcs of a bar": bench(() => buildLegatoArcs(firstBar, arcLayout)),
} as const;

const artefact = {
  what: "2S-A §16 — niyet katmanının katman katman maliyeti",
  measuredOn:
    "node, masaüstü konteyner. Fiziksel telefon kanıtı yoktur; buradaki hiçbir sayı bir telefonda ölçülmedi.",
  method: `${WARMUP} ısınma turu, ardından ${ROUNDS} zamanlanmış tur; median / p95 / max ms.`,
  notes: [
    "Eşik uydurulmadı. Bunlar hangi işin hangi katmanda ne kadar sürdüğünü söyleyen sayılardır.",
    "Ölçülen her komut önce gerçekten başarılı olduğu doğrulanarak zamanlandı: reddedilen bir komut ucuzdur ve bütün tabloyu güzelleştirirdi.",
    "«sample audio» burada yok, çünkü node'da AudioContext yok. O katman gerçek tarayıcıda ölçülüp aynı dosyaya eklenir.",
  ],
  songs: {
    render: {
      note: "Çizim tavanı: 8 ölçü 1/32'nin her yuvası dolu, her bağ bir slur. 256 onset.",
      bars: RENDER_SONG.sections[0]!.bars.length,
      resolution: 32,
      onsets: renderStream.filter((entry) => entry.slot && entry.slot !== "-").length,
      bytes: JSON.stringify(RENDER_SONG).length,
    },
    heavy: {
      note: "Komut tavanı: 8 ölçü 1/32, sekiz onset, tek gitar. Sıradan bir şarkı değil.",
      bars: parsedHeavy.sections[0]!.bars.length,
      resolution: 32,
      slots: stream.length,
      onsets: stream.filter((entry) => entry.slot && entry.slot !== "-").length,
      bytes: JSON.stringify(parsedHeavy).length,
    },
    roomy: {
      note: "Gündelik hâl: 2 ölçü 1/8, tek onset.",
      bars: parsedRoomy.sections[0]!.bars.length,
      resolution: 8,
      bytes: JSON.stringify(parsedRoomy).length,
    },
  },
  glyphsPerRound: everyGlyph(),
  arcsPerRound: buildLegatoArcs(firstBar, arcLayout).length,
  layers,
};

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/PERFORMANCE.json`, `${JSON.stringify(artefact, null, 2)}\n`);
console.log(JSON.stringify(artefact.layers, null, 2));
console.log(`glyphs/round ${artefact.glyphsPerRound} · arcs/round ${artefact.arcsPerRound}`);

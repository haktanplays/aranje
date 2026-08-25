/**
 * What the dense drum grid costs *before* anything is drawn (2R-A §5.3).
 *
 *   npx tsx eval/practice-loop/measure-node.ts
 *
 * 2Q-C closed with a drum tap at roughly 100 ms median on this surface and no
 * answer about where the time goes. "The DOM is too big" was the obvious
 * guess; a guess is not a root cause. So each layer a tap passes through is
 * timed on its own, on the same song, with the same command:
 *
 *   command      — insertDrumHit / removeDrumHit, the pure edit
 *   schema       — songSchema.parse, which every candidate goes through
 *   settle       — the central gate: schema plus the validator chain
 *   model        — buildDrumStepModel, the grid the component is drawn from
 *   lookup       — the per-cell work the component does while rendering
 *
 * Whatever is large here is not a rendering problem. Whatever is small here
 * and large in the browser is.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { settle } from "@/lib/song/edit";
import { insertDrumHit, removeDrumHit } from "@/lib/song/event-entry";
import { buildDrumStepModel } from "@/lib/tab/drum-step-model";
import { songSchema, type Song } from "@/lib/song/schema";
import { runValidators } from "@/lib/validators";

const HERE = new URL(".", import.meta.url).pathname;
const ROUNDS = 20;
const WARMUP = 5;

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

const fixtures = JSON.parse(
  readFileSync(`${HERE}fixtures.json`, "utf8"),
) as Record<string, unknown>;
const song = songSchema.parse(fixtures["denseKit"]) as Song;

const SECTION = song.sections[0]!.id;
const TRACK = "drums";
const built = buildDrumStepModel({ song, sectionId: SECTION, trackId: TRACK });
if (!built) throw new Error(`no kit grid for ${SECTION}/${TRACK}`);
const model = built;

/** The moment the first empty cell of the dense section stands for. */
const emptyCell = model.rows
  .flatMap((row) => row.cells.map((cell) => ({ piece: row.piece, cell })))
  .find((entry) => entry.cell.hit === null)!;
const filledCell = model.rows
  .flatMap((row) => row.cells.map((cell) => ({ piece: row.piece, cell })))
  .find((entry) => entry.cell.hit !== null)!;

const target = (ticks: number) => ({ sectionId: SECTION, trackId: TRACK, ticks });

const inserted = insertDrumHit(song, target(emptyCell.cell.ticks), {
  piece: emptyCell.piece,
  velocity: 96,
});
if (inserted.ok !== true) throw new Error(`insert failed: ${JSON.stringify(inserted)}`);
const candidate = inserted.song;

/**
 * The lookup the component does per cell today.
 *
 * `DrumStepLane` draws a bar by walking its slots and, for each one, calling
 * `row.cells.find(...)` over the row's cells for the **whole section**. That
 * is the shape being measured here — not a guess about it — because a linear
 * scan per cell is quadratic in the section's length and nothing about it is
 * visible in a DOM node count.
 */
function currentPerCellLookup(): number {
  let seen = 0;
  for (const bar of model.bars) {
    for (const row of model.rows) {
      for (let slotIndex = 0; slotIndex < bar.slotCount; slotIndex += 1) {
        const cell = row.cells.find(
          (entry) => entry.barIndex === bar.barIndex && entry.slotIndex === slotIndex,
        );
        if (cell) seen += 1;
      }
    }
  }
  return seen;
}

/** The same answer, from an index built once. */
function indexedPerCellLookup(): number {
  let seen = 0;
  for (const row of model.rows) {
    const byKey = new Map<string, unknown>();
    for (const cell of row.cells) byKey.set(`${cell.barIndex}:${cell.slotIndex}`, cell);
    for (const bar of model.bars) {
      for (let slotIndex = 0; slotIndex < bar.slotCount; slotIndex += 1) {
        if (byKey.get(`${bar.barIndex}:${slotIndex}`)) seen += 1;
      }
    }
  }
  return seen;
}

const cells = model.rows.reduce((total, row) => total + row.cells.length, 0);
const measured = {
  fixture: "denseKit",
  section: SECTION,
  tracks: song.tracks.length,
  bars: song.sections.reduce((total, section) => total + section.bars.length, 0),
  denseSectionBars: song.sections[0]!.bars.length,
  rows: model.rows.length,
  slotsPerBar: model.bars[0]!.slotCount,
  cells,
  layers: {
    "command: insert a hit": bench(() =>
      insertDrumHit(song, target(emptyCell.cell.ticks), {
        piece: emptyCell.piece,
        velocity: 96,
      }),
    ),
    "command: remove a hit": bench(() =>
      removeDrumHit(song, target(filledCell.cell.ticks), filledCell.piece),
    ),
    "schema: parse the candidate": bench(() => songSchema.parse(candidate)),
    "validators: the whole chain": bench(() => runValidators(candidate)),
    "settle: the central gate": bench(() => settle(candidate)),
    "model: build the step grid": bench(() =>
      buildDrumStepModel({ song: candidate, sectionId: SECTION, trackId: TRACK }),
    ),
    "render: the per-cell lookup as it is": bench(currentPerCellLookup),
    "render: the same lookup, indexed once": bench(indexedPerCellLookup),
  },
};

if (currentPerCellLookup() !== indexedPerCellLookup()) {
  throw new Error("the indexed lookup does not answer the same thing");
}

mkdirSync(HERE, { recursive: true });
writeFileSync(
  `${HERE}PERFORMANCE.json`,
  `${JSON.stringify(
    {
      what: "2R-A §5.3 — yoğun davul ızgarasının katman katman saf maliyeti",
      measuredOn: "node, masaüstü konteyner — telefon kanıtı değil",
      method: `${WARMUP} ısınma turu, ardından ${ROUNDS} zamanlanmış tur; median / p95 / max ms.`,
      notes: [
        "Eşik uydurulmadı. Bunlar kök nedenin hangi katmanda olduğunu gösteren sayılardır.",
        "«render: per-cell lookup», bileşenin bugün her hücre için yaptığı " +
          "row.cells.find(...) taramasıdır — DOM sayısında görünmeyen, bölüm " +
          "uzunluğunda karesel bir maliyet.",
        "Aynı cevabı bir kez kurulan indeksle vermek ikinci satırdır; ikisi " +
          "aynı hücre sayısını bulduğu doğrulanır.",
      ],
      measured,
    },
    null,
    2,
  )}\n`,
);

console.log(
  `denseKit: ${measured.rows} satır × ${measured.denseSectionBars} ölçü × ` +
    `${measured.slotsPerBar} slot = ${measured.cells} hücre`,
);
for (const [name, stat] of Object.entries(measured.layers)) {
  console.log(`  ${name.padEnd(38)} ${stat.median} ms (p95 ${stat.p95})`);
}
console.log(`\n${HERE}PERFORMANCE.json yazıldı`);

/**
 * Where a drum tap's time really goes, stage by stage (2R-A §IV).
 *
 *   npx tsx eval/practice-loop/measure-edit-cost.ts
 *
 * `measure-node.ts` timed five layers and `profile-tap.mjs` timed the whole
 * interaction from inside the page. Between them sat a gap: the whole was
 * five times bigger on the ceiling fixture than on a realistic song, and no
 * single layer explained it. This harness closes that gap by walking the
 * *actual* path a tap takes and timing each step of it separately.
 *
 * The path, read off the production code rather than assumed:
 *
 *   `DrumStepLane` onClick
 *     → `entry.toggle(ticks, piece)`            (2) command input
 *     → `insertDrumHit` / `removeDrumHit`
 *          landOn                                (2) target resolution
 *          laneFor                               (3) lane materialisation
 *          build the hit and the next lane       (4) event candidate
 *          finish → `settle`
 *              songSchema.safeParse              (5) strict schema
 *              runValidators + errorsOnly        (6) central validator chain
 *     → `store.commit`
 *          songSchema.safeParse **again**        (5b) the second gate
 *          sameSong                              (7) same-music check
 *          recordEdit                            (8) history snapshot
 *          persistence.save
 *              envelope + JSON.stringify         (9) serialise
 *              setItem                          (10) physical write
 *          publish                              (11) store publish
 *
 * Stages 1 and 12–14 — hitting the cell, React's render, and the paint the
 * reader actually sees — cannot be timed here and are measured in the browser
 * harness instead. What is *here* is everything between the tap and the
 * moment React is told something changed.
 *
 * No stage is skipped, weakened or reordered to make a number look better.
 * The two schema parses below are both real: `settle` runs one and the store
 * runs another, and this harness reports them separately precisely so the
 * duplication is a measured fact rather than an impression.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { settle } from "@/lib/song/edit";
import { insertDrumHit, removeDrumHit } from "@/lib/song/event-entry";
import { createEditHistory, recordEdit } from "@/lib/song/edit-history";
import { songSchema, type Song } from "@/lib/song/schema";
import { runValidators, errorsOnly, warningsOnly } from "@/lib/validators";
import { buildDrumStepModel } from "@/lib/tab/drum-step-model";
import { buildTrackTimeline, sectionRuns } from "@/lib/tab/timeline";
import { buildArrangementModel } from "@/lib/arrangement/model";
import { buildMultiTrackModel } from "@/lib/multitrack/model";
import { buildSongAxis } from "@/lib/tab/song-axis";
import { buildSongPlan } from "@/lib/audio/schedule";
import { drumGridAxis } from "@/lib/ui/drum-grid-window";
import { SLOT_WIDTH } from "@/components/workspace/geometry";
import { ticksPerSlot } from "@/lib/music/timing";

const HERE = new URL(".", import.meta.url).pathname;
const ROUNDS = Number(process.env.ROUNDS ?? 30);
const WARMUP = Number(process.env.WARMUP ?? 8);

const round = (value: number, places = 3) =>
  Math.round(value * 10 ** places) / 10 ** places;

type Stat = { rounds: number; median: number; p95: number; max: number };

function bench(run: () => unknown): Stat {
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

const fixtures = JSON.parse(readFileSync(`${HERE}fixtures.json`, "utf8")) as Record<
  string,
  unknown
>;

/**
 * A storage double that does what the real one does and nothing else.
 *
 * `setItem` on a real `localStorage` is what the browser harness measures;
 * here the point is the *serialisation* in front of it, so the sink keeps the
 * string — throwing it away would let an engine skip the work that produced
 * it.
 */
function sink() {
  let held = "";
  return {
    setItem(_key: string, value: string) {
      held = value;
    },
    read: () => held,
  };
}

function measure(name: string) {
  const song = songSchema.parse(fixtures[name]) as Song;
  const drums = song.tracks.find((track) => track.instrumentId === "drum_kit");
  if (!drums) throw new Error(`${name} has no kit`);

  /* The busiest section this fixture has: the one a tap is worst on. */
  const section = [...song.sections].sort(
    (a, b) =>
      b.bars.reduce((n, bar) => n + bar.resolution, 0) -
      a.bars.reduce((n, bar) => n + bar.resolution, 0),
  )[0]!;
  const model = buildDrumStepModel(song, section.id, drums.id);
  const axis = drumGridAxis(model, SLOT_WIDTH);

  /* An empty cell to write to, and a filled one to erase. */
  const kick = model.rows.find((row) => row.piece === "kick") ?? model.rows[0]!;
  const empty = kick.cells.find((cell) => cell.hit === null) ?? kick.cells[0]!;
  const filled = kick.cells.find((cell) => cell.hit !== null) ?? kick.cells[0]!;

  /*
   * A target is a *moment*, not a coordinate: ticks from the start of the
   * section, never rounded. That is the same shape the component hands the
   * command, so this measures the real call rather than a convenient one.
   */
  const target = { trackId: drums.id, sectionId: section.id, ticks: empty.ticks };
  const eraseTarget = { ...target, ticks: filled.ticks };

  /* The candidate this tap produces, computed once so later stages have it. */
  const inserted = insertDrumHit(song, target, { piece: kick.piece });
  if (!inserted.ok) throw new Error(`${name}: insert refused with ${inserted.code}`);
  const candidate = inserted.song;
  const parsed = songSchema.parse(candidate);
  const issues = runValidators(parsed);
  const history = createEditHistory(song);
  const store = sink();

  const stages: Record<string, Stat> = {
    /* 2 + 3 + 4 + 5 + 6: the pure command, end to end. */
    commandInsert: bench(() => insertDrumHit(song, target, { piece: kick.piece })),
    commandRemove: bench(() => removeDrumHit(song, eraseTarget, kick.piece)),
    /* 5: strict schema, on its own. */
    schemaParse: bench(() => songSchema.safeParse(candidate)),
    /* 6: the central validator chain, on its own. */
    validators: bench(() => runValidators(parsed)),
    validatorIssueSplit: bench(() => {
      errorsOnly(issues);
      warningsOnly(issues);
    }),
    /* 5 + 6 together, which is what `settle` is. */
    settle: bench(() => settle(candidate)),
    /* 7: the same-music check the store makes before it records anything. */
    sameSongCheck: bench(() => JSON.stringify(candidate) === JSON.stringify(song)),
    /* 8: the history step. */
    historyRecord: bench(() =>
      recordEdit(history, candidate, { kind: "drum_entry", command: "insert" }),
    ),
    /* 9: the envelope the record is written as. */
    serialize: bench(() => JSON.stringify({ format: "aranje.project-record", version: 1, current: candidate })),
    /* 10: the write itself, against a sink rather than a disk. */
    physicalWrite: bench(() =>
      store.setItem("aranje.project.bench", JSON.stringify(candidate)),
    ),
    /*
     * 11b: what a *new Song object* forces to be rebuilt, whether or not the
     * reader is looking at it.
     *
     * Every derived model in the workspace is memoised on `song`, and a
     * commit replaces `song`. So a tap on a kit cell invalidates the tab's
     * timeline, the arrangement's model, the multi-track model and the
     * transport's plan at the same moment — none of which the tap changed the
     * meaning of, and all of which are recomputed before the next paint.
     * This is the class §IV names as worth measuring before assuming.
     */
    rebuildDrumModel: bench(() => buildDrumStepModel(candidate, section.id, drums.id)),
    rebuildGridAxis: bench(() => drumGridAxis(model, SLOT_WIDTH)),
    rebuildTabTimeline: bench(() => buildTrackTimeline(candidate, drums.id)),
    rebuildSectionRuns: bench(() => sectionRuns(candidate)),
    rebuildArrangement: bench(() => buildArrangementModel(candidate)),
    rebuildMultiTrack: bench(() => buildMultiTrackModel(candidate, drums.id)),
    rebuildSongAxis: bench(() => buildSongAxis(candidate, SLOT_WIDTH)),
    rebuildPlaybackPlan: bench(() => buildSongPlan(candidate)),
  };

  /*
   * The two parses a single tap really pays for: `settle` runs one and
   * `songStore.commit` runs another on the object `settle` just returned.
   */
  stages.schemaParsedTwice = bench(() => {
    const first = settle(candidate);
    if (first.ok) songSchema.safeParse(first.song);
  });

  const sum = (keys: readonly string[]) =>
    round(keys.reduce((total, key) => total + (stages[key]?.median ?? 0), 0));

  return {
    fixture: name,
    shape: {
      tracks: song.tracks.length,
      bars: song.sections.reduce((n, entry) => n + entry.bars.length, 0),
      sections: song.sections.length,
      measuredSection: section.id,
      sectionBars: section.bars.length,
      sectionResolutions: [...new Set(section.bars.map((bar) => bar.resolution))].sort(
        (a, b) => a - b,
      ),
      gridColumns: axis.columns.length,
      kitRows: model.rows.length,
      gridCells: axis.columns.length * model.rows.length,
      songBytes: JSON.stringify(song).length,
      ticksPerSlotAtSection: ticksPerSlot(section.bars[0]!.resolution),
    },
    stages,
    rollup: {
      /* Everything between the tap and React being told, as measured here. */
      commandToPublishMs: sum([
        "commandInsert",
        "schemaParse",
        "sameSongCheck",
        "historyRecord",
        "serialize",
        "physicalWrite",
      ]),
      centralGateMs: sum(["schemaParse", "validators"]),
      duplicateSchemaMs: stages.schemaParse?.median ?? 0,
      /* Everything a new Song object invalidates, drum grid included. */
      derivedModelRebuildMs: sum([
        "rebuildDrumModel",
        "rebuildGridAxis",
        "rebuildTabTimeline",
        "rebuildSectionRuns",
        "rebuildArrangement",
        "rebuildMultiTrack",
        "rebuildSongAxis",
        "rebuildPlaybackPlan",
      ]),
    },
  };
}

const results = ["practiceSong", "denseKit"].map(measure);

mkdirSync(HERE, { recursive: true });
writeFileSync(
  `${HERE}EDIT-COST-BREAKDOWN.json`,
  `${JSON.stringify(
    {
      what: "2R-A §IV — bir davul dokunuşunun aşama aşama maliyeti",
      measuredOn: {
        runtime: `node ${process.version}`,
        platform: `${process.platform} ${process.arch}`,
        note: "Masaüstü Node. Fiziksel telefon kanıtı değildir.",
      },
      method: {
        warmup: WARMUP,
        rounds: ROUNDS,
        statistic: "median / p95 / max, ms",
        stagesNotMeasuredHere:
          "1 (pointer hedefi), 12–14 (React render, ilk paint, input-to-visible) tarayıcı harness'ındadır.",
        gate: "Hiçbir aşama atlanmadı, gevşetilmedi veya sırası değiştirildi.",
      },
      results,
    },
    null,
    2,
  )}\n`,
);

for (const result of results) {
  console.log(
    `\n=== ${result.fixture}: ${result.shape.tracks} track, ${result.shape.bars} bar, ` +
      `${result.shape.gridCells} hücre, ${result.shape.songBytes} bayt`,
  );
  for (const [stage, stat] of Object.entries(result.stages)) {
    console.log(
      `  ${stage.padEnd(22)} ${String(stat.median).padStart(9)} ms  p95 ${String(stat.p95).padStart(9)}`,
    );
  }
  console.log(`  → command→publish ${result.rollup.commandToPublishMs} ms, gate ${result.rollup.centralGateMs} ms`);
}
console.log(`\n${HERE}EDIT-COST-BREAKDOWN.json yazıldı`);

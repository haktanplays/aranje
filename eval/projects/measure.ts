/**
 * What the project library costs, measured rather than asserted (2O-A §25).
 *
 * Every number here is a desktop **Node** measurement and is honest about
 * being one. It says how the pure cores behave on this machine; it says
 * nothing about a phone, and physical Android/iOS latency stays open at the
 * release gate. The browser half — DOM nodes, quota, real `setItem` — lives in
 * `measure-browser.mjs` and merges into the same report.
 *
 * No invented thresholds. The numbers are reported as measured; where one
 * looks bad it is written down rather than hidden or designed around.
 *
 *   npx tsx eval/projects/measure.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { worstCasePlayableSong } from "../shared/worst-case-song";

import {
  createProject,
  duplicateProject,
  openProject,
  type ProjectEnv,
} from "@/lib/projects/project-commands";
import {
  decideCatalog,
  initialCatalog,
  serializeCatalog,
  type ProjectCatalogV1,
} from "@/lib/projects/project-catalog";
import { decideRecord, nextRecord, serializeRecord } from "@/lib/projects/project-record";
import { settleProjects } from "@/lib/projects/project-migration";
import {
  CATALOG_KEY,
  projectKey,
  writeRecord,
  type EnumerableStorage,
} from "@/lib/projects/project-storage";
import { summarizeSong } from "@/lib/projects/project-summary";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import { songSchema, type Song } from "@/lib/song/schema";
import { runValidators } from "@/lib/validators";

const ROUNDS = 30;
const WARMUP = 40;
const NOW = 1_700_000_000_000;

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

/** An in-memory store with the same surface the browser gives. */
function memory(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  const storage: EnumerableStorage = {
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
  return { storage, data };
}

/** A library of `count` projects holding `song`. */
function library(count: number, song: Song) {
  const ids = Array.from({ length: count }, (_, index) => `project-${index + 1}`);
  const seed: Record<string, string> = {};
  for (const id of ids) {
    seed[projectKey(id)!] = serializeRecord(
      nextRecord(id, song, { kind: "empty" }, NOW),
    );
  }
  const catalog: ProjectCatalogV1 = {
    ...initialCatalog(ids[0]!),
    projectIds: ids,
    activeProjectId: ids[0]!,
    nextProjectNumber: count + 1,
  };
  seed[CATALOG_KEY] = serializeCatalog(catalog);
  const { storage, data } = memory(seed);
  const env: ProjectEnv = { storage, catalog, now: NOW };
  return { storage, data, catalog, env, ids };
}

const bytes = (text: string) => Buffer.byteLength(text, "utf8");

/* --------------------------------------------------- the realistic project */

const demo = songSchema.parse(SAMPLE_SONG);
const ten = library(10, demo);

const realistic = {
  fixture: {
    song: "the sample song",
    sections: demo.sections.length,
    bars: demo.sections.reduce((sum, section) => sum + section.bars.length, 0),
    tracks: demo.tracks.length,
    projectsInCatalog: 10,
  },
  "project list build (10 projects, summaries from their songs)": bench(() =>
    ten.catalog.projectIds.map((id) => {
      const record = decideRecord(ten.storage.getItem(projectKey(id)!));
      return record.kind === "record"
        ? summarizeSong(id, record.song, { isActive: false, updatedAt: record.updatedAt })
        : null;
    }),
  ),
  "open a project (read, verify, catalog write)": bench(() =>
    openProject(library(10, demo).env, "project-5"),
  ),
  "create a project (template, validators, payload, catalog)": bench(() =>
    createProject(library(10, demo).env, "rock_band"),
  ),
  "duplicate a project": bench(() => duplicateProject(library(10, demo).env, "project-1")),
  "catalog serialize + parse": bench(() =>
    decideCatalog(serializeCatalog(ten.catalog)),
  ),
  "project record parse + strict validation": bench(() =>
    decideRecord(ten.storage.getItem(projectKey("project-1")!)),
  ),
  "central validator chain": bench(() => runValidators(demo)),
  "one song commit (record write)": bench(() =>
    writeRecord(library(1, demo).storage, "project-1", demo, NOW),
  ),
  bytes: {
    oneProjectRecord: bytes(ten.data.get(projectKey("project-1")!) ?? ""),
    catalogOfTen: bytes(ten.data.get(CATALOG_KEY) ?? ""),
  },
};

/* ------------------------------------------------------ the heaviest project */

const worst = songSchema.parse(worstCasePlayableSong());
const worstLibrary = library(1, worst);
const worstRecordBytes = bytes(worstLibrary.data.get(projectKey("project-1")!) ?? "");

const heavy = {
  fixture: {
    song: "the 2M-A worst-case playable song",
    sections: worst.sections.length,
    bars: worst.sections.reduce((sum, section) => sum + section.bars.length, 0),
    tracks: worst.tracks.length,
  },
  bytes: {
    oneProjectRecord: worstRecordBytes,
    mib: Number((worstRecordBytes / 1024 / 1024).toFixed(3)),
    /*
     * A duplicate is a second full payload — there is no sharing and none is
     * pretended. Two of these is what a reader spends to keep a copy.
     */
    duplicateCostsAnother: worstRecordBytes,
    catalogPlusOneWorstProject: worstRecordBytes + bytes(serializeCatalog(worstLibrary.catalog)),
  },
  "project switch: parse + strict validation": bench(() =>
    decideRecord(worstLibrary.data.get(projectKey("project-1")!) ?? null),
  ),
  "duplicate, end to end": bench(() =>
    duplicateProject(library(1, worst).env, "project-1"),
  ),
  "recovery: current unreadable, previous good": bench(() => {
    const damaged = serializeRecord({
      format: "aranje.project-record",
      version: 1,
      projectId: "project-1",
      revision: 4,
      updatedAt: NOW,
      current: { broken: true } as unknown as Song,
      previous: worst,
    });
    return decideRecord(damaged);
  }),
};

/* --------------------------------------------------------- catalog at scale */

const scale: Record<string, unknown> = {};
for (const count of [1, 5, 20, 50]) {
  const world = library(count, demo);
  scale[`${count} projects`] = {
    catalogBytes: bytes(world.data.get(CATALOG_KEY) ?? ""),
    totalPayloadBytes: [...world.data.entries()]
      .filter(([key]) => key.startsWith("aranje.project."))
      .reduce((sum, [, value]) => sum + bytes(value), 0),
    "startup settle (finish, read, verify active)": bench(() =>
      settleProjects(library(count, demo).storage, () => NOW),
    ),
    "summary model for the whole list": bench(() =>
      world.catalog.projectIds.map((id) => {
        const record = decideRecord(world.storage.getItem(projectKey(id)!));
        return record.kind === "record"
          ? summarizeSong(id, record.song, {
              isActive: false,
              updatedAt: record.updatedAt,
            })
          : null;
      }),
    ),
  };
}

const report = {
  measuredOn: "desktop Node — not a phone, and not evidence about one",
  node: process.version,
  note:
    "localStorage quota is a browser fact and is measured in measure-browser.mjs; " +
    "nothing here is a guarantee about how much a device will accept.",
  realistic,
  heavy,
  scale,
};

mkdirSync("eval/projects/artifacts", { recursive: true });
writeFileSync(
  "eval/projects/artifacts/PERFORMANCE.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));

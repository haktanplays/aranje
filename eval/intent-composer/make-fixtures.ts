/**
 * The songs the 2S-A baseline is measured against (§2).
 *
 * Generated, not typed out, and written only after the strict schema and the
 * central validator chain have accepted them: a fixture that disagrees with
 * the app measures the fixture rather than the product.
 *
 *   npx tsx eval/intent-composer/make-fixtures.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { songSchema, type Song } from "@/lib/song/schema";
import { errorsOnly, runValidators, warningsOnly } from "@/lib/validators";

import { REPORTED, matrix, songFor, techniqueShowcase } from "./fixtures";

const OUT = "eval/intent-composer";
mkdirSync(OUT, { recursive: true });

const named: Record<string, Song> = {
  /** §2 A exactly: 4/4, 132 BPM, 1/32, eight onsets, the `8→7` a pull-off. */
  dense32: songFor(REPORTED),
  /** The same eight onsets on the 1/16 grid, for the comparison §2 A asks for. */
  dense16: songFor({ ...REPORTED, name: "dense16", resolution: 16 }),
  /** Five plain onsets on one string: what the legato brush is measured on. */
  legatoRun: songFor({
    ...REPORTED,
    name: "legatoRun",
    resolution: 16,
    onsets: [{ fret: 5 }, { fret: 7 }, { fret: 8 }, { fret: 7 }, { fret: 5 }],
  }),
  /** Every technique the contract can express, for the notation acceptance. */
  techniques: techniqueShowcase(),
  /** One onset and a lot of room: what the power chord pen writes into. */
  roomy: songFor({
    ...REPORTED,
    name: "roomy",
    resolution: 8,
    bars: 2,
    onsets: [{ fret: 5 }],
  }),
};

const report: Record<string, unknown> = {};
for (const [name, song] of Object.entries(named)) {
  const parsed = songSchema.safeParse(song);
  if (!parsed.success) {
    throw new Error(`${name}: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`);
  }
  const issues = runValidators(parsed.data);
  const errors = errorsOnly(issues);
  if (errors.length > 0) {
    throw new Error(`${name}: ${errors.map((issue) => issue.code).join(", ")}`);
  }
  report[name] = {
    bars: parsed.data.sections.reduce((total, section) => total + section.bars.length, 0),
    tracks: parsed.data.tracks.length,
    warnings: warningsOnly(issues).map((issue) => issue.code),
  };
}

writeFileSync(`${OUT}/fixtures.json`, `${JSON.stringify(named, null, 2)}\n`);
writeFileSync(`${OUT}/fixtures-report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(`wrote ${Object.keys(named).length} fixtures`);
console.log(JSON.stringify(report, null, 2));

export { named, matrix };

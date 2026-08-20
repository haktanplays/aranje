/**
 * The acceptance list of the eval, checked against the final song.
 *
 * Every line either passes or is reported. Nothing here decides whether the
 * music is any good — that is a listening question and this file cannot
 * answer it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { songSchema, type Song } from "@/lib/song/schema";
import { runValidators } from "@/lib/validators";
import { buildSongPlan, PPQ } from "@/lib/audio/schedule";
import { buildTempoMap, secondsAtTicks } from "@/lib/audio/tempo";
import { isDrumInstrument } from "@/lib/instruments/registry";

const HERE = new URL(".", import.meta.url).pathname;
const song: Song = songSchema.parse(
  JSON.parse(readFileSync(join(HERE, "artifacts/final-song.json"), "utf8")),
);

const lines: string[] = [];
const check = (name: string, ok: boolean, detail = "") =>
  lines.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);

check("song schema", true);

const issues = runValidators(song);
const errors = issues.filter((i) => i.severity === "error");
const warnings = issues.filter((i) => i.severity === "warning");
check("validator errors = 0", errors.length === 0, `${errors.length}`);

for (const code of [
  "stringCollision",
  "range",
  "fretboardIntegrity",
  "unplaceable",
  "patchSize",
  "drumVocab",
  "slotCount",
  "songLimits",
  "tonalMajority",
]) {
  const n = issues.filter((i) => i.code === code).length;
  check(`${code} = 0`, n === 0, `${n}`);
}

const articulation = warnings.filter((i) => i.code === "articulationContext");
check(
  "invalid articulation warning = 0",
  articulation.length === 0,
  articulation.map((i) => i.message).join(" | "),
);

const fretJump = warnings.filter((i) => i.code === "fretJump");
check(
  "fret jump warnings",
  fretJump.length === 0,
  fretJump.map((i) => `bar ${(i.barIndex ?? 0) + 1} slot ${(i.slotIndex ?? 0) + 1}: ${i.message}`).join(" | "),
);

// The outro must contain the acoustic and nothing else — not an empty array
// for the other tracks, but no key for them at all (spec 5.5).
const outro = song.sections.find((s) => s.id === "acoustic_outro");
const outroKeys = new Set(outro?.bars.flatMap((b) => Object.keys(b.slots)) ?? []);
check(
  "acoustic outro has only the acoustic track",
  outroKeys.size === 1 && outroKeys.has("acoustic_gtr"),
  [...outroKeys].join(", "),
);

const bass = song.tracks.filter((t) => t.instrumentId.includes("bass"));
check("no bass track", bass.length === 0, `${bass.length}`);

const plan = buildSongPlan(song);
const seconds = buildTempoMap(song).totalSeconds;
check(
  "duration 55–65 s",
  seconds >= 55 && seconds <= 65,
  `${seconds.toFixed(3)} s`,
);

// Section start times, for the full-mix report.
const tempoMap = buildTempoMap(song);
let tick = 0;
const starts: string[] = [];
for (const section of song.sections) {
  starts.push(
    `${section.name}: ${secondsAtTicks(tempoMap, tick).toFixed(3)} s`,
  );
  for (const bar of section.bars) {
    tick += (PPQ * 4 * bar.timeSignature[0]) / bar.timeSignature[1];
  }
}

const melodic = song.tracks.filter((t) => !isDrumInstrument(t.instrumentId));
console.log(lines.join("\n"));
console.log(`\nevents: ${plan.events.length}, bars: ${plan.bars.length}`);
console.log(`melodic tracks: ${melodic.map((t) => t.id).join(", ")}`);
console.log(`section starts:\n  ${starts.join("\n  ")}`);

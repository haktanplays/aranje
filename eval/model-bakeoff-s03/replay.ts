/**
 * Materializer replay against the corrected boundary (K-35).
 *
 * This is not a new model run and it measures nothing about either model. The
 * blueprint is candidate A's accepted answer, byte for byte, and the arrange
 * turns are the ones already recorded. The only thing that changed is the code
 * between the plan and the Song.
 *
 * So the question it answers is narrow and worth answering: does the same plan,
 * applied by the fixed materializer, now produce the instruments and the
 * source context it always asked for?
 *
 * It writes to its own directory. The original artefacts are the evidence for
 * the confounded run and are never overwritten.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { compositionBlueprintSchema } from "@/lib/copilot/blueprint";
import { buildArrangementContext } from "@/lib/copilot/arrangement-context";
import { materializeSongSkeleton } from "@/lib/copilot/materialize";
import { isAcousticInstrument } from "@/lib/instruments/registry";
import { unwrapProviderEnvelope } from "./envelope.js";
import { runTurn, type TurnSpec } from "./harness.js";
import type { ArrangeSkill } from "@/lib/copilot/contract";

const SOURCE = "eval/model-bakeoff-s03/artifacts/candidate-a";
const OUT = "eval/model-bakeoff-s03/artifacts/replay-2h-b1";
mkdirSync(OUT, { recursive: true });

const blueprint = compositionBlueprintSchema.parse(
  JSON.parse(readFileSync(`${SOURCE}/blueprint.json`, "utf8")),
);

const before = JSON.parse(readFileSync(`${SOURCE}/skeleton.json`, "utf8")) as {
  tracks: { id: string; instrumentId: string; presetId: string }[];
  sections: { id: string; name: string; bars: { slots: Record<string, unknown> }[] }[];
};

const built = materializeSongSkeleton(blueprint, { title: "Bake-off A (2H-B.1 replay)" });
if (!built.ok) {
  console.error(`replay failed: ${built.reason}`);
  process.exit(1);
}
const after = built.song;

/** Instrument and preset, before the fix and after it. */
const trackDiff = blueprint.tracks.map((entry) => {
  const old = before.tracks.find((track) => track.id === entry.role);
  const now = after.tracks.find((track) => track.id === entry.role);
  return {
    role: entry.role,
    presetIntent: entry.presetIntent,
    before: old ? `${old.instrumentId}/${old.presetId}` : null,
    after: now ? `${now.instrumentId}/${now.presetId}` : null,
    changed: old && now ? old.instrumentId !== now.instrumentId || old.presetId !== now.presetId : false,
  };
});

/** Which instruments each section actually carries, before and after. */
const sectionDiff = blueprint.sections.map((section, index) => {
  const id = `sec-${index + 1}`;
  const oldSection = before.sections.find((s) => s.id === id);
  const newSection = after.sections.find((s) => s.id === id);
  const instruments = (
    songSection: { bars: { slots: Record<string, unknown> }[] } | undefined,
    tracks: { id: string; instrumentId: string }[],
  ) => {
    const keys = new Set((songSection?.bars ?? []).flatMap((bar) => Object.keys(bar.slots)));
    return [...keys]
      .map((key) => tracks.find((track) => track.id === key)?.instrumentId ?? key)
      .sort();
  };
  const beforeInstruments = instruments(oldSection, before.tracks);
  const afterInstruments = instruments(newSection, after.tracks);
  const plannedAcoustic = section.activeRoles.every(
    (role) => role === "acoustic_guitar" || role === "harmony",
  );
  return {
    key: section.key,
    displayName: section.displayName,
    plannedAcousticOnly: plannedAcoustic,
    before: beforeInstruments,
    after: afterInstruments,
    violatedBefore: plannedAcoustic && beforeInstruments.some((id) => !isAcousticInstrument(id)),
    violatedAfter: plannedAcoustic && afterInstruments.some((id) => !isAcousticInstrument(id)),
  };
});

/*
 * Replay the recorded turns onto the corrected skeleton.
 *
 * The answers are the ones the model already gave; nothing is re-asked and
 * nothing is edited. Applying them is what turns a skeleton into a song that
 * can be rendered and inspected.
 */
const turns = JSON.parse(readFileSync(`${SOURCE}/turns.json`, "utf8")) as TurnSpec[];
let song = after;
const replayLog: { turn: number; label: string; ok: boolean; detail: string }[] = [];

for (const turn of turns) {
  const answerPath = `${SOURCE}/turn-${turn.index}-attempt-`;
  let applied = false;
  for (let attempt = 0; attempt <= 2 && !applied; attempt += 1) {
    const file = `${answerPath}${attempt}-response.json`;
    if (!existsSync(file)) continue;
    const envelope = unwrapProviderEnvelope(readFileSync(file, "utf8"));
    const outcome = runTurn(song, turn, "A", envelope.text);
    if (!outcome.ok) continue;
    song = outcome.song;
    applied = true;
    replayLog.push({ turn: turn.index, label: turn.label, ok: true, detail: `${outcome.warnings.length} warning` });
  }
  if (!applied) replayLog.push({ turn: turn.index, label: turn.label, ok: false, detail: "no accepted answer replayed" });
}

/** What the harmony turn would now be shown, in the acoustic sections. */
const sourceDiff = sectionDiff
  .filter((entry) => entry.plannedAcousticOnly)
  .map((entry) => {
    const sectionId = `sec-${blueprint.sections.findIndex((s) => s.key === entry.key) + 1}`;
    const context = buildArrangementContext(song, sectionId, "harmony", "harmony" as ArrangeSkill);
    return {
      section: entry.displayName,
      harmonyNowSees: context?.sources.map((source) => source.label) ?? [],
    };
  });

writeFileSync(`${OUT}/song.json`, `${JSON.stringify(song, null, 2)}\n`);
writeFileSync(
  `${OUT}/REPLAY.json`,
  `${JSON.stringify(
    {
      what: "Deterministic materializer replay of candidate A's accepted blueprint against the 2H-B.1 boundary.",
      notAModelRun: true,
      measuresModelQuality: false,
      trackDiff,
      sectionDiff,
      sourceDiff,
      replayLog,
    },
    null,
    2,
  )}\n`,
);

console.log("track instrument/preset:");
for (const entry of trackDiff) {
  console.log(`  ${entry.role.padEnd(16)} ${String(entry.before).padEnd(24)} -> ${entry.after}${entry.changed ? "   CHANGED" : ""}`);
}
console.log("\nacoustic-only sections:");
for (const entry of sectionDiff.filter((s) => s.plannedAcousticOnly)) {
  console.log(`  ${entry.displayName}: before=${entry.before.join(",")} after=${entry.after.join(",")}`);
  console.log(`    violated before=${entry.violatedBefore} after=${entry.violatedAfter}`);
}
console.log(`\nturns replayed: ${replayLog.filter((r) => r.ok).length}/${replayLog.length}`);
console.log("\nharmony source context now:");
for (const entry of sourceDiff) console.log(`  ${entry.section}: ${entry.harmonyNowSees.join(", ") || "(none)"}`);

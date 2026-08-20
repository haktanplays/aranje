/**
 * The blind comparison table. `npx tsx eval/model-bakeoff-s03/report.ts`
 *
 * Candidates are A and B and nothing else: no model name is printed, looked
 * up or inferred here, and the sealed mapping is never read. The numbers are
 * counts and measurements, and there is no column that adds them up — a
 * candidate that used one grid well is not behind one that used five badly,
 * and the decision this run exists to inform is a listening decision.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { songSchema, type Song } from "@/lib/song/schema";
import { runValidators } from "@/lib/validators";
import { resolutionLabel, type Resolution } from "@/lib/music/timing";
import { analyseCandidate, sectionSimilarity } from "./analysis";

const ROOT = "eval/model-bakeoff-s03/artifacts";
const CANDIDATES = ["a", "b"] as const;

type RenderCut = {
  id: string;
  rms: number;
  peak: number;
  seconds: number;
  fallbacks: number;
};

const renderReportPath = join(ROOT, "render-report.json");
const renders: RenderCut[] = existsSync(renderReportPath)
  ? (JSON.parse(readFileSync(renderReportPath, "utf8")) as RenderCut[])
  : [];

const dbOf = (value: number) => (value <= 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(value));

function load(candidate: string): Song | null {
  const path = join(ROOT, `candidate-${candidate}`, "final-song.json");
  if (!existsSync(path)) return null;
  return songSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

for (const candidate of CANDIDATES) {
  const song = load(candidate);
  console.log(`\n${"=".repeat(66)}\nCANDIDATE ${candidate.toUpperCase()}\n${"=".repeat(66)}`);
  if (!song) {
    console.log("  no final song — this candidate did not finish");
    continue;
  }

  const analysis = analyseCandidate(song);
  const issues = runValidators(song);
  const turnLog = JSON.parse(
    readFileSync(join(ROOT, `candidate-${candidate}`, "turn-log.json"), "utf8"),
  ) as { turn: number; attempt: number; result: string; stage?: string; role?: string }[];
  const blueprintReport = JSON.parse(
    readFileSync(join(ROOT, `candidate-${candidate}`, "blueprint-report.json"), "utf8"),
  ) as { attempt: number; duration: { seconds: number; withinTolerance: boolean } };

  const accepted = turnLog.filter((entry) => entry.result === "accepted");
  const rejected = turnLog.filter((entry) => entry.result === "rejected");

  console.log(
    `form            ${song.sections.length} sections, ${analysis.totalBars} bars, ` +
      `${analysis.durationSeconds.toFixed(2)}s`,
  );
  console.log(`sections        ${song.sections.map((s) => s.name).join(" / ")}`);
  console.log(`tracks          ${song.tracks.map((t) => t.id).join(", ")}`);
  console.log(
    `blueprint       accepted on attempt ${blueprintReport.attempt} · ` +
      `${blueprintReport.duration.seconds.toFixed(2)}s ` +
      `(within tolerance: ${blueprintReport.duration.withinTolerance})`,
  );
  console.log(
    `turns           ${accepted.length} accepted, ${rejected.length} rejected · ` +
      `first-attempt ${accepted.filter((e) => e.attempt === 0).length}/${accepted.length}`,
  );
  for (const entry of rejected) {
    console.log(`  rejected turn ${entry.turn} attempt ${entry.attempt} at ${entry.stage}`);
  }
  console.log(
    `validators      ${issues.filter((i) => i.severity === "error").length} error, ` +
      `${issues.filter((i) => i.severity === "warning").length} warning`,
  );
  for (const issue of issues) console.log(`  ${issue.severity} ${issue.code}: ${issue.message}`);

  console.log("\n-- grid --");
  const grids = Object.entries(analysis.grid.byResolution)
    .map(([resolution, count]) => `${resolutionLabel(Number(resolution) as Resolution)}×${count}`)
    .join("  ");
  console.log(`distribution    ${grids}`);
  console.log(
    `triplet bars    ${analysis.grid.tripletBars} · 1/32 bars ${analysis.grid.thirtySecondBars} · ` +
      `fine bars ${analysis.grid.highResolutionBars} of which ` +
      `${analysis.grid.unusedFineBars} did not need it`,
  );

  console.log("\n-- speed --");
  for (const speed of analysis.speed) {
    console.log(
      `${speed.trackId.padEnd(16)} onsets ${String(speed.onsets).padStart(3)} · ` +
        `fastest gap ${speed.fastestGapSeconds === null ? "-" : `${(speed.fastestGapSeconds * 1000).toFixed(1)}ms`} · ` +
        `longest burst ${speed.longestBurst} · bursts of 4+ ${speed.burstCount}`,
    );
  }

  console.log("\n-- guitar vocabulary --");
  console.log(`scalar runs     ${analysis.scalarRuns.length}`);
  for (const run of analysis.scalarRuns.slice(0, 6)) {
    console.log(`  ${run.trackId} bar ${run.barNumber} ${run.length} nota ${run.direction} — ${run.pitches.join(" ")}`);
  }
  const transposed = analysis.sequences.filter((s) => s.kind === "transposed");
  console.log(
    `sequences       ${analysis.sequences.length} (${transposed.length} transposed, ` +
      `${analysis.sequences.length - transposed.length} exact repeat)`,
  );
  for (const sequence of transposed.slice(0, 4)) {
    console.log(
      `  ${sequence.trackId} bars ${sequence.atBars.join("/")} cell [${sequence.cell.join(" ")}] ` +
        `transposed ${sequence.transpositions.slice(1).join("/")}`,
    );
  }
  const crossing = analysis.arpeggios.filter((a) => a.stringCrossing);
  console.log(
    `arpeggios       ${analysis.arpeggios.length} (${crossing.length} crossing strings)`,
  );
  for (const arpeggio of crossing.slice(0, 4)) {
    console.log(
      `  ${arpeggio.trackId} bar ${arpeggio.barNumber} ${arpeggio.length} nota over ` +
        `${arpeggio.stringsUsed} strings — ${arpeggio.pitches.join(" ")}`,
    );
  }
  console.log(`register shifts ${analysis.registerShifts.length}`);
  for (const shift of analysis.registerShifts.slice(0, 5)) {
    console.log(`  ${shift.trackId} bar ${shift.fromBar}->${shift.toBar} ${shift.semitones > 0 ? "+" : ""}${shift.semitones} st`);
  }

  console.log("\n-- slides --");
  if (analysis.slides.length === 0) console.log("  none");
  for (const slide of analysis.slides) {
    console.log(
      `  ${slide.trackId} ${slide.fromPitch}->${slide.toPitch} ` +
        `${slide.semitones > 0 ? "+" : ""}${slide.semitones} st (${slide.width}) · ` +
        `same string ${slide.sameString} · glide ${(slide.glideSeconds * 1000).toFixed(0)}ms · ` +
        `arrives ${slide.arrivesAtSeconds.toFixed(3)}s`,
    );
  }

  console.log("\n-- drums --");
  if (analysis.drums.length === 0) console.log("  no drum track");
  for (const report of analysis.drums) {
    console.log(
      `  ${report.sectionName.padEnd(18)} ${report.bars} bar · ${report.hits} hit · ` +
        `kick patterns ${report.distinctKickPatterns} · snare patterns ${report.distinctSnarePatterns} · ` +
        `backbeat bars ${report.backbeatBars} · fills ${report.fillBars} · toms ${report.tomHits} · ` +
        `identical repeats ${report.identicalRepeatedBars} · ` +
        `cymbals ${report.cymbalPieces.join("/") || "-"} · ` +
        `guitar copy ${(report.guitarCopyRatio * 100).toFixed(0)}%`,
    );
  }

  console.log("\n-- form relationships --");
  const rhythmTrack = song.tracks.find((track) => track.id.includes("rhythm"))?.id;
  if (rhythmTrack && song.sections.length >= 2) {
    for (let index = 1; index < song.sections.length; index += 1) {
      const previous = song.sections[index - 1];
      const current = song.sections[index];
      if (!previous || !current) continue;
      const similarity = sectionSimilarity(song, rhythmTrack, previous.id, current.id);
      if (!similarity) continue;
      console.log(
        `  ${previous.name} -> ${current.name}: onset Jaccard ` +
          `${similarity.onsetJaccard.toFixed(2)} · identical bars ${similarity.identicalBars} · ` +
          `density ×${similarity.densityRatio.toFixed(2)} · register ` +
          `${similarity.registerShiftSemitones > 0 ? "+" : ""}${similarity.registerShiftSemitones} st`,
      );
    }
  }

  console.log("\n-- tempo --");
  if (analysis.tempo.length === 0) console.log("  one tempo throughout");
  for (const step of analysis.tempo) {
    console.log(
      `  ${step.fromSection} -> ${step.toSection}: ${step.fromBpm} -> ${step.toBpm} bpm ` +
        `(${step.changePercent > 0 ? "+" : ""}${step.changePercent.toFixed(1)}%)` +
        (step.halved ? "  ** exact halving **" : ""),
    );
  }

  console.log("\n-- articulation --");
  const counts = Object.entries(analysis.articulation.counts).sort((a, b) => b[1] - a[1]);
  console.log(`  pitched notes ${analysis.articulation.pitched}`);
  console.log(`  ${counts.map(([name, count]) => `${name}×${count}`).join("  ")}`);
  console.log(
    `  expressive voices ${analysis.expression.expressiveNotes} · ` +
      `chains ${analysis.expression.chains} · fallbacks ${analysis.expression.fallbacks}`,
  );

  const soloFull = renders.find((cut) => cut.id === `candidate-${candidate}-solo`);
  const soloLead = renders.find((cut) => cut.id === `candidate-${candidate}-solo-lead`);
  const soloBacking = renders.find((cut) => cut.id === `candidate-${candidate}-solo-backing`);
  if (soloFull && soloLead && soloBacking) {
    console.log("\n-- solo mix balance --");
    console.log(
      `  lead ${dbOf(soloLead.rms).toFixed(2)} dBFS · backing ${dbOf(soloBacking.rms).toFixed(2)} dBFS · ` +
        `backing - lead ${(dbOf(soloBacking.rms) - dbOf(soloLead.rms)).toFixed(2)} dB`,
    );
    console.log(
      `  backing - full mix ${(dbOf(soloBacking.rms) - dbOf(soloFull.rms)).toFixed(2)} dB`,
    );
  }
}

console.log(`\n${"=".repeat(66)}`);
console.log("No winner is declared here. The listening decision is the user's.");

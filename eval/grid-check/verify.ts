/**
 * What the mixed-grid fixture actually does, measured (spec 5.5, 8.3, K-34).
 *
 * `npx tsx eval/grid-check/verify.ts`
 */
import { readFileSync } from "node:fs";

import { songSchema } from "@/lib/song/schema";
import { runValidators } from "@/lib/validators";
import { buildSongPlan } from "@/lib/audio/schedule";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { buildTempoMap, secondsAtTicks } from "@/lib/audio/tempo";
import { positionAtTicks } from "@/lib/audio/position";
import { buildTrackTimeline } from "@/lib/tab/timeline";
import { barWidth } from "@/components/workspace/geometry";
import { rhythmReport, usedResolutions } from "@/lib/copilot/rhythm-report";
import {
  PPQ,
  isTripletGrid,
  resolutionLabel,
  slotCount,
  ticksPerSlot,
  type Resolution,
} from "@/lib/music/timing";

const song = songSchema.parse(
  JSON.parse(readFileSync(new URL("./artifacts/song.json", import.meta.url), "utf8")),
);

const issues = runValidators(song);
const plan = buildSongPlan(song);
const expression = buildExpressionPlan(song);
const tempo = buildTempoMap(song);

console.log(
  `validators: ${issues.filter((i) => i.severity === "error").length} error, ` +
    `${issues.filter((i) => i.severity === "warning").length} warning`,
);
for (const issue of issues) console.log(`  ${issue.severity} ${issue.code}: ${issue.message}`);

console.log(
  `\nduration ${tempo.totalSeconds.toFixed(3)}s · bars ${plan.bars.length} · ` +
    `events ${plan.events.length} · expressive ${expression.expressiveNotes} · ` +
    `chains ${expression.chains.length} · fallbacks ${expression.fallbacks}`,
);

console.log("\n--- grid distribution ---");
const byGrid = new Map<number, number>();
for (const bar of plan.bars) byGrid.set(bar.resolution, (byGrid.get(bar.resolution) ?? 0) + 1);
for (const [value, count] of [...byGrid].sort((a, b) => a[0] - b[0])) {
  const resolution = value as Resolution;
  console.log(
    `  ${resolutionLabel(resolution).padEnd(14)} ${count} bar · ` +
      `${slotCount([4, 4], resolution)} slot · ` +
      `${ticksPerSlot(resolution)} tick/slot · ` +
      `${barWidth(slotCount([4, 4], resolution))}px` +
      (isTripletGrid(resolution) ? " · triplet" : ""),
  );
}

console.log("\n--- bars on the timeline ---");
for (const bar of plan.bars) {
  const bpm = tempo.segments.find((s) => s.sectionId === bar.sectionId)?.writtenBpm ?? song.bpm;
  const slotMs = (ticksPerSlot(bar.resolution) * 60 * 1000) / (bpm * PPQ);
  console.log(
    `  bar ${String(bar.barNumber).padStart(2)} ${bar.sectionId} ` +
      `${resolutionLabel(bar.resolution as Resolution).padEnd(14)} ` +
      `start ${secondsAtTicks(tempo, bar.time).toFixed(3)}s @${bpm}bpm · ` +
      `slot ${slotMs.toFixed(1)}ms`,
  );
}

console.log("\n--- every onset lands on a whole tick ---");
const offGrid = plan.events.filter((event) => !Number.isInteger(event.time));
console.log(`  off-grid events: ${offGrid.length}`);

console.log("\n--- ties that cross a grid change ---");
for (const trackId of ["gtr", "lead"]) {
  const timeline = buildTrackTimeline(song, trackId);
  if (timeline.kind !== "fretted") continue;
  timeline.bars.forEach((bar, index) => {
    const next = timeline.bars[index + 1];
    if (!next || bar.resolution === next.resolution) return;
    const carried = bar.spans.filter((span) => span.openEnd && !span.openStart);
    for (const span of carried) {
      const onsetTick =
        (plan.bars[index]?.time ?? 0) + span.startSlot * ticksPerSlot(bar.resolution);
      const event = plan.events.find(
        (entry) =>
          entry.kind === "note" &&
          entry.trackId === trackId &&
          entry.pitch === span.pitch &&
          entry.time === onsetTick,
      );
      console.log(
        `  ${trackId} bar ${bar.barNumber} (${resolutionLabel(bar.resolution as Resolution)}) ` +
          `-> bar ${next.barNumber} (${resolutionLabel(next.resolution as Resolution)}): ` +
          `${span.pitch} sounds ${event && event.kind === "note" ? event.durationTicks : "?"} ticks`,
      );
    }
  });
}

console.log("\n--- legato and slide ---");
for (const chain of expression.chains) {
  for (const transition of chain.transitions) {
    console.log(
      `  ${transition.kind.padEnd(10)} ${transition.fromPitch} -> ${transition.toPitch} ` +
        `starts ${transition.atSeconds.toFixed(4)}s arrives ${transition.arrivesAtSeconds.toFixed(4)}s`,
    );
  }
}

console.log("\n--- playhead reads back the slot it was written on ---");
let mismatches = 0;
for (const bar of plan.bars) {
  const step = ticksPerSlot(bar.resolution);
  for (let slot = 0; slot < bar.slotCount; slot += 1) {
    const at = positionAtTicks(plan, bar.time + slot * step);
    if (at.barKey !== bar.barKey || at.slotIndex !== slot) mismatches += 1;
  }
}
console.log(`  slots checked: ${plan.bars.reduce((n, b) => n + b.slotCount, 0)}, mismatches: ${mismatches}`);

console.log("\n--- rhythmic vocabulary (reporting only, never a score) ---");
const report = rhythmReport(song);
console.log(
  `  grids ${usedResolutions(report.grid).map((r) => resolutionLabel(r)).join(", ")} · ` +
    `triplet bars ${report.grid.tripletBars} · 1/32 bars ${report.grid.thirtySecondBars} · ` +
    `fine bars that did not need it ${report.grid.unusedFineBars}/${report.grid.highResolutionBars}`,
);
for (const speed of report.speed) {
  console.log(
    `  ${speed.trackId.padEnd(6)} onsets ${String(speed.onsets).padStart(3)} · ` +
      `fastest gap ${speed.fastestGapSeconds === null ? "-" : `${(speed.fastestGapSeconds * 1000).toFixed(1)}ms`} ` +
      `(${speed.fastestOnsetsPerSecond === null ? "-" : speed.fastestOnsetsPerSecond.toFixed(1)}/s) · ` +
      `longest burst ${speed.longestBurst} · bursts of 4+ ${speed.burstCount}`,
  );
}
for (const run of report.scalarRuns) {
  console.log(
    `  scalar-run candidate: ${run.trackId} bar ${run.barNumber} slot ${run.startSlot + 1} ` +
      `${run.length} nota ${run.direction} — ${run.pitches.join(" ")}`,
  );
}

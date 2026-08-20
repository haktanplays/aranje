import { readFileSync } from "node:fs";
import { songSchema } from "@/lib/song/schema";
import { runValidators } from "@/lib/validators";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { buildTrackTimeline } from "@/lib/tab/timeline";
import { buildTempoMap } from "@/lib/audio/tempo";
import { buildSongPlan } from "@/lib/audio/schedule";

const song = songSchema.parse(JSON.parse(readFileSync("./artifacts/final-song.json","utf8")));
const issues = runValidators(song);
const plan = buildExpressionPlan(song);
const tempo = buildTempoMap(song);
const songPlan = buildSongPlan(song);

console.log(`validators: ${issues.filter(i=>i.severity==="error").length} error, ${issues.filter(i=>i.severity==="warning").length} warning`);
for (const i of issues) console.log(`  ${i.severity} ${i.code}: ${i.message}`);
console.log(`fallbacks: ${plan.fallbacks}  chains: ${plan.chains.length}  expressive: ${plan.expressiveNotes}`);
console.log(`duration: ${tempo.totalSeconds.toFixed(3)}s  bars: ${songPlan.bars.length}  events: ${songPlan.events.length}`);
console.log("sections:", tempo.segments.map(s=>`${s.sectionId} ${s.writtenBpm}bpm @${s.startSeconds.toFixed(2)}s`).join(" | "));

// Slur placement: did the constraint hold?
console.log("\n--- slur pairs, after placement ---");
for (const trackId of ["rhythm_guitar","lead_guitar"]) {
  const t = buildTrackTimeline(song, trackId);
  if (t.kind !== "fretted") continue;
  for (const bar of t.bars) {
    if (bar.silent) continue;
    for (const s of bar.spans) {
      if (s.openStart) continue;
      if (!["slide","hammer_on","pull_off"].includes(s.articulation ?? "")) continue;
      const prev = bar.spans.filter(o=>!o.openStart && o.startSlot < s.startSlot).pop();
      console.log(`  ${trackId} bar${bar.barNumber} slot${s.startSlot} ${s.pitch} ${s.articulation} str${s.stringIndex}f${s.fret}` +
        (prev ? `  <- ${prev.pitch} str${prev.stringIndex}f${prev.fret} ${prev.stringIndex===s.stringIndex?"SAME":"** DIFFERENT **"}` : ""));
    }
  }
}

// Outro isolation
const outro = song.sections[song.sections.length-1];
const keys = new Set(outro?.bars.flatMap(b=>Object.keys(b.slots)) ?? []);
console.log("\noutro track keys:", [...keys]);
console.log("bass track present:", song.tracks.some(t=>t.instrumentId.includes("bass")));

// Per-section onset density
console.log("\n--- density (onsets per second of section) ---");
for (const section of song.sections) {
  const seg = tempo.segments.find(s=>s.sectionId===section.id)!;
  const secs = (seg.endTicks-seg.startTicks)*seg.secondsPerTick;
  const counts: Record<string,number> = {};
  for (const bar of section.bars) for (const [tid,slots] of Object.entries(bar.slots)) {
    for (const slot of slots) {
      if (slot === null || slot === "-") continue;
      counts[tid] = (counts[tid] ?? 0) + (Array.isArray(slot) ? slot.length : slot.notes.length);
    }
  }
  console.log(`  ${section.id} "${section.name}" ${secs.toFixed(2)}s ` +
    Object.entries(counts).map(([k,v])=>`${k}=${v} (${(v/secs).toFixed(2)}/s)`).join(" "));
}

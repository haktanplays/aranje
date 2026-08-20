/**
 * Where each technique ended up, and whether it will actually be played.
 *
 * "Valid" here means the context the note needs really holds after Ergonomic
 * Placement — which is not the same question as "the model wrote the word".
 * A slur whose two notes landed on different strings is reported as a
 * fallback, because that is what the listener gets.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { songSchema, type Song } from "@/lib/song/schema";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { legatoDecision } from "@/lib/audio/legato-chain";
import { trackLegatoOnsets } from "@/lib/music/legato";
import { buildTempoMap } from "@/lib/audio/tempo";
import { buildTrackTimeline } from "@/lib/tab/timeline";
import { isDrumInstrument } from "@/lib/instruments/registry";

const HERE = new URL(".", import.meta.url).pathname;
const song: Song = songSchema.parse(
  JSON.parse(readFileSync(join(HERE, "artifacts/final-song.json"), "utf8")),
);

const TECHNIQUES = [
  "palm_mute", "accent", "staccato", "sustain", "vibrato",
  "bend_half", "bend_full", "slide", "hammer_on", "pull_off",
] as const;

type Row = {
  technique: string; track: string; section: string;
  bar: number; slot: number; pitch: string;
  valid: boolean; fallback: string;
};

const rows: Row[] = [];

for (const track of song.tracks) {
  if (isDrumInstrument(track.instrumentId)) continue;
  const timeline = buildTrackTimeline(song, track.id);
  if (timeline.kind !== "fretted") continue;
  const plan = buildExpressionPlan(song);

  for (const bar of timeline.bars) {
    if (bar.silent) continue;
    for (const span of bar.spans) {
      if (span.openStart || !span.articulation) continue;
      if (!(TECHNIQUES as readonly string[]).includes(span.articulation)) continue;

      const note = plan.notes.find(
        (n) =>
          n.trackId === track.id &&
          n.barKey === bar.key &&
          n.slotIndex === span.startSlot &&
          n.pitch === span.pitch,
      );

      // Ask the decision helper rather than reading `fallbackReason`. A note
      // that is refused as a slur target and then becomes the source of the
      // next chain keeps its chain role and loses its refusal on the way into
      // the plan, so the plan alone under-reports fallbacks.
      const onsets = trackLegatoOnsets(song, track.id);
      const index = onsets.findIndex(
        (o) =>
          o.barKey === bar.key &&
          o.slotIndex === span.startSlot &&
          o.pitch === span.pitch,
      );
      const decision =
        index >= 0
          ? legatoDecision(onsets, index, {
              tempo: buildTempoMap(song),
              timeScale: 1,
            })
          : null;

      const refused = decision?.kind === "refused" ? decision.reason : null;
      rows.push({
        technique: span.articulation,
        track: track.name,
        section: bar.sectionName,
        bar: bar.barNumber,
        slot: span.startSlot + 1,
        pitch: span.pitch,
        valid: refused === null && note?.fallbackReason === undefined,
        fallback: refused ?? note?.fallbackReason ?? "-",
      });
    }
  }
}

rows.sort((a, b) => a.bar - b.bar || a.slot - b.slot);

console.log(
  "| Teknik | Track | Bölüm | Bar | Slot | Nota | Bağlam geçerli | Fallback |",
);
console.log("|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  console.log(
    `| ${r.technique} | ${r.track} | ${r.section} | ${r.bar} | ${r.slot} | ` +
      `${r.pitch} | ${r.valid ? "evet" : "**hayır**"} | ${r.fallback} |`,
  );
}

console.log("\n--- per technique ---");
for (const technique of TECHNIQUES) {
  const hits = rows.filter((r) => r.technique === technique);
  const bad = hits.filter((r) => !r.valid).length;
  console.log(
    `${technique.padEnd(11)} ${String(hits.length).padStart(2)} kez` +
      (bad > 0 ? `, ${bad} fallback` : "") +
      (hits.length === 0 ? "  <-- YOK" : ""),
  );
}

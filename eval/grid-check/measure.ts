/**
 * What the finer grids cost, in tokens and in time (spec 11.3, 11.5, K-34).
 *
 * Nothing here is a ceiling change. The point is to find out whether the
 * ceilings that already exist still hold with a 1/32 patch in play, and to
 * say so with numbers rather than with confidence.
 *
 * `npx tsx eval/grid-check/measure.ts`
 */
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { DEFAULT_MAX_INPUT_TOKENS, DEFAULT_MAX_OUTPUT_TOKENS } from "@/lib/config/copilot";
import { estimateTokens } from "@/lib/copilot/tokens";
import { buildPrompt } from "@/lib/copilot/prompt";
import { buildArrangementContext } from "@/lib/copilot/arrangement-context";
import { buildTrackTimeline } from "@/lib/tab/timeline";
import { buildSongPlan } from "@/lib/audio/schedule";
import { buildExpressionPlan } from "@/lib/audio/expression-plan";
import { songSchema, type Bar, type Song } from "@/lib/song/schema";
import { slotCount, resolutionLabel, type Resolution } from "@/lib/music/timing";
import { ARRANGE_SKILLS, type CopilotRequest } from "@/lib/copilot/contract";
import { STYLE_CARD_IDS } from "@/lib/copilot/style-cards";
import { readStyleCards } from "@/lib/copilot/style-cards.server";

const fixture = songSchema.parse(
  JSON.parse(readFileSync(new URL("./artifacts/song.json", import.meta.url), "utf8")),
);

/** A section of `bars` bars, all on one grid, densely written. */
function sectionOn(
  grids: readonly Resolution[],
  id: string,
  fill: "dense" | "sparse",
): Song["sections"][number] {
  const bars: Bar[] = grids.map((resolution) => {
    const count = slotCount([4, 4], resolution);
    const every = fill === "dense" ? 1 : 4;
    return {
      timeSignature: [4, 4],
      resolution,
      slots: {
        gtr: Array.from({ length: count }, (_, index) =>
          index % every === 0
            ? ({
                notes: [{ pitch: "D2", velocity: 100, articulation: "palm_mute" }],
              } as never)
            : null,
        ),
        drums: Array.from({ length: count }, (_, index) =>
          index % every === 0 ? [{ piece: "kick" as const }] : [],
        ),
      },
    } as Bar;
  });
  return { id, name: id, status: "fixed", bars };
}

function songWith(section: Song["sections"][number]): Song {
  return songSchema.parse({
    ...fixture,
    tracks: fixture.tracks.filter((track) => track.id !== "lead"),
    sections: [section],
  });
}

function request(song: Song, sectionId: string): CopilotRequest {
  return {
    operation: "arrange_track",
    skill: "drums",
    sectionId,
    targetTrackId: "drums",
    lockedTrackIds: song.tracks.map((t) => t.id).filter((id) => id !== "drums"),
    subjectId: "measure",
    idempotencyKey: "measure-0001",
    instruction: "Bolume oturan bir davul partisi yaz.",
    song,
  };
}

/** What the model would have to write back for this section, as JSON. */
function answerBytes(section: Song["sections"][number]): number {
  const bars = section.bars.map((bar, barIndex) => ({
    barIndex,
    slots: Array.from(
      { length: slotCount(bar.timeSignature, bar.resolution) },
      (_, index) => (index % 2 === 0 ? [{ piece: "kick" }] : []),
    ),
  }));
  return JSON.stringify({
    operation: "arrange_track",
    sectionId: section.id,
    targetTrackId: "drums",
    bars,
    explanation: "Sekiz barlik davul.",
  }).length;
}

const CASES: { label: string; grids: Resolution[]; fill: "dense" | "sparse" }[] = [
  { label: "8 bar x 1/16", grids: Array.from({ length: 8 }, () => 16), fill: "dense" },
  { label: "8 bar x 1/16 ucleme", grids: Array.from({ length: 8 }, () => 24), fill: "dense" },
  { label: "8 bar x 1/32", grids: Array.from({ length: 8 }, () => 32), fill: "dense" },
  {
    label: "realistic mixed",
    grids: [16, 16, 24, 16, 16, 32, 16, 16],
    fill: "sparse",
  },
];

console.log("=== prompt and answer size, per section ===");
console.log(
  `input ceiling ${DEFAULT_MAX_INPUT_TOKENS}, output ceiling ${DEFAULT_MAX_OUTPUT_TOKENS}\n`,
);
for (const testCase of CASES) {
  const section = sectionOn(testCase.grids, "sec-1", testCase.fill);
  const song = songWith(section);
  const built = buildPrompt({ request: request(song, "sec-1") });
  const answer = answerBytes(section);
  const outputTokens = estimateTokens(JSON.stringify({ x: 0 }).repeat(0) + "x".repeat(answer));
  const slots = section.bars.reduce(
    (total, bar) => total + slotCount(bar.timeSignature, bar.resolution),
    0,
  );
  console.log(
    `${testCase.label.padEnd(22)} slots ${String(slots).padStart(4)} · ` +
      `input ~${String(built.estimatedInputTokens).padStart(5)} / ${DEFAULT_MAX_INPUT_TOKENS}` +
      ` (${((built.estimatedInputTokens / DEFAULT_MAX_INPUT_TOKENS) * 100).toFixed(0)}%)` +
      ` · answer ${String(answer).padStart(6)} B ~${String(outputTokens).padStart(5)} tok / ` +
      `${DEFAULT_MAX_OUTPUT_TOKENS} (${((outputTokens / DEFAULT_MAX_OUTPUT_TOKENS) * 100).toFixed(0)}%)` +
      (outputTokens > DEFAULT_MAX_OUTPUT_TOKENS ? "  ** OVER **" : ""),
  );
}

console.log("\n=== the whole-piece context a turn is given ===");
for (const totalBars of [8, 16, 32]) {
  const grids: Resolution[] = Array.from({ length: 8 }, () => 16);
  const sections = Array.from({ length: Math.ceil(totalBars / 8) }, (_, index) =>
    sectionOn(grids, `sec-${index + 1}`, "sparse"),
  );
  const song = songSchema.parse({
    ...fixture,
    tracks: fixture.tracks.filter((track) => track.id !== "lead"),
    sections,
  });
  const context = buildArrangementContext(song, "sec-1", "drums", "drums");
  const built = buildPrompt({ request: request(song, "sec-1") });
  console.log(
    `${String(sections.length * 8).padStart(2)} bar song · form lines ${context?.form.length ?? 0} · ` +
      `input ~${built.estimatedInputTokens} / ${DEFAULT_MAX_INPUT_TOKENS}`,
  );
}

console.log("\n=== how long the pure work takes ===");
const timed = (label: string, run: () => unknown, runs = 20) => {
  run();
  const started = performance.now();
  for (let index = 0; index < runs; index += 1) run();
  const each = (performance.now() - started) / runs;
  console.log(`  ${label.padEnd(38)} ${each.toFixed(2)} ms`);
};

const dense32 = songWith(sectionOn(Array.from({ length: 8 }, () => 32), "sec-1", "dense"));
const dense16 = songWith(sectionOn(Array.from({ length: 8 }, () => 16), "sec-1", "dense"));

timed("buildTrackTimeline, 8 bar x 1/16", () => buildTrackTimeline(dense16, "gtr"));
timed("buildTrackTimeline, 8 bar x 1/32", () => buildTrackTimeline(dense32, "gtr"));
timed("buildSongPlan, 8 bar x 1/32", () => buildSongPlan(dense32));
timed("buildExpressionPlan, 8 bar x 1/32", () => buildExpressionPlan(dense32));
timed("buildTrackTimeline, mixed fixture", () => buildTrackTimeline(fixture, "gtr"));

console.log("\n=== scheduler events and DOM nodes ===");
for (const [label, song] of [
  ["8 bar x 1/16 dense", dense16],
  ["8 bar x 1/32 dense", dense32],
  ["mixed fixture", fixture],
] as const) {
  const plan = buildSongPlan(song);
  const slots = plan.bars.reduce((total, bar) => total + bar.slotCount, 0);
  const strings = song.tracks.find((t) => t.id === "gtr")?.fretboard?.tuning.length ?? 6;
  // One cell per string per slot in edit mode, which is the worst case.
  console.log(
    `  ${label.padEnd(20)} events ${String(plan.events.length).padStart(4)} · ` +
      `slots ${String(slots).padStart(4)} · edit cells ${slots * strings}`,
  );
}

console.log("\n=== grids in the fixture ===");
const grids = new Map<number, number>();
for (const bar of buildSongPlan(fixture).bars) {
  grids.set(bar.resolution, (grids.get(bar.resolution) ?? 0) + 1);
}
for (const [resolution, count] of [...grids].sort((a, b) => a[0] - b[0])) {
  console.log(`  ${resolutionLabel(resolution as Resolution).padEnd(14)} ${count} bar`);
}

console.log("\n=== worst case input, every role and card, on the finest grid ===");
{
  const cards = readStyleCards();

  // Four sections of eight bars, all on 1/32, densely written: the largest
  // song the contract allows on the finest grid it allows.
  const sections = Array.from({ length: 4 }, (_, index) =>
    sectionOn(Array.from({ length: 8 }, () => 32 as Resolution), `sec-${index + 1}`, "dense"),
  );
  const song = songSchema.parse({
    ...fixture,
    tracks: fixture.tracks.filter((track) => track.id !== "lead"),
    sections,
  });

  let worst = 0;
  let worstLabel = "";
  for (const role of ARRANGE_SKILLS) {
    for (const cardId of [null, ...STYLE_CARD_IDS]) {
      const card = cardId ? cards[cardId] : undefined;
      const built = buildPrompt({
        request: {
          ...request(song, "sec-1"),
          skill: role,
          targetTrackId: role === "drums" ? "drums" : "gtr",
          instruction: "x".repeat(2000),
        },
        ...(card ? { styleCard: card } : {}),
      });
      if (built.estimatedInputTokens > worst) {
        worst = built.estimatedInputTokens;
        worstLabel = `${role} + ${cardId ?? "no card"}`;
      }
    }
  }
  console.log(
    `  worst ~${worst} / ${DEFAULT_MAX_INPUT_TOKENS} ` +
      `(${((worst / DEFAULT_MAX_INPUT_TOKENS) * 100).toFixed(0)}%) — ${worstLabel}`,
  );
}

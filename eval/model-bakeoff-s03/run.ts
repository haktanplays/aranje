/**
 * Bake-off driver. `npx tsx eval/model-bakeoff-s03/run.ts <A|B>`
 *
 * Stateful on purpose. Each run advances as far as it can and then stops,
 * having written the next payload to disk and said what it is waiting for.
 * The coding agent's only job between two runs is to hand that payload to the
 * candidate's model and write the answer back **byte for byte**. It does not
 * read the answer for content, does not repair it, and does not choose it.
 *
 * A rejected answer gets a correction round, capped at two, built from the
 * production validators' own messages. If a turn is still not accepted after
 * the third attempt the run stops and the turn is a failure. There is no
 * fourth attempt and no manual patch.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { compositionBlueprintSchema } from "@/lib/copilot/blueprint";
import { gridUsage, checkGridPlan } from "@/lib/copilot/grid-plan";
import {
  checkBlueprintDuration,
  materializeSongSkeleton,
} from "@/lib/copilot/materialize";
import { runValidators } from "@/lib/validators";
import { instructionFor, payloadFor, runTurn, type CandidateId, type TurnSpec } from "./harness";
import { blueprintPayload } from "./blueprint-prompt";
import { RAW_REQUEST, SECOND_ROUND_FEEDBACK, GUITAR_VOCABULARY_FEEDBACK } from "./request";
import type { Song } from "@/lib/song/schema";

const HERE = new URL(".", import.meta.url).pathname;
const candidate = (process.argv[2] ?? "").toUpperCase() as CandidateId;
if (candidate !== "A" && candidate !== "B") {
  console.error("usage: run.ts <A|B>");
  process.exit(1);
}

const DIR = join(HERE, "artifacts", `candidate-${candidate.toLowerCase()}`);
mkdirSync(DIR, { recursive: true });
const write = (name: string, body: string) => writeFileSync(join(DIR, name), body);
const path = (name: string) => join(DIR, name);

/** The musician's own words, kept once per candidate, unaltered. */
write(
  "raw-request.json",
  JSON.stringify(
    {
      note: "Verbatim user data. Artist names live here and nowhere else.",
      turnOne: RAW_REQUEST,
      turnTwoFeedback: SECOND_ROUND_FEEDBACK,
      turnTwoGuitarVocabulary: GUITAR_VOCABULARY_FEEDBACK,
    },
    null,
    2,
  ),
);

const MAX_ATTEMPT = 2; // attempts 0, 1, 2 — two corrections

/**
 * Say a materialiser failure in the model's own vocabulary (run 1 finding).
 *
 * The materialiser copies blueprint fields into a Song and validates the
 * Song, so its errors carry *Song* paths. In run 1 a candidate was told
 * `path: ["key"], pattern /^[A-G](#|b)? (minor|major)$/` — and the contract
 * it had been given has no `key` at the root at all. It could not map the
 * correction onto anything it controlled and returned the same document
 * unchanged. A correction naming a field the answerer cannot see is not a
 * correction; it is noise with a rejection attached.
 */
const SONG_FIELD_TO_BLUEPRINT: Readonly<Record<string, string>> = {
  key: "tonalCenter",
  bpm: "sections[].bpm",
  title: "(sunucu belirler; senin alanin degil)",
  tracks: "tracks[]",
  sections: "sections[]",
};

function asBlueprintCorrection(reason: string): string[] {
  const lines: string[] = [];
  const parsed = reason.match(/\[[\s\S]*\]/);
  if (parsed) {
    try {
      const issues = JSON.parse(parsed[0]) as {
        path?: string[];
        message?: string;
        pattern?: string;
      }[];
      for (const issue of issues) {
        const songField = issue.path?.[0] ?? "";
        const blueprintField = SONG_FIELD_TO_BLUEPRINT[songField] ?? songField;
        lines.push(
          `${blueprintField}: ${issue.message ?? "gecersiz"}` +
            (issue.pattern ? ` (beklenen bicim: ${issue.pattern})` : ""),
        );
      }
    } catch {
      // Fall through to the raw reason below.
    }
  }
  if (lines.length === 0) lines.push(`Iskelet kurulamadi: ${reason}`);
  return lines;
}

function waitFor(what: string, payloadName: string, payload: unknown): never {
  write(payloadName, JSON.stringify(payload, null, 2));
  console.log(`\nWAITING ${what}`);
  console.log(`payload: ${path(payloadName)}`);
  process.exit(0);
}

// ---------------------------------------------------------------- blueprint
let blueprintRaw: string | null = null;
let blueprintAttempt = 0;
const blueprintCorrections: string[] = [];

for (let attempt = 0; attempt <= MAX_ATTEMPT; attempt += 1) {
  const answer = path(`blueprint-attempt-${attempt}-response.json`);
  if (!existsSync(answer)) {
    if (attempt === 0 || blueprintCorrections.length > 0) {
      waitFor(
        `blueprint attempt ${attempt}`,
        `blueprint-attempt-${attempt}-payload.json`,
        blueprintPayload(attempt === 0 ? undefined : blueprintCorrections),
      );
    }
    break;
  }
  blueprintAttempt = attempt;
  blueprintRaw = readFileSync(answer, "utf8");

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(blueprintRaw);
  } catch (error) {
    blueprintCorrections.length = 0;
    blueprintCorrections.push(
      `Cikti gecerli JSON degildi: ${(error as Error).message}. Yalnizca JSON uret.`,
    );
    console.log(`blueprint attempt ${attempt}: REJECTED (not JSON)`);
    blueprintRaw = null;
    continue;
  }

  const parsed = compositionBlueprintSchema.safeParse(parsedJson);
  if (!parsed.success) {
    blueprintCorrections.length = 0;
    blueprintCorrections.push(
      ...parsed.error.issues
        .slice(0, 12)
        .map((issue) => `${issue.path.join(".") || "(kok)"}: ${issue.message}`),
    );
    console.log(`blueprint attempt ${attempt}: REJECTED at schema`);
    for (const line of blueprintCorrections) console.log(`    ${line}`);
    blueprintRaw = null;
    continue;
  }

  const gridProblems = checkGridPlan(parsed.data);
  if (gridProblems.length > 0) {
    blueprintCorrections.length = 0;
    blueprintCorrections.push(
      ...gridProblems.map((problem) => `${problem.sectionKey}: ${problem.message}`),
    );
    console.log(`blueprint attempt ${attempt}: REJECTED at grid plan`);
    for (const line of blueprintCorrections) console.log(`    ${line}`);
    blueprintRaw = null;
    continue;
  }

  const built = materializeSongSkeleton(parsed.data, { title: `Bake-off ${candidate}` });
  if (!built.ok) {
    blueprintCorrections.length = 0;
    blueprintCorrections.push(...asBlueprintCorrection(built.reason));
    console.log(`blueprint attempt ${attempt}: REJECTED at materialise`);
    for (const line of blueprintCorrections) console.log(`    ${line}`);
    blueprintRaw = null;
    continue;
  }

  const duration = checkBlueprintDuration(parsed.data);
  write("blueprint.json", JSON.stringify(parsed.data, null, 2));
  write("skeleton.json", JSON.stringify(built.song, null, 2));
  write(
    "blueprint-report.json",
    JSON.stringify(
      {
        attempt,
        duration,
        gridUsage: gridUsage(parsed.data),
        sectionIdByKey: Object.fromEntries(built.sectionIdByKey),
        trackIdByRole: Object.fromEntries(built.trackIdByRole),
      },
      null,
      2,
    ),
  );
  console.log(
    `blueprint attempt ${attempt}: ACCEPTED — ${duration.seconds.toFixed(2)}s ` +
      `(hedef ${duration.target}+-${duration.tolerance}, within=${duration.withinTolerance})`,
  );
  break;
}

if (!existsSync(path("blueprint.json"))) {
  console.log("\nblueprint not accepted yet.");
  process.exit(0);
}

const blueprint = compositionBlueprintSchema.parse(
  JSON.parse(readFileSync(path("blueprint.json"), "utf8")),
);
const built = materializeSongSkeleton(blueprint, { title: `Bake-off ${candidate}` });
if (!built.ok) throw new Error(built.reason);
void blueprintAttempt;

// ------------------------------------------------------------------- turns
/**
 * One turn per (section, active role), in playing order.
 *
 * The list is the blueprint's own: the model decided which roles play where,
 * and the harness only walks it.
 */
const TURNS: TurnSpec[] = [];
for (const section of blueprint.sections) {
  const sectionId = built.sectionIdByKey.get(section.key);
  if (!sectionId) continue;
  for (const role of section.activeRoles) {
    const targetTrackId = built.trackIdByRole.get(role);
    if (!targetTrackId) continue;
    TURNS.push({
      index: TURNS.length + 1,
      label: `${section.displayName} / ${role}`,
      sectionId,
      targetTrackId,
      role,
      instruction: instructionFor(blueprint, section.key, role),
    });
  }
}
write("turns.json", JSON.stringify(TURNS, null, 2));

let song: Song = built.song;
const log: unknown[] = [];

for (const turn of TURNS) {
  const corrections: string[][] = [];
  let accepted = false;

  for (let attempt = 0; attempt <= MAX_ATTEMPT && !accepted; attempt += 1) {
    const stem = `turn-${turn.index}-attempt-${attempt}`;
    const answerPath = path(`${stem}-response.json`);
    const previous = attempt === 0 ? undefined : corrections[attempt - 1];

    if (!existsSync(answerPath)) {
      write("state.json", JSON.stringify(song, null, 2));
      write("turn-log.json", JSON.stringify(log, null, 2));
      waitFor(
        `turn ${turn.index} (${turn.label}) attempt ${attempt}`,
        `${stem}-payload.json`,
        {
          turn: turn.index,
          label: turn.label,
          role: turn.role,
          ...payloadFor(song, turn, candidate, previous),
        },
      );
    }

    const raw = readFileSync(answerPath, "utf8");
    const outcome = runTurn(song, turn, candidate, raw);

    if (outcome.ok) {
      song = outcome.song;
      accepted = true;
      log.push({
        turn: turn.index,
        label: turn.label,
        role: turn.role,
        attempt,
        result: "accepted",
        patchId: outcome.patchId,
        touchedBars: outcome.touchedBars,
        explanation: outcome.explanation,
        warnings: outcome.warnings.map((w) => ({ code: w.code, message: w.message })),
      });
      console.log(
        `turn ${turn.index} (${turn.label}) attempt ${attempt}: ACCEPTED, ` +
          `${outcome.warnings.length} warning`,
      );
      for (const w of outcome.warnings) console.log(`    warning ${w.code}: ${w.message}`);
    } else {
      corrections.push(outcome.corrections);
      log.push({
        turn: turn.index,
        label: turn.label,
        role: turn.role,
        attempt,
        result: "rejected",
        stage: outcome.stage,
        diagnostic: outcome.diagnostic,
      });
      console.log(
        `turn ${turn.index} (${turn.label}) attempt ${attempt}: REJECTED at ` +
          `${outcome.stage} — ${outcome.diagnostic}`,
      );
    }
  }

  if (!accepted) {
    console.error(
      `turn ${turn.index} exhausted its two correction rounds — this turn is a failure`,
    );
    write("final-song.json", JSON.stringify(song, null, 2));
    write("turn-log.json", JSON.stringify(log, null, 2));
    process.exit(1);
  }
}

write("final-song.json", JSON.stringify(song, null, 2));
write("turn-log.json", JSON.stringify(log, null, 2));

const issues = runValidators(song);
console.log(
  `\nfinal: ${issues.filter((i) => i.severity === "error").length} error, ` +
    `${issues.filter((i) => i.severity === "warning").length} warning`,
);
for (const issue of issues) console.log(`  ${issue.severity} ${issue.code}: ${issue.message}`);

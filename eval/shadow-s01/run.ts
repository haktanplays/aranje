/**
 * Eval driver. Reads the answers that have been recorded for each turn, runs
 * the production chain over them in order, and writes the artifacts.
 *
 * Run with:  npx tsx eval/shadow-s01/run.ts [--prompt N]
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { runValidators } from "@/lib/validators";
import { SEED_SONG } from "./seed";
import { TURNS } from "./turns";
import { promptFor, runTurn } from "./harness";
import type { Song } from "@/lib/song/schema";

const HERE = new URL(".", import.meta.url).pathname;
const ARTIFACTS = join(HERE, "artifacts");
mkdirSync(ARTIFACTS, { recursive: true });

const write = (name: string, body: string) =>
  writeFileSync(join(ARTIFACTS, name), body);

const seedIssues = runValidators(SEED_SONG);
console.log(
  `seed: ${seedIssues.filter((i) => i.severity === "error").length} error, ` +
    `${seedIssues.filter((i) => i.severity === "warning").length} warning`,
);
for (const issue of seedIssues) console.log(`  ${issue.severity} ${issue.code}: ${issue.message}`);

const only = process.argv.includes("--prompt")
  ? Number(process.argv[process.argv.indexOf("--prompt") + 1])
  : null;

let song: Song = SEED_SONG;
const log: unknown[] = [];

for (const turn of TURNS) {
  const attempts: { corrections: string[] }[] = [];
  let accepted = false;

  // Attempt 0 is the first ask; 1 and 2 are the two correction rounds phase 2
  // allows. There is no fourth.
  for (let attempt = 0; attempt <= 2 && !accepted; attempt += 1) {
    const corrections = attempt === 0 ? undefined : attempts[attempt - 1]?.corrections;
    const prompt = promptFor(song, turn, corrections);
    const stem = `turn-${turn.index}-attempt-${attempt}`;

    write(
      `${stem}-prompt.json`,
      JSON.stringify(
        {
          turn: turn.index,
          label: turn.label,
          skill: turn.skill,
          sectionId: turn.sectionId,
          targetTrackId: turn.targetTrackId,
          estimatedInputTokens: prompt.estimatedInputTokens,
          systemPrompt: prompt.system,
          userMessage: prompt.userMessage,
        },
        null,
        2,
      ),
    );

    if (only !== null && turn.index === only) {
      console.log(`\n=== turn ${turn.index} attempt ${attempt} prompt written ===`);
      process.exit(0);
    }

    const answerPath = join(ARTIFACTS, `${stem}-response.json`);
    if (!existsSync(answerPath)) {
      console.log(`\nturn ${turn.index} attempt ${attempt}: awaiting ${stem}-response.json`);
      writeFileSync(join(ARTIFACTS, "state.json"), JSON.stringify(song, null, 2));
      writeFileSync(join(ARTIFACTS, "turn-log.json"), JSON.stringify(log, null, 2));
      process.exit(0);
    }

    const raw = readFileSync(answerPath, "utf8");
    const outcome = runTurn(song, turn, raw);

    // Production accepts a candidate that carries warnings — they inform, they
    // do not block, and a musician decides what to do about them. This eval's
    // bar is stricter: an articulation whose context does not hold is a note
    // that will not be played as written, and the acceptance list asks for
    // none of those. So a warning is sent back as a correction, exactly as a
    // musician re-asking would, and only while correction rounds remain.
    // Only this turn's own surface counts. The validators judge the whole song,
    // so a warning left behind by an earlier track would otherwise be sent back
    // to whichever turn happened to run next — which cannot fix it and did not
    // cause it.
    const contextWarnings = outcome.ok
      ? outcome.warnings.filter(
          (w) =>
            w.code === "articulationContext" &&
            w.trackId === turn.targetTrackId &&
            w.sectionId === turn.sectionId,
        )
      : [];

    if (outcome.ok && contextWarnings.length > 0 && attempt < 2) {
      attempts.push({
        corrections: contextWarnings.map(
          (w) => `${w.message} Ayni telde kalacak bir nota cifti sec.`,
        ),
      });
      log.push({
        turn: turn.index,
        label: turn.label,
        attempt,
        result: "rejected",
        stage: "articulationWarning",
        diagnostic: contextWarnings.map((w) => w.message).join(" | "),
      });
      console.log(
        `turn ${turn.index} (${turn.label}) attempt ${attempt}: SENT BACK — ` +
          `${contextWarnings.length} articulation warning`,
      );
      for (const w of contextWarnings) console.log(`    ${w.message}`);
      continue;
    }

    if (outcome.ok) {
      song = outcome.song;
      accepted = true;
      log.push({
        turn: turn.index,
        label: turn.label,
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
      attempts.push({ corrections: outcome.corrections });
      log.push({
        turn: turn.index,
        label: turn.label,
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
    console.error(`turn ${turn.index} exhausted its two correction rounds`);
    break;
  }
}

writeFileSync(join(ARTIFACTS, "final-song.json"), JSON.stringify(song, null, 2));
writeFileSync(join(ARTIFACTS, "turn-log.json"), JSON.stringify(log, null, 2));

const finalIssues = runValidators(song);
console.log(
  `\nfinal: ${finalIssues.filter((i) => i.severity === "error").length} error, ` +
    `${finalIssues.filter((i) => i.severity === "warning").length} warning`,
);
for (const issue of finalIssues) console.log(`  ${issue.severity} ${issue.code}: ${issue.message}`);

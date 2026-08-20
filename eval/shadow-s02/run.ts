/**
 * Eval driver. `npx tsx eval/shadow-s02/run.ts [--payload N]`
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { compositionBlueprintSchema } from "@/lib/copilot/blueprint";
import { materializeSongSkeleton, checkBlueprintDuration } from "@/lib/copilot/materialize";
import { runValidators } from "@/lib/validators";
import { TURNS } from "./turns";
import { payloadFor, runTurn } from "./harness";
import { provenanceFor } from "./provenance";
import type { Song } from "@/lib/song/schema";

const HERE = new URL(".", import.meta.url).pathname;
const ARTIFACTS = join(HERE, "artifacts");
mkdirSync(ARTIFACTS, { recursive: true });
const write = (name: string, body: string) => writeFileSync(join(ARTIFACTS, name), body);

const provenance: unknown[] = [];
const STAMP = "2026-08-20T16:30:00Z";
const blueprint = compositionBlueprintSchema.parse(
  JSON.parse(readFileSync(join(ARTIFACTS, "blueprint.json"), "utf8")),
);
const duration = checkBlueprintDuration(blueprint);
const built = materializeSongSkeleton(blueprint, { title: "Shadow Eval S-02" });
if (!built.ok) throw new Error(built.reason);

console.log(
  `blueprint: ${duration.seconds.toFixed(2)}s (target ${duration.target}±${duration.tolerance}, ` +
    `within=${duration.withinTolerance})`,
);
write("skeleton.json", JSON.stringify(built.song, null, 2));

// The blueprint is an answer too, and it gets a record of its own: without
// one, a blueprint could be swapped by hand between runs and nothing would
// show it.
provenance.push(
  provenanceFor({
    operation: "composition_blueprint",
    attempt: 0,
    request: readFileSync(join(ARTIFACTS, "raw-request.json"), "utf8"),
    response: JSON.stringify(blueprint),
    generatedAt: STAMP,
  }),
);

const only = process.argv.includes("--payload")
  ? Number(process.argv[process.argv.indexOf("--payload") + 1])
  : null;

let song: Song = built.song;
const log: unknown[] = [];

for (const turn of TURNS) {
  const attempts: { corrections: string[] }[] = [];
  let accepted = false;

  for (let attempt = 0; attempt <= 2 && !accepted; attempt += 1) {
    const corrections = attempt === 0 ? undefined : attempts[attempt - 1]?.corrections;
    const payload = payloadFor(song, turn, corrections);
    const stem = `turn-${turn.index}-attempt-${attempt}`;
    write(`${stem}-payload.json`, JSON.stringify({ turn: turn.index, label: turn.label, role: turn.role, ...payload }, null, 2));

    if (only !== null && turn.index === only) {
      console.log(`\n=== turn ${turn.index} attempt ${attempt} payload written ===`);
      process.exit(0);
    }

    const answerPath = join(ARTIFACTS, `${stem}-response.json`);
    if (!existsSync(answerPath)) {
      console.log(`\nturn ${turn.index} attempt ${attempt}: awaiting ${stem}-response.json`);
      write("state.json", JSON.stringify(song, null, 2));
      write("turn-log.json", JSON.stringify(log, null, 2));
      process.exit(0);
    }

    const raw = readFileSync(answerPath, "utf8");
    provenance.push(
      provenanceFor({
        operation: "arrange_track",
        skillOrRole: turn.role,
        attempt,
        request: payload,
        response: raw,
        generatedAt: STAMP,
      }),
    );

    const outcome = runTurn(song, turn, raw);

    // Production accepts a candidate carrying warnings. This eval's bar is
    // stricter for the turn's *own* surface: an articulation whose context
    // does not hold is a note that will not be played as written.
    const own = outcome.ok
      ? outcome.warnings.filter(
          (w) =>
            w.code === "articulationContext" &&
            w.trackId === turn.targetTrackId &&
            w.sectionId === turn.sectionId,
        )
      : [];

    if (outcome.ok && own.length > 0 && attempt < 2) {
      attempts.push({ corrections: own.map((w) => `${w.message} Ayni telde kalacak bir nota cifti sec.`) });
      log.push({ turn: turn.index, label: turn.label, attempt, result: "rejected", stage: "articulationWarning", diagnostic: own.map((w) => w.message).join(" | ") });
      console.log(`turn ${turn.index} attempt ${attempt}: SENT BACK — ${own.length} articulation warning`);
      for (const w of own) console.log(`    ${w.message}`);
      continue;
    }

    if (outcome.ok) {
      song = outcome.song;
      accepted = true;
      log.push({ turn: turn.index, label: turn.label, attempt, result: "accepted", patchId: outcome.patchId, touchedBars: outcome.touchedBars, explanation: outcome.explanation, warnings: outcome.warnings.map((w) => ({ code: w.code, message: w.message })) });
      console.log(`turn ${turn.index} (${turn.label}) attempt ${attempt}: ACCEPTED, ${outcome.warnings.length} warning`);
      for (const w of outcome.warnings) console.log(`    warning ${w.code}: ${w.message}`);
    } else {
      attempts.push({ corrections: outcome.corrections });
      log.push({ turn: turn.index, label: turn.label, attempt, result: "rejected", stage: outcome.stage, diagnostic: outcome.diagnostic });
      console.log(`turn ${turn.index} (${turn.label}) attempt ${attempt}: REJECTED at ${outcome.stage} — ${outcome.diagnostic}`);
    }
  }

  if (!accepted) {
    console.error(`turn ${turn.index} exhausted its two correction rounds`);
    break;
  }
}

write("final-song.json", JSON.stringify(song, null, 2));
write("turn-log.json", JSON.stringify(log, null, 2));
write("provenance.json", JSON.stringify(provenance, null, 2));

const issues = runValidators(song);
console.log(`\nfinal: ${issues.filter((i) => i.severity === "error").length} error, ${issues.filter((i) => i.severity === "warning").length} warning`);
for (const issue of issues) console.log(`  ${issue.severity} ${issue.code}: ${issue.message}`);

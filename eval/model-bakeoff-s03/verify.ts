/**
 * Check the bake-off's own claims against its artifacts (spec §21, K-33).
 *
 * `npx tsx eval/model-bakeoff-s03/verify.ts`
 *
 * Everything the delivery report will say about who wrote what is re-derived
 * here from the files on disk, and every one of these checks can fail. The
 * point of the run is the comparison; the point of this file is that the
 * comparison is between two things that are what they say they are.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { songSchema } from "@/lib/song/schema";
import { compositionBlueprintSchema } from "@/lib/copilot/blueprint";
import { runValidators } from "@/lib/validators";
import { assertHonestProvenance, type ShadowProvenance } from "./provenance";
import { RAW_REQUEST } from "./request";

const ROOT = "eval/model-bakeoff-s03";
const read = (file: string) => readFileSync(file, "utf8");
const json = (file: string) => JSON.parse(read(file)) as unknown;

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

/** Names the musician used. They belong in the request artifact only. */
const ARTIST_NAMES = ["Pantera", "Opeth"];

const seenModels: string[] = [];

for (const candidate of ["a", "b"] as const) {
  const dir = join(ROOT, "artifacts", `candidate-${candidate}`);
  console.log(`\n=== candidate ${candidate.toUpperCase()} ===`);

  /*
   * Provenance and isolation are checked first and unconditionally. They are
   * the claims this report makes about *how* the run was done, and they are
   * exactly as important when a candidate did not finish — a failed run whose
   * provenance is unverified is not evidence of anything.
   */
  const provenance = json(join(dir, "provenance.json")) as ShadowProvenance[];
  check(`${candidate}: every answer has a provenance record`, provenance.length > 0,
    `${provenance.length} invocations`);

  let toolUses = 0;
  const models = new Set<string>();
  for (const entry of provenance) {
    try {
      assertHonestProvenance(entry);
    } catch (error) {
      check(`${candidate}: provenance ${entry.operation}#${entry.attempt} is honest`, false,
        (error as Error).message);
    }
    toolUses += entry.toolUses;
    if (entry.exactModelId) models.add(entry.exactModelId);
    check(
      `${candidate}: ${entry.operation}#${entry.attempt} model id came from the runtime`,
      entry.modelIdVerified && entry.modelIdSource === "runtime_transcript",
    );
    check(
      `${candidate}: ${entry.operation}#${entry.attempt} inherited no conversation`,
      entry.userRecords === entry.attempt + 1,
      `userRecords=${entry.userRecords}`,
    );
  }
  check(`${candidate}: no invocation used a tool`, toolUses === 0, `${toolUses} tool uses`);
  check(`${candidate}: one model wrote everything`, models.size === 1, [...models].join(", "));
  seenModels.push(...models);

  // The musician's words, unaltered, and the artist names only there.
  const rawRequest = read(join(dir, "raw-request.json"));
  check(
    `${candidate}: the raw request is the musician's, unaltered`,
    rawRequest.includes(RAW_REQUEST),
  );
  for (const name of ARTIST_NAMES) {
    check(`${candidate}: "${name}" is in the raw request`, rawRequest.includes(name));
  }

  // Correction discipline: never more than two, whatever the outcome.
  const attempts = provenance.map((entry) => entry.attempt);
  check(`${candidate}: no stage used more than two corrections`,
    attempts.every((attempt) => attempt <= 2), `worst attempt index ${Math.max(...attempts)}`);

  // How far the run got, stated rather than assumed.
  const blueprintAccepted = existsSync(join(dir, "blueprint.json"));
  const finished = existsSync(join(dir, "final-song.json"));
  console.log(
    `INFO  ${candidate}: blueprint ${blueprintAccepted ? "accepted" : "NOT accepted"} · ` +
      `arrange turns ${finished ? "completed" : "not completed"}`,
  );

  if (blueprintAccepted) {
    const blueprint = compositionBlueprintSchema.parse(json(join(dir, "blueprint.json")));
    check(`${candidate}: blueprint parses the production schema`, true,
      `${blueprint.sections.length} sections, ${blueprint.tracks.length} tracks`);
    for (const name of ARTIST_NAMES) {
      check(
        `${candidate}: "${name}" is not in the blueprint`,
        !read(join(dir, "blueprint.json")).includes(name),
      );
    }
  }

  if (!finished) continue;

  const song = songSchema.parse(json(join(dir, "final-song.json")));
  const issues = runValidators(song);
  const errors = issues.filter((issue) => issue.severity === "error");
  check(`${candidate}: song passes the validator chain`, errors.length === 0,
    `${errors.length} error, ${issues.length - errors.length} warning`);
  for (const name of ARTIST_NAMES) {
    check(
      `${candidate}: "${name}" is not in the final song`,
      !read(join(dir, "final-song.json")).includes(name),
    );
  }
}

console.log("\n=== across candidates ===");
check("the two candidates ran on different models", new Set(seenModels).size === 2,
  [...new Set(seenModels)].join(" vs "));
check("a sealed mapping exists", existsSync(join(ROOT, "SEALED_MAPPING.json")));

const sealed = read(join(ROOT, "SEALED_MAPPING.json"));
check(
  "the sealed mapping names both models",
  seenModels.every((model) => sealed.includes(model)),
);

// The mapping must not leak into anything a listener sees.
const leaky: string[] = [];
for (const candidate of ["a", "b"] as const) {
  const dir = join(ROOT, "artifacts", `candidate-${candidate}`);
  for (const file of ["final-song.json", "blueprint.json", "turn-log.json"]) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    const body = read(path);
    for (const model of new Set(seenModels)) {
      if (body.includes(model)) leaky.push(`${candidate}/${file}`);
    }
  }
}
check("no model name leaks into a listening artifact", leaky.length === 0, leaky.join(", "));

/*
 * `provenance.json` does carry the model id, per candidate — that is what it
 * is for, and a provenance record that hid the model would be worthless. The
 * blind is kept where it matters: the comparison the listener reads must not
 * name a model or consult the seal.
 */
const reportSource = read(join(ROOT, "report.ts"));
check(
  "the comparison report never reads the seal",
  !reportSource.includes("SEALED_MAPPING"),
);
check(
  "the comparison report names no model",
  !seenModels.some((model) => reportSource.includes(model)) &&
    !/claude-(opus|sonnet|haiku)/.test(reportSource),
);

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

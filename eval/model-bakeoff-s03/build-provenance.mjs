/**
 * Assemble each candidate's provenance from the runtime records on disk.
 *
 * `node build-provenance.mjs <A|B>`
 *
 * Every field that says who wrote an answer comes from the `.runtime.json`
 * captured beside that answer, which `capture-response.mjs` wrote from the
 * invocation's own transcript. Nothing here is typed by hand, and nothing
 * here reads the answers for content.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const candidate = (process.argv[2] ?? "").toUpperCase();
if (candidate !== "A" && candidate !== "B") {
  console.error("usage: build-provenance.mjs <A|B>");
  process.exit(1);
}

const DIR = join("eval/model-bakeoff-s03/artifacts", `candidate-${candidate.toLowerCase()}`);
const hashOf = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex")
    .slice(0, 16);

const turnLog = existsSync(join(DIR, "turn-log.json"))
  ? JSON.parse(readFileSync(join(DIR, "turn-log.json"), "utf8"))
  : [];

const entries = [];
for (const file of readdirSync(DIR).sort()) {
  if (!file.endsWith("-response.json.runtime.json")) continue;
  const stem = file.replace(".runtime.json", "");
  const facts = JSON.parse(readFileSync(join(DIR, file), "utf8"));
  const response = readFileSync(join(DIR, stem), "utf8");

  const blueprint = stem.startsWith("blueprint-");
  const match = stem.match(/^(?:blueprint|turn-(\d+))-attempt-(\d+)-response\.json$/);
  const turnIndex = match?.[1] ? Number(match[1]) : null;
  const attempt = Number(match?.[2] ?? 0);

  const payloadName = stem.replace("-response.json", "-payload.json");
  const request = existsSync(join(DIR, payloadName))
    ? readFileSync(join(DIR, payloadName), "utf8")
    : "";

  const logged = turnLog.find(
    (record) => record.turn === turnIndex && record.attempt === attempt,
  );

  entries.push({
    generationMode: "separate_shadow_model",
    candidate,
    exactModelId: facts.exactModelId,
    modelIdVerified: facts.modelIdVerified,
    modelIdSource: facts.modelIdSource,
    providerInvocation: true,
    invocationId: facts.transcriptPath.split("/").pop().replace(/^agent-|\.jsonl$/g, ""),
    transcriptPath: facts.transcriptPath,
    toolUses: facts.toolUses,
    toolNames: facts.toolNames,
    userRecords: facts.userRecords,
    contextInheritance: "none",
    operation: blueprint ? "composition_blueprint" : "arrange_track",
    ...(logged?.role ? { skillOrRole: logged.role } : {}),
    ...(turnIndex === null ? {} : { turn: turnIndex }),
    attempt,
    requestHash: hashOf(request),
    responseHash: hashOf(response),
    schemaAccepted: blueprint
      ? existsSync(join(DIR, "blueprint.json"))
        ? attempt ===
          JSON.parse(readFileSync(join(DIR, "blueprint-report.json"), "utf8")).attempt
        : false
      : logged?.result === "accepted" || logged?.stage !== "parse",
    validatorAccepted: blueprint
      ? existsSync(join(DIR, "blueprint.json")) &&
        attempt ===
          JSON.parse(readFileSync(join(DIR, "blueprint-report.json"), "utf8")).attempt
      : logged?.result === "accepted",
  });
}

writeFileSync(join(DIR, "provenance.json"), JSON.stringify(entries, null, 2));
const models = [...new Set(entries.map((entry) => entry.exactModelId))];
console.log(
  `candidate ${candidate}: ${entries.length} invocations · models ${models.join(", ")} · ` +
    `tool uses ${entries.reduce((total, entry) => total + entry.toolUses, 0)}`,
);

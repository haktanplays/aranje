/**
 * Prove every invocation received exactly the payload the harness built.
 *
 * The bake-off's central claim is symmetry: both candidates were asked the
 * same thing in the same words. The payloads are generated, but the dispatch
 * itself is manual, and a prompt copied by hand is a prompt that can drift.
 *
 * The transcript records the text the model actually received, so the claim
 * is checkable rather than trusted. This compares that text, byte for byte,
 * against the payload file the harness wrote for that attempt.
 *
 * `node verify-dispatch.mjs` — exits non-zero on any mismatch.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL(".", import.meta.url).pathname;
const ARTIFACTS = join(ROOT, "artifacts");

/** The one line that fences a candidate off from this repository. */
const WRAPPER =
  "Do not use any tools. Do not read any files. Do not explore any repository. Answer only from the text below.";

/** Assemble a payload exactly as `print-payload.mjs` renders it. */
function expectedText(payload) {
  const system = Array.isArray(payload.system) ? payload.system.join("\n\n") : payload.system;
  return [
    WRAPPER,
    "",
    system,
    "",
    "Yanit semasi (JSON Schema):",
    JSON.stringify(payload.responseSchema),
    "",
    payload.userMessage,
  ].join("\n");
}

/** The first thing a subagent was told, as plain text. */
function firstUserMessage(transcriptPath) {
  const lines = readFileSync(transcriptPath, "utf8").trim().split("\n");
  for (const line of lines) {
    const record = JSON.parse(line);
    if (record.type !== "user") continue;
    const content = record.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.map((part) => part.text ?? "").join("");
  }
  return null;
}

/**
 * Whitespace at the very end is an artefact of shell redirection, not of the
 * prompt. Nothing else is normalised: a difference inside the text is a
 * difference in what the model was asked.
 */
const normalise = (text) => text.replace(/\s+$/, "");

const results = [];
for (const candidate of ["candidate-a", "candidate-b"]) {
  const dir = join(ARTIFACTS, candidate);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir).sort()) {
    const match = /^(.*)-payload\.json$/.exec(name);
    if (!match) continue;
    const stem = match[1];
    const runtimePath = join(dir, `${stem}-response.json.runtime.json`);
    if (!existsSync(runtimePath)) continue;

    const runtime = JSON.parse(readFileSync(runtimePath, "utf8"));
    const payload = JSON.parse(readFileSync(join(dir, name), "utf8"));
    const sent = firstUserMessage(runtime.transcriptPath);
    const want = normalise(expectedText(payload));
    const got = sent === null ? null : normalise(sent);

    results.push({ candidate, stem, ok: got === want, want, got });
  }
}

let failed = 0;
for (const result of results) {
  if (result.ok) {
    console.log(`ok   ${result.candidate} ${result.stem}`);
    continue;
  }
  failed += 1;
  console.log(`FAIL ${result.candidate} ${result.stem}`);
  if (result.got === null) {
    console.log("     no user message found in the transcript");
    continue;
  }
  const limit = Math.min(result.want.length, result.got.length);
  let at = 0;
  while (at < limit && result.want[at] === result.got[at]) at += 1;
  console.log(`     first difference at character ${at}`);
  console.log(`     expected: ${JSON.stringify(result.want.slice(at, at + 90))}`);
  console.log(`     received: ${JSON.stringify(result.got.slice(at, at + 90))}`);
}

console.log();
console.log(`${results.length - failed}/${results.length} dispatch(es) matched the generated payload`);
if (failed > 0) process.exit(1);

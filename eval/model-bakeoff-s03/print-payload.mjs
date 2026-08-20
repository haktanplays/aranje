/**
 * Print a payload as the exact text an invocation is given.
 *
 * `node print-payload.mjs <payload.json>`
 *
 * Provider order: system, then the response schema, then the user message.
 * Printing it rather than retyping it is the point — the two candidates must
 * receive byte-identical text, and a prompt copied by hand twice is a prompt
 * that differs twice.
 */
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: print-payload.mjs <payload.json>");
  process.exit(1);
}

const payload = JSON.parse(readFileSync(path, "utf8"));
const system = Array.isArray(payload.system) ? payload.system.join("\n\n") : payload.system;

console.log(system);
console.log();
console.log("Yanit semasi (JSON Schema):");
console.log(JSON.stringify(payload.responseSchema));
console.log();
console.log(payload.userMessage);

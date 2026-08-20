/**
 * Copy a model invocation's final answer out of its transcript, unaltered.
 *
 * `node capture-response.mjs <transcript.jsonl> <destination.json>`
 *
 * The coding agent never retypes, reformats or repairs an answer: it moves
 * the bytes the model produced from the runtime's own record to the file the
 * eval driver reads. Anything wrong with those bytes is a finding, and the
 * production parser is what finds it.
 *
 * The provenance record for the invocation is written alongside, from the
 * same pass, so the answer and the evidence about who wrote it cannot drift.
 *
 * `--expect-replies N` guards against capturing too early. A correction round
 * resumes the same invocation, so its transcript grows; polling on the number
 * of *messages sent* races the reply, and the capture then writes the previous
 * answer under the new attempt's name. Ask for the number of assistant replies
 * the transcript must already hold, and the capture refuses rather than
 * quietly recording a stale answer as a failure.
 */
import { readFileSync, writeFileSync, realpathSync } from "node:fs";

const args = process.argv.slice(2);
const expectIndex = args.indexOf("--expect-replies");
const expectReplies = expectIndex >= 0 ? Number(args[expectIndex + 1]) : null;
const [source, destination] = args.filter(
  (value, index) => index !== expectIndex && index !== expectIndex + 1,
);
if (!source || !destination) {
  console.error(
    "usage: capture-response.mjs <transcript.jsonl> <destination.json> [--expect-replies N]",
  );
  process.exit(1);
}

const resolved = realpathSync(source);
const models = new Set();
const toolNames = [];
let toolUses = 0;
let userRecords = 0;
let assistantReplies = 0;
let finalText = null;

for (const line of readFileSync(resolved, "utf8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  let record;
  try {
    record = JSON.parse(trimmed);
  } catch {
    continue;
  }
  const message = record.message ?? {};
  if (typeof message.model === "string") models.add(message.model);
  if (record.type === "user") userRecords += 1;
  const content = message.content;
  if (!Array.isArray(content)) continue;
  for (const block of content) {
    if (block?.type === "tool_use") {
      toolUses += 1;
      if (typeof block.name === "string") toolNames.push(block.name);
    }
    if (record.type === "assistant" && block?.type === "text" && typeof block.text === "string") {
      finalText = block.text;
      assistantReplies += 1;
    }
  }
}

if (finalText === null) {
  console.error("no assistant text found in transcript");
  process.exit(1);
}

if (expectReplies !== null && assistantReplies < expectReplies) {
  console.error(
    `refusing to capture: transcript holds ${assistantReplies} assistant replies, ` +
      `expected at least ${expectReplies} — the reply has not landed yet`,
  );
  process.exit(2);
}

writeFileSync(destination, finalText);

const modelList = [...models];
const facts = {
  transcriptPath: resolved,
  exactModelId: modelList.length === 1 ? modelList[0] : null,
  modelsSeen: modelList,
  modelIdVerified: modelList.length === 1,
  modelIdSource: "runtime_transcript",
  toolUses,
  toolNames: [...new Set(toolNames)],
  userRecords,
  assistantReplies,
  responseChars: finalText.length,
};
writeFileSync(`${destination}.runtime.json`, JSON.stringify(facts, null, 2));
console.log(JSON.stringify(facts));

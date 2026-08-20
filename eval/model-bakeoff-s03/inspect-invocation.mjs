/**
 * Read the runtime facts of one model invocation from its own transcript.
 *
 * `node eval/model-bakeoff-s03/inspect-invocation.mjs <transcript.jsonl>`
 *
 * This is the only thing in the bake-off allowed to fill `exactModelId`. A
 * model asked "which model are you" gives a claim; the runtime's own record
 * of which model served each assistant turn is evidence, and that is what is
 * read here. The same pass counts tool uses — an invocation that reached for
 * a tool could have opened this repository, and an answer written with the
 * repository open is not an isolated answer — and counts the messages the
 * invocation was given, where one means it inherited no conversation.
 *
 * Nothing here is reachable from the app.
 */
import { readFileSync, realpathSync } from "node:fs";

const target = process.argv[2];
if (!target) {
  console.error("usage: inspect-invocation.mjs <transcript.jsonl>");
  process.exit(1);
}

const resolved = realpathSync(target);
const models = new Set();
const toolNames = [];
let toolUses = 0;
let userRecords = 0;
let assistantRecords = 0;
let finalText = "";

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
  if (typeof record.model === "string") models.add(record.model);

  if (record.type === "user") userRecords += 1;
  if (record.type === "assistant") assistantRecords += 1;

  const content = message.content;
  if (!Array.isArray(content)) continue;
  for (const block of content) {
    if (block?.type === "tool_use") {
      toolUses += 1;
      if (typeof block.name === "string") toolNames.push(block.name);
    }
    if (record.type === "assistant" && block?.type === "text" && typeof block.text === "string") {
      finalText = block.text;
    }
  }
}

const modelList = [...models];
console.log(
  JSON.stringify(
    {
      transcriptPath: resolved,
      exactModelId: modelList.length === 1 ? modelList[0] : null,
      modelsSeen: modelList,
      modelIdVerified: modelList.length === 1,
      modelIdSource: "runtime_transcript",
      toolUses,
      toolNames: [...new Set(toolNames)],
      userRecords,
      assistantRecords,
      finalTextChars: finalText.length,
    },
    null,
    2,
  ),
);

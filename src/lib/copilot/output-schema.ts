/**
 * The answer contract, as the provider sees it (spec 11.1, 11.3, K-24).
 *
 * Phase 2G's shadow rehearsal exposed the hole this closes. The system prompt
 * said "Yalnizca istenen semada JSON uret" and then never stated the schema:
 * `operation`, `sectionId`, `targetTrackId`, `bars[].barIndex`,
 * `bars[].slots` and `explanation` appeared nowhere, and neither did the
 * 400-character cap on `explanation`. The only way to learn the contract was
 * to break it and read the rejection.
 *
 * So the contract now travels to the adapter as a JSON Schema document. Two
 * rules make that safe:
 *
 * 1. **It is derived, never written.** `modelPatchSchema` is the single
 *    source, and this file only converts it. A second, hand-maintained copy
 *    would drift the first time either one was edited, and the drift would be
 *    invisible: the model would be told one contract and judged by another.
 * 2. **It is generated once.** The document is a constant, so the prompt
 *    prefix stays byte-stable and the cache still holds (spec 11.5).
 *
 * `strictObject` becomes `additionalProperties: false`, which is what carries
 * "an unknown field is a rejected answer" across the boundary. `position` is
 * absent because `modelNoteEventSchema` omits it — placement belongs to the
 * deterministic engine (spec 11.1), and a schema that cannot express a
 * position is a better statement of that than a sentence asking nicely.
 */
import { z } from "zod";

import { modelPatchSchema } from "@/lib/copilot/contract";
import type { JsonSchema } from "@/lib/ai/json-schema";

/**
 * The output contract as JSON Schema. Frozen at module load, so every request
 * carries the identical bytes.
 *
 * `io: "input"` is the right side of the schema: what the model must *send*,
 * before any zod transform, rather than what the parsed value looks like.
 */
export const MODEL_PATCH_JSON_SCHEMA: JsonSchema = Object.freeze(
  z.toJSONSchema(modelPatchSchema, { io: "input" }) as JsonSchema,
);

/**
 * Emulate the one thing a real provider does that this harness cannot.
 *
 * In production the response schema does not travel as prose. `AdapterRequest`
 * carries it as data precisely so each adapter can hand it to its provider as
 * "a tool definition, a response format, a grammar" (src/lib/ai/adapter.ts).
 * The provider then returns JSON structurally: a markdown fence cannot occur,
 * because the model never emits the envelope in the first place.
 *
 * A bake-off dispatched as plain text has no such enforcement, so both
 * candidates occasionally wrap their answer in ```json ... ```. Charging that
 * to the model would report a limitation of this harness as a musical failure.
 *
 * This module therefore removes exactly one thing — a fence that wraps the
 * WHOLE answer — and does it here, in the eval-only shadow transport, before
 * the production parser runs.
 *
 * It must never be reachable from production. Not `parseArrangePatch`, not
 * `/api/copilot`, not the adapter, not the shared schema parser, not the fake
 * demo client. Writing schema rules into a plain-text prompt is not native
 * enforcement, and a normaliser that leaked into production would turn this
 * pretence into shipped behaviour. `bakeoff-transport.test.ts` pins that.
 *
 * What it will not do:
 *   - touch a single byte inside the fence
 *   - drop or rename a field, or strip an unknown key
 *   - accept prose before or after the fence
 *   - accept more than one fence
 *   - rescue a body that still does not parse
 */
import { createHash } from "node:crypto";

/**
 * A whole-answer fence: optional tag, one body, nothing outside it.
 *
 * Anchored at both ends, so anything the model said around the fence keeps the
 * answer unnormalised. `[^`]` in the body forbids a second fence rather than
 * silently gluing two blocks together.
 */
const WHOLE_ANSWER_FENCE = /^\s*```[a-zA-Z0-9_-]*[ \t]*\r?\n([^`]*?)\r?\n[ \t]*```\s*$/;

/** The only normalisation this harness performs. */
export const FENCE_UNWRAP = "whole_answer_fence_unwrap";

export type Normalisation = {
  /** The text the production parser should see. */
  readonly text: string;
  /** Set only when a fence was removed. */
  readonly normalizationApplied: typeof FENCE_UNWRAP | null;
  /** Digest of exactly what the model returned. */
  readonly rawSha256: string;
  /** Digest of what the parser was given. Equal to `rawSha256` when untouched. */
  readonly normalizedSha256: string;
};

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * Strip a whole-answer markdown fence, if there is exactly one and it is all
 * the model said.
 *
 * The body is returned verbatim. Whether it parses is still the parser's
 * question to answer, and still the model's result to own.
 */
export function unwrapProviderEnvelope(raw: string): Normalisation {
  const rawSha256 = sha256(raw);
  const match = WHOLE_ANSWER_FENCE.exec(raw);
  const body = match?.[1];
  if (body === undefined) {
    return { text: raw, normalizationApplied: null, rawSha256, normalizedSha256: rawSha256 };
  }
  return {
    text: body,
    normalizationApplied: FENCE_UNWRAP,
    rawSha256,
    normalizedSha256: sha256(body),
  };
}

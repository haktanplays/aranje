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
 * So the fence is removed here, in the transport layer, before the production
 * parser sees the text — and nowhere else. This is not editing an answer so it
 * will pass: nothing inside the fence is touched, a body that is still invalid
 * stays invalid, and every unwrap is recorded so the report can say how often
 * each candidate needed it.
 */

/** A fenced block, optionally tagged, occupying the whole answer. */
const FENCED = /^\s*```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?\s*```\s*$/;

export type Unwrapped = {
  /** The text the production parser should see. */
  readonly text: string;
  /** Whether a provider would have made the fence impossible. */
  readonly unwrapped: boolean;
};

/**
 * Strip a whole-answer markdown fence, if there is one.
 *
 * Only a fence wrapping the entire response is removed. Prose before or after
 * it is a different failure — the model said something it was told not to say —
 * and must still be rejected.
 */
export function unwrapProviderEnvelope(raw: string): Unwrapped {
  const match = FENCED.exec(raw);
  if (!match || match[1] === undefined) return { text: raw, unwrapped: false };
  return { text: match[1], unwrapped: true };
}

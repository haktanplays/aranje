/**
 * What a rejected attempt actually proves.
 *
 * This run was dispatched as plain text, so the schema reached both candidates
 * as prose rather than as a tool definition or a grammar. That makes some
 * rejections evidence about the transport and only some evidence about the
 * model, and a single "rejected" count would blur the two. The bake-off is
 * therefore classified as a `transport_confounded_shadow_run`, and every
 * attempt is filed under one of three headings.
 *
 * Nothing is deleted by classifying it. A confounded failure is still a real
 * instruction-following observation and stays in the record; it just cannot be
 * spent as a musical-quality score or as a model's defeat.
 */

export const RUN_CLASSIFICATION = "transport_confounded_shadow_run";

export type FailureClass =
  /**
   * The answer was a JSON document in a markdown jacket. Unwrapping the jacket
   * made it parse, and nothing inside it changed. Not a model failure, and it
   * does not consume a correction.
   */
  | "packaging_only"
  /**
   * A malformed answer of a kind that native structured output would very
   * likely have prevented: an unknown key, schema vocabulary written into the
   * payload, an over-long string, a mistyped primitive or enum, a missing
   * required field. Reportable as instruction-following; not usable as musical
   * quality or as a defeat.
   */
  | "schema_transport_confounded"
  /**
   * A real content error. Schema enforcement guarantees shape, not sense: it
   * cannot keep a note inside the instrument's range, aim a patch at the right
   * track, satisfy tonal majority, make an articulation's context hold, or fit
   * the bar. These stay genuine corrections and genuine failures.
   */
  | "semantic_failure";

/** Only this class is exempt from the attempt budget. */
export const isPackagingOnly = (failure: FailureClass) => failure === "packaging_only";

/** Signatures of the schema layer complaining about shape rather than sense. */
const SCHEMA_SHAPED = [
  /unrecognized key/i,
  /unknown key/i,
  /additionalProperties/i,
  /too_big/i,
  /too_small/i,
  /invalid_type/i,
  /invalid_enum/i,
  /invalid_value/i,
  /invalid_format/i,
  /required/i,
  /expected .* received/i,
];

/**
 * File one attempt.
 *
 * `packaging_only` describes an attempt that needed nothing but the jacket
 * taken off: the fence was there, the body parsed underneath it, and the
 * production chain then accepted it. Because the fence is removed before the
 * parser runs, such an attempt simply succeeds — which is exactly why it costs
 * the candidate no correction.
 *
 * A rejection is never packaging. If the answer still failed after the fence
 * came off, the fence was not what was wrong with it, and the real reason
 * decides the class.
 */
export function classifyAttempt(input: {
  readonly accepted: boolean;
  readonly normalized: boolean;
  readonly stage: "parse" | "schema" | "grid" | "validators" | "materialise" | null;
  readonly reason: string;
}): FailureClass | null {
  if (input.accepted) return input.normalized ? "packaging_only" : null;
  if (input.stage === "validators" || input.stage === "grid") return "semantic_failure";
  if (SCHEMA_SHAPED.some((pattern) => pattern.test(input.reason))) {
    return "schema_transport_confounded";
  }
  return "semantic_failure";
}

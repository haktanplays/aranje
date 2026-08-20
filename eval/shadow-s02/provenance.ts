/**
 * Who produced each answer in a rehearsal, recorded rather than assumed.
 *
 * The S-01 report said "Sonnet 8 turda 1 sema hatasi uretti". Sonnet was
 * never called. Nothing in that rehearsal recorded who actually wrote the
 * answers, so the claim was available to be made — and it was made, by me,
 * in the delivery report. This type exists so the same thing cannot happen
 * quietly again: every attempt carries its own origin, and a run that has no
 * provider invocation cannot be written up as if it had one.
 *
 * The rules are deliberately awkward in the honest direction:
 *
 * - `exactModelId` is only ever filled from runtime metadata. If the runtime
 *   does not say, the field stays empty; a plausible-looking id is worse than
 *   an absent one, because it reads as evidence.
 * - `codingModelLabel` is a *session label*, which is what the user told us
 *   and what `get_session` reports. It is not a verified provider model id
 *   and `modelIdVerified` says which of the two it is.
 * - `coding_agent_simulation` produces no latency and no cost figures. There
 *   is no provider call to have taken time or money, and a number invented
 *   here would end up in a comparison table looking like a measurement.
 */
import { createHash } from "node:crypto";

export type GenerationMode =
  /** A real provider call through the adapter. */
  | "provider"
  /** A separate model, invoked on purpose, standing in for the provider. */
  | "separate_shadow_model"
  /** The coding agent writing the answer itself. No provider was involved. */
  | "coding_agent_simulation"
  /** A recorded answer replayed from disk. */
  | "fixture";

export type ShadowProvenance = {
  generationMode: GenerationMode;
  /** What the session says it is running. A label, not a verified id. */
  codingModelLabel?: string;
  /** Only from runtime metadata. Absent when the runtime did not say. */
  exactModelId?: string;
  modelIdVerified: boolean;
  providerInvocation: boolean;
  providerName?: string;
  operation: "composition_blueprint" | "arrange_track";
  skillOrRole?: string;
  attempt: number;
  requestHash: string;
  responseHash: string;
  generatedAt: string;
};

export function hashOf(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * The S-02 run's own origin.
 *
 * `modelIdVerified` is true because `get_session` reported
 * `session_context.model` and `external_metadata.last_served_model` as the
 * same value, which is runtime metadata rather than a guess. It still
 * describes the **coding agent**, not a provider: `providerInvocation` is
 * false and there is no provider name, because no provider was called.
 */
export const S02_ORIGIN = {
  generationMode: "coding_agent_simulation" as const,
  codingModelLabel: "claude-opus-5",
  exactModelId: "claude-opus-5",
  modelIdVerified: true,
  providerInvocation: false,
};

export function provenanceFor(input: {
  operation: ShadowProvenance["operation"];
  skillOrRole?: string;
  attempt: number;
  request: unknown;
  response: unknown;
  generatedAt: string;
}): ShadowProvenance {
  return {
    ...S02_ORIGIN,
    operation: input.operation,
    ...(input.skillOrRole === undefined ? {} : { skillOrRole: input.skillOrRole }),
    attempt: input.attempt,
    requestHash: hashOf(input.request),
    responseHash: hashOf(input.response),
    generatedAt: input.generatedAt,
  };
}

/**
 * Who produced each answer in the bake-off, and how that is known
 * (spec §21, K-33).
 *
 * S-02's record could say `coding_agent_simulation` honestly because there
 * was nothing to verify — the coding agent wrote the answers and said so.
 * This run claims something stronger, so it has to prove more:
 *
 * - `exactModelId` comes from the **harness's own transcript record** for the
 *   invocation, not from asking the model what it is. A model's self-report
 *   is a claim; the runtime's record of which model served the turn is
 *   evidence, and it is the only thing this file will accept.
 * - `toolUses` is read from the same transcript. An invocation that reached
 *   for a tool could have read this repository, and an answer written with
 *   the repository open is not an isolated answer. Zero is the only value
 *   that supports the isolation claim; anything else is reported, not hidden.
 * - `userRecords` counts the messages the invocation was given. A first
 *   attempt has one: the prompt, and no inherited conversation. A correction
 *   round resumes the same invocation, so attempt N has N+1 — which is what a
 *   correction round *is*, and is checked rather than assumed.
 *
 * None of these fields may be filled by hand. `verify.ts` re-derives all of
 * them from the transcripts and fails if the artifact disagrees.
 */
import { createHash } from "node:crypto";

export type GenerationMode =
  | "provider"
  | "separate_shadow_model"
  | "coding_agent_simulation"
  | "fixture";

export type ShadowProvenance = {
  generationMode: GenerationMode;
  /** Blind label. The model behind it is only in SEALED_MAPPING.json. */
  candidate: "A" | "B";
  /** From the runtime transcript. Never from the model's own words. */
  exactModelId: string;
  modelIdVerified: boolean;
  /** How the id was obtained, so a reader can judge it. */
  modelIdSource: "runtime_transcript";
  providerInvocation: boolean;
  providerName?: string;
  /** The invocation's own id, for tracing back to its transcript. */
  invocationId: string;
  transcriptPath: string;
  /** Tools the invocation used. Zero is what isolation means here. */
  toolUses: number;
  /** Messages it was given. Attempt N has N+1; nothing else is inherited. */
  userRecords: number;
  contextInheritance: "none";
  operation: "composition_blueprint" | "arrange_track";
  skillOrRole?: string;
  attempt: number;
  requestHash: string;
  responseHash: string;
  schemaAccepted: boolean;
  validatorAccepted: boolean;
  generatedAt: string;
};

export function hashOf(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * The one rule that would have caught the S-01 write-up, unchanged from S-02
 * and now with two more clauses this run can actually break.
 */
export function assertHonestProvenance(entry: ShadowProvenance): void {
  const claimsProvider =
    entry.generationMode === "provider" ||
    entry.generationMode === "separate_shadow_model";
  if (claimsProvider !== entry.providerInvocation) {
    throw new Error(
      `provenance claims ${entry.generationMode} but providerInvocation=${entry.providerInvocation}`,
    );
  }
  if (entry.generationMode === "provider" && !entry.providerName) {
    throw new Error("a provider invocation has to name the provider");
  }
  if (entry.exactModelId && !entry.modelIdVerified) {
    throw new Error("an exact model id may only come from runtime metadata");
  }
  if (entry.modelIdVerified && entry.modelIdSource !== "runtime_transcript") {
    throw new Error("a verified model id has to say where it came from");
  }
  if (entry.generationMode === "separate_shadow_model") {
    if (!entry.exactModelId || !entry.invocationId || !entry.transcriptPath) {
      throw new Error("a separate-model invocation has to be traceable");
    }
    if (entry.contextInheritance !== "none") {
      throw new Error("a separate-model invocation may not inherit context");
    }
  }
}

export const MODE_LABELS: Readonly<Record<GenerationMode, string>> = {
  provider: "provider eval",
  separate_shadow_model: "separate shadow model eval",
  coding_agent_simulation: "coding agent simulation (no provider call)",
  fixture: "recorded fixture replay",
};

export function labelFor(entry: ShadowProvenance): string {
  assertHonestProvenance(entry);
  return MODE_LABELS[entry.generationMode];
}

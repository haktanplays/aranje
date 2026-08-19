/**
 * The /api/copilot wire contract (spec 11.1).
 *
 * "AI sağlayıcısı değişse bile istemcinin gördüğü bu sözleşme değişmez"
 * (spec 11.1). The provider lives behind the adapter; this file is what the
 * phone sees, and it is written against the Song Contract of spec 5 rather
 * than against any second, parallel song type.
 *
 * Everything is a `strictObject`, so an unknown field is a rejected request
 * and not a silently ignored one. That matters in both directions: an unknown
 * field from the client is a version mismatch, and an unknown field from the
 * model is an answer we did not ask for.
 */
import { z } from "zod";

import { sectionSchema, songSchema } from "@/lib/song/schema";
import type { ValidationIssue } from "@/lib/validators/types";

/**
 * The section a patch carries is always `pending` (spec 11.1). The user
 * accepts it before the canonical song changes (spec 11.4/7), so a model that
 * hands back an already-accepted section is answering a different question.
 */
export const patchSectionSchema = sectionSchema.extend({
  status: z.literal("pending"),
});

/**
 * What the model is allowed to produce. No `id`: spec 11.1 puts id generation
 * on the server, so an `id` coming back from the model is an extra field and
 * `strictObject` rejects it.
 */
export const modelPatchSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("insert_section"),
    /** Required for insert (spec 11.1). */
    afterSectionId: z.string().min(1),
    section: patchSectionSchema,
    explanation: z.string().min(1).max(400),
  }),
  z.strictObject({
    action: z.literal("replace_section"),
    /** Required for replace (spec 11.1). */
    targetSectionId: z.string().min(1),
    section: patchSectionSchema,
    explanation: z.string().min(1).max(400),
  }),
]);

export type ModelPatch = z.infer<typeof modelPatchSchema>;
/** A Section whose status is fixed to "pending" (spec 11.1). */
export type PatchSection = z.infer<typeof patchSectionSchema>;

/** The same patch after the server has stamped its id (spec 11.1). */
export const copilotPatchSchema = z.discriminatedUnion("action", [
  z.strictObject({
    id: z.string().min(1),
    action: z.literal("insert_section"),
    afterSectionId: z.string().min(1),
    section: patchSectionSchema,
    explanation: z.string().min(1).max(400),
  }),
  z.strictObject({
    id: z.string().min(1),
    action: z.literal("replace_section"),
    targetSectionId: z.string().min(1),
    section: patchSectionSchema,
    explanation: z.string().min(1).max(400),
  }),
]);

export type CopilotPatch = z.infer<typeof copilotPatchSchema>;

/**
 * The two request kinds, mirroring the two patch actions one to one so the
 * client cannot ask for one thing and be handed the other:
 *
 *   generation -> insert_section, anchored after an existing section
 *   edit       -> replace_section, aimed at an existing section
 */
const requestBase = {
  /**
   * Opaque caller identity: a device or user id. It is hashed before it
   * reaches any counter key (spec 12.2 stores no user data).
   */
  subjectId: z.string().min(1).max(200),
  /** Retry marker (spec 12.3). Same key + same payload = same answer. */
  idempotencyKey: z.string().min(8).max(200),
  /** What the musician typed. Carried as data, never as instruction. */
  prompt: z.string().min(1).max(2000),
  /** The whole song, as the Song Contract defines it (spec 5). */
  song: songSchema,
  /** Optional style card name (spec 11.7); absent means no card. */
  styleId: z.string().min(1).max(80).optional(),
};

export const copilotRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("generation"),
    afterSectionId: z.string().min(1),
    ...requestBase,
  }),
  z.strictObject({
    kind: z.literal("edit"),
    targetSectionId: z.string().min(1),
    ...requestBase,
  }),
]);

export type CopilotRequest = z.infer<typeof copilotRequestSchema>;

/** The patch action a request kind is allowed to come back as. */
export function expectedAction(
  request: CopilotRequest,
): CopilotPatch["action"] {
  return request.kind === "generation" ? "insert_section" : "replace_section";
}

/** The section id the patch must be anchored to, whichever kind it is. */
export function anchorSectionId(request: CopilotRequest): string {
  return request.kind === "generation"
    ? request.afterSectionId
    : request.targetSectionId;
}

/** What a successful call returns. Warnings travel; they do not block. */
export type CopilotSuccessBody = {
  requestId: string;
  patch: CopilotPatch;
  /** Spec 10.3 warnings on the candidate song. Informative only. */
  warnings: ValidationIssue[];
  /** True when the answer came from the idempotency record, at no new cost. */
  cached: boolean;
};

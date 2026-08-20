/**
 * The /api/copilot wire contract (spec 11.1, decision K-18).
 *
 * The first thing a musician can ask for is not "write me a section" but
 * "arrange this one track for me". K-18 made that the public operation and
 * removed `insert_section` / `replace_section` from the public route: with no
 * outside users yet, there was nothing to be gained by keeping the wider,
 * riskier contract alive for compatibility.
 *
 * Everything is a `strictObject`, so an unknown field is a rejected request
 * and not a silently ignored one. That matters in both directions: an unknown
 * field from the client is a version mismatch, and an unknown field from the
 * model is an answer we did not ask for.
 *
 * Slot types are **derived** from the Song Contract of spec 5.4. There is no
 * second definition of what a slot is anywhere in this file.
 */
import { z } from "zod";

import { songLimits } from "@/lib/limits";
import { MAX_SLOTS_PER_BAR } from "@/lib/music/timing";
import {
  drumSlotSchema,
  noteEventSchema,
  songSchema,
} from "@/lib/song/schema";
import type { ValidationIssue } from "@/lib/validators/types";

/**
 * The jobs the copilot can be asked to do (spec 11.1, K-18, K-30).
 *
 * K-18 had three: `drums`, `bass`, `harmony`. The S-01 rehearsal showed that
 * is not enough vocabulary for a piece. Every guitar turn had to be
 * `harmony`, whose card says "write a *second* guitar that does not cover the
 * main one, and do not rewrite the main motif" — the exact opposite of what
 * an opening riff or a solo needs, and nonsense for a coda where the acoustic
 * is the only instrument playing. The role was doing the work of three.
 *
 * So the values name the job, not the instrument. Two of them target the same
 * instrument family and differ entirely in what they read and what they are
 * for.
 */
export const ARRANGE_SKILLS = [
  "rhythm_guitar",
  "lead_guitar",
  "acoustic_guitar",
  "harmony",
  "bass",
  "drums",
] as const;
export type ArrangeSkill = (typeof ARRANGE_SKILLS)[number];

/** The same thing, named the way spec 11.1 talks about it. */
export type ArrangeRole = ArrangeSkill;

/**
 * What the model may say about a note.
 *
 * `position` is omitted, not optional: spec 11.1 keeps string and fret
 * placement with the deterministic engine of spec 9.2, so a model that offers
 * one is answering a question it was not asked. Because the source schema is
 * strict, omitting the key turns a written position into a rejected field
 * rather than an ignored one.
 */
export const modelNoteEventSchema = noteEventSchema.omit({ position: true });

/** Derived from spec 5.4's melodic slot, minus the position (see above). */
export const modelMelodicSlotSchema = z.union([
  z.null(),
  z.literal("-"),
  z.strictObject({ notes: z.array(modelNoteEventSchema).min(1) }),
]);

export const modelBarSchema = z.strictObject({
  barIndex: z.number().int().min(0).max(songLimits.barsPerSection - 1),
  /**
   * Melodic for a melodic target, drums for a drum target; never mixed.
   *
   * The bound is the widest bar the contract allows — 4/4 on the finest grid
   * (spec 5.5, K-34). It is not the *right* number for any particular bar:
   * that comes from the bar's own meter and grid and is checked against the
   * section in `checkBarShapes`. What it does is put the range in the schema
   * the provider is given, so a bar of a hundred slots is refused by the
   * structured-output constraint rather than by us afterwards.
   */
  slots: z.union([
    z.array(modelMelodicSlotSchema).max(MAX_SLOTS_PER_BAR),
    z.array(drumSlotSchema).max(MAX_SLOTS_PER_BAR),
  ]),
});

/**
 * What the model is allowed to produce: the target track's slots inside one
 * section, and nothing else. No section, no track metadata, no other track's
 * content, no id — spec 11.1 puts id generation on the server.
 */
export const modelPatchSchema = z.strictObject({
  operation: z.literal("arrange_track"),
  sectionId: z.string().min(1),
  targetTrackId: z.string().min(1),
  bars: z.array(modelBarSchema).min(1).max(songLimits.barsPerSection),
  explanation: z.string().min(1).max(400),
});

export type ModelPatch = z.infer<typeof modelPatchSchema>;
export type ModelBar = z.infer<typeof modelBarSchema>;

/** The same patch after the server has stamped its id (spec 11.1). */
export const copilotPatchSchema = modelPatchSchema.extend({
  id: z.string().min(1),
});

export type CopilotPatch = z.infer<typeof copilotPatchSchema>;

export const copilotRequestSchema = z.strictObject({
  operation: z.literal("arrange_track"),
  skill: z.enum(ARRANGE_SKILLS),
  /** The section to work inside. Must exist in the song. */
  sectionId: z.string().min(1),
  /** The one track that may change. Must exist and suit the skill. */
  targetTrackId: z.string().min(1),
  /**
   * Tracks the caller is declaring untouchable. This is extra clarity, never
   * the boundary itself: every non-target track is locked by the server
   * whether or not it appears here (spec 11.1, K-18), so a short list cannot
   * widen the change surface.
   */
  lockedTrackIds: z.array(z.string().min(1)).max(songLimits.maxTracks),
  /** What the musician typed. Carried as data, never as instruction. */
  instruction: z.string().min(1).max(2000).optional(),

  // --- transport ---------------------------------------------------------
  /**
   * Opaque caller identity: a device or user id. It is hashed before it
   * reaches any counter key (spec 12.2 stores no user data).
   */
  subjectId: z.string().min(1).max(200),
  /** Retry marker (spec 12.3). Same key + same payload = same answer. */
  idempotencyKey: z.string().min(8).max(200),
  /** The whole song, as the Song Contract defines it (spec 5). */
  song: songSchema,
  /** Optional style card id (spec 11.7); absent means no card. */
  styleId: z.string().min(1).max(80).optional(),
});

export type CopilotRequest = z.infer<typeof copilotRequestSchema>;

/** What a successful call returns. Warnings travel; they do not block. */
export type CopilotSuccessBody = {
  requestId: string;
  patch: CopilotPatch;
  /** Spec 10.3 warnings on the candidate song. Informative only. */
  warnings: ValidationIssue[];
  /** True when the answer came from the idempotency record, at no new cost. */
  cached: boolean;
};

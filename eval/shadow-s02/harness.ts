/**
 * Shadow eval S-02. Evaluation only; nothing here is reachable from the app.
 *
 * The difference from S-01 is what the architecture now carries rather than
 * what the harness does. Same production chain, same order, same functions:
 *
 *   buildPrompt   (now with the form, the tempo map and the previous landing)
 *     -> a model, seeing only what a provider would see
 *   parseArrangePatch -> validateArrangeOutput -> validatePatchSize
 *     -> applyPatch -> checkLockedSurface -> runValidators
 *
 * Two rules this run holds itself to, both of which S-01 had to break:
 *
 * - **Nothing is smuggled through the instruction.** S-01 had to describe the
 *   motif in prose because the prompt could not show it. The arrangement
 *   context shows it now, so the instruction says what this turn is *for* and
 *   nothing about what the previous section contained.
 * - **Nothing is hand-edited to go green.** A rejected answer gets a
 *   correction round, not a repair.
 */
import { buildPrompt } from "@/lib/copilot/prompt";
import { applyPatch } from "@/lib/copilot/apply";
import {
  copilotRequestSchema,
  type ArrangeSkill,
  type CopilotRequest,
} from "@/lib/copilot/contract";
import {
  lockedTrackIdsFor,
  parseArrangePatch,
  validateArrangeOutput,
} from "@/lib/copilot/arrange";
import { checkLockedSurface, surfaceDigest } from "@/lib/copilot/scope";
import { MODEL_PATCH_JSON_SCHEMA } from "@/lib/copilot/output-schema";
import { SONG_VALIDATORS, runValidators } from "@/lib/validators";
import { validatePatchSize } from "@/lib/validators/patchSize";
import type { Song } from "@/lib/song/schema";
import type { ValidationIssue } from "@/lib/validators/types";

export type TurnSpec = {
  index: number;
  label: string;
  sectionId: string;
  targetTrackId: string;
  role: ArrangeSkill;
  /** What this turn is for. Never a restatement of another section. */
  instruction: string;
};

export type TurnOutcome =
  | {
      ok: true;
      song: Song;
      patchId: string;
      explanation: string;
      warnings: ValidationIssue[];
      touchedBars: number;
    }
  | {
      ok: false;
      stage: "parse" | "shape" | "patchSize" | "apply" | "lockedSurface" | "validators";
      diagnostic: string;
      corrections: string[];
    };

export function requestFor(song: Song, turn: TurnSpec): CopilotRequest {
  const parsed = copilotRequestSchema.safeParse({
    operation: "arrange_track" as const,
    skill: turn.role,
    sectionId: turn.sectionId,
    targetTrackId: turn.targetTrackId,
    lockedTrackIds: lockedTrackIdsFor(song, turn.targetTrackId),
    instruction: turn.instruction,
    subjectId: "shadow-eval-s02",
    idempotencyKey: `shadow-s02-turn-${turn.index}`,
    song,
  });
  if (!parsed.success) {
    throw new Error(`turn ${turn.index} request invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** Exactly what a provider would receive: two messages and the schema. */
export function payloadFor(song: Song, turn: TurnSpec, corrections?: string[]) {
  const prompt = buildPrompt({
    request: requestFor(song, turn),
    ...(corrections && corrections.length > 0 ? { corrections } : {}),
  });
  return {
    system: prompt.system,
    userMessage: prompt.userMessage,
    responseSchema: MODEL_PATCH_JSON_SCHEMA,
    estimatedInputTokens: prompt.estimatedInputTokens,
  };
}

export function runTurn(song: Song, turn: TurnSpec, raw: string): TurnOutcome {
  const request = requestFor(song, turn);

  let stamped = 0;
  const parsed = parseArrangePatch(raw, request, () => {
    stamped += 1;
    return `shadow-s02-p${turn.index}-${stamped}`;
  });
  if (!parsed.ok) {
    return { ok: false, stage: "parse", diagnostic: parsed.diagnostic, corrections: parsed.corrections };
  }
  const patch = parsed.patch;

  const shape = validateArrangeOutput(request, patch);
  if (shape.length > 0) {
    return {
      ok: false,
      stage: "shape",
      diagnostic: shape.map((i) => i.message).join(" | "),
      corrections: shape.map((i) => i.message),
    };
  }

  const size = validatePatchSize(song, patch);
  if (size.length > 0) {
    return {
      ok: false,
      stage: "patchSize",
      diagnostic: size.map((i) => i.message).join(" | "),
      corrections: size.map((i) => i.message),
    };
  }

  const before = surfaceDigest(song);
  const applied = applyPatch(song, patch);
  if (!applied.ok) {
    return {
      ok: false,
      stage: "apply",
      diagnostic: applied.reason,
      corrections: [`Patch uygulanamadi: ${applied.reason}`],
    };
  }

  const moved = checkLockedSurface(before, surfaceDigest(applied.song), {
    sectionId: request.sectionId,
    targetTrackId: request.targetTrackId,
  });
  if (moved.length > 0) {
    return {
      ok: false,
      stage: "lockedSurface",
      diagnostic: moved.map((v) => `${v.field}: ${v.detail}`).join(" | "),
      corrections: moved.map((v) => `Kilitli yuzey degisti: ${v.field}`),
    };
  }

  const issues = runValidators(applied.song, SONG_VALIDATORS);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    return {
      ok: false,
      stage: "validators",
      diagnostic: errors.map((i) => `${i.code}: ${i.message}`).join(" | "),
      corrections: errors.map((i) => i.message),
    };
  }

  return {
    ok: true,
    song: applied.song,
    patchId: patch.id,
    explanation: patch.explanation,
    warnings: issues.filter((i) => i.severity === "warning"),
    touchedBars: patch.bars.length,
  };
}

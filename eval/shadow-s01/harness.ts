/**
 * Shadow eval S-01 harness. Evaluation only — nothing here is reachable from
 * the app, the API route or the fake adapter, and it adds no key and no
 * network call.
 *
 * The point of a shadow eval is that the *model* is the only thing being
 * swapped out. So this runs the production chain in the production order and
 * with the production functions:
 *
 *   buildPrompt
 *     -> (a model, by hand, seeing only the two messages)
 *   parseArrangePatch -> validateArrangeOutput -> validatePatchSize
 *     -> applyPatch -> checkLockedSurface -> runValidators
 *
 * Nothing is repaired between those steps. A turn either produces a candidate
 * that survives all of them, or it fails and the next attempt is a fresh
 * correction prompt — never a hand-edit of the answer.
 */
import { buildPrompt } from "@/lib/copilot/prompt";
import { applyPatch } from "@/lib/copilot/apply";
import {
  copilotRequestSchema,
  type ArrangeSkill,
  type CopilotRequest,
} from "@/lib/copilot/contract";
import { lockedTrackIdsFor, parseArrangePatch, validateArrangeOutput } from "@/lib/copilot/arrange";
import { checkLockedSurface, surfaceDigest } from "@/lib/copilot/scope";
import { SONG_VALIDATORS, runValidators } from "@/lib/validators";
import { validatePatchSize } from "@/lib/validators/patchSize";
import type { Song } from "@/lib/song/schema";
import type { ValidationIssue } from "@/lib/validators/types";

export type TurnSpec = {
  /** 1-based, matching the order the eval fixes. */
  index: number;
  label: string;
  sectionId: string;
  targetTrackId: string;
  skill: ArrangeSkill;
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
      stage:
        | "request"
        | "parse"
        | "shape"
        | "patchSize"
        | "apply"
        | "lockedSurface"
        | "validators";
      diagnostic: string;
      /** What a correction prompt would be told. */
      corrections: string[];
    };

/** The request as the route would build it: everything else is locked. */
export function requestFor(song: Song, turn: TurnSpec): CopilotRequest {
  const candidate = {
    operation: "arrange_track" as const,
    skill: turn.skill,
    sectionId: turn.sectionId,
    targetTrackId: turn.targetTrackId,
    lockedTrackIds: lockedTrackIdsFor(song, turn.targetTrackId),
    instruction: turn.instruction,
    subjectId: "shadow-eval-s01",
    idempotencyKey: `shadow-s01-turn-${turn.index}`,
    song,
  };
  const parsed = copilotRequestSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new Error(`turn ${turn.index} request invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function promptFor(song: Song, turn: TurnSpec, corrections?: string[]) {
  return buildPrompt({
    request: requestFor(song, turn),
    ...(corrections && corrections.length > 0 ? { corrections } : {}),
  });
}

/**
 * One turn, from a raw model answer to an accepted candidate song.
 *
 * `raw` is exactly the text the model produced. It is never touched on the way
 * in: if it is not JSON, that is a failed turn and not something to tidy up.
 */
export function runTurn(song: Song, turn: TurnSpec, raw: string): TurnOutcome {
  const request = requestFor(song, turn);

  let stamped = 0;
  const parsed = parseArrangePatch(raw, request, () => {
    stamped += 1;
    return `shadow-s01-p${turn.index}-${stamped}`;
  });
  if (!parsed.ok) {
    return {
      ok: false,
      stage: "parse",
      diagnostic: parsed.diagnostic,
      corrections: parsed.corrections,
    };
  }
  const patch = parsed.patch;

  const shape = validateArrangeOutput(request, patch);
  if (shape.length > 0) {
    return {
      ok: false,
      stage: "shape",
      diagnostic: shape.map((issue) => issue.message).join(" | "),
      corrections: shape.map((issue) => issue.message),
    };
  }

  const size = validatePatchSize(song, patch);
  if (size.length > 0) {
    return {
      ok: false,
      stage: "patchSize",
      diagnostic: size.map((issue) => issue.message).join(" | "),
      corrections: size.map((issue) => issue.message),
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
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    return {
      ok: false,
      stage: "validators",
      diagnostic: errors.map((issue) => `${issue.code}: ${issue.message}`).join(" | "),
      corrections: errors.map((issue) => issue.message),
    };
  }

  return {
    ok: true,
    song: applied.song,
    patchId: patch.id,
    explanation: patch.explanation,
    warnings: issues.filter((issue) => issue.severity === "warning"),
    touchedBars: patch.bars.length,
  };
}

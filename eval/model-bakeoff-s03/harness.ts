/**
 * Bake-off S-03. Evaluation only; nothing here is reachable from the app.
 *
 * Same production chain as S-02, in the same order, through the same
 * functions — `buildPrompt` → the model → `parseArrangePatch` →
 * `validateArrangeOutput` → `validatePatchSize` → `applyPatch` →
 * `checkLockedSurface` → `runValidators`. What changed is who writes the
 * answers: two separate models, invoked in isolation, rather than the coding
 * agent.
 *
 * ## What the coding agent is allowed to write
 *
 * Connective words, and nothing else. Every musical string in a turn's
 * instruction — what the section is for, how the motif is transformed, how it
 * hands over — is copied out of **that candidate's own blueprint**, which the
 * same model produced in an earlier invocation. That is not the K-32
 * workaround: the forbidden move is the *coding agent* inventing a motif and
 * feeding it in. Handing a model back its own plan is what a plan is for, and
 * without it every arrange turn would be executing a piece it had never been
 * told about.
 *
 * ## What the two runs share
 *
 * The raw request, the second-round feedback, the schema, the system prompt,
 * the role cards, the correction limit and this file. The only difference is
 * which model is asked.
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
import { resolutionPromptLabel } from "@/lib/music/timing";
import type { CompositionBlueprint } from "@/lib/copilot/blueprint";
import type { Song } from "@/lib/song/schema";
import type { ValidationIssue } from "@/lib/validators/types";
import { FULL_BRIEF } from "./request";

export type CandidateId = "A" | "B";

export type TurnSpec = {
  index: number;
  label: string;
  sectionId: string;
  targetTrackId: string;
  role: ArrangeSkill;
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

/** Trim to the contract's instruction ceiling without cutting mid-word. */
function fit(text: string, max = 2000): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastBreak = cut.lastIndexOf("\n");
  return lastBreak > max * 0.6 ? cut.slice(0, lastBreak) : cut;
}

/**
 * One turn's instruction: the musician's words, then this model's own plan
 * for this section, then nothing.
 *
 * Every line after "Bu tur" is a field the model wrote itself.
 */
export function instructionFor(
  blueprint: CompositionBlueprint,
  sectionKey: string,
  role: ArrangeSkill,
): string {
  const section = blueprint.sections.find((entry) => entry.key === sectionKey);
  if (!section) throw new Error(`blueprint has no section "${sectionKey}"`);
  const motif = blueprint.motifs.find((entry) => entry.key === section.motifKey);
  const track = blueprint.tracks.find((entry) => entry.role === role);

  const lines: string[] = [
    FULL_BRIEF,
    "",
    `Bu tur: "${section.displayName}" bolumunde ${role} partisi.`,
    `Bolumun isi: ${section.tonalJob}`,
    `Motife ne yapiyor: ${section.motifTransformation}`,
    `Girisi: ${section.entryIntent}`,
    `Cikisi: ${section.exitIntent}`,
  ];
  if (section.linkToPrevious) lines.push(`Onceki bolume bagi: ${section.linkToPrevious}`);
  if (section.linkToNext) lines.push(`Sonraki bolume bagi: ${section.linkToNext}`);
  if (track) lines.push(`Bu track'in tasidigi: ${track.energyJob}`);
  if (motif) {
    lines.push(
      "Motif:",
      `- ritim: ${motif.rhythmSignature}`,
      `- aksan: ${motif.accentStructure}`,
      `- kontur: ${motif.pitchContour}`,
      `- boslu: ${motif.spaceCharacter}`,
    );
  }
  for (const accent of section.gridAccents ?? []) {
    lines.push(
      `Bar ${accent.barIndex + 1} ${resolutionPromptLabel(accent.resolution)} ` +
        `grid'inde (${accent.intent}): ${accent.purpose}`,
    );
  }
  const techniques = blueprint.requestedTechniques.filter(
    (entry) => entry.sectionKey === sectionKey,
  );
  for (const technique of techniques) {
    lines.push(`Teknik niyeti — ${technique.technique}: ${technique.purpose}`);
  }

  return fit(lines.join("\n"));
}

export function requestFor(
  song: Song,
  turn: TurnSpec,
  candidate: CandidateId,
): CopilotRequest {
  const parsed = copilotRequestSchema.safeParse({
    operation: "arrange_track" as const,
    skill: turn.role,
    sectionId: turn.sectionId,
    targetTrackId: turn.targetTrackId,
    lockedTrackIds: lockedTrackIdsFor(song, turn.targetTrackId),
    instruction: turn.instruction,
    subjectId: `bakeoff-s03-${candidate.toLowerCase()}`,
    idempotencyKey: `s03-${candidate.toLowerCase()}-turn-${turn.index}`,
    song,
  });
  if (!parsed.success) {
    throw new Error(`turn ${turn.index} request invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

/** Exactly what a provider would receive: two messages and the schema. */
export function payloadFor(
  song: Song,
  turn: TurnSpec,
  candidate: CandidateId,
  corrections?: readonly string[],
) {
  const prompt = buildPrompt({
    request: requestFor(song, turn, candidate),
    ...(corrections && corrections.length > 0 ? { corrections: [...corrections] } : {}),
  });
  return {
    system: prompt.system,
    userMessage: prompt.userMessage,
    responseSchema: MODEL_PATCH_JSON_SCHEMA,
    estimatedInputTokens: prompt.estimatedInputTokens,
  };
}

export function runTurn(
  song: Song,
  turn: TurnSpec,
  candidate: CandidateId,
  raw: string,
): TurnOutcome {
  const request = requestFor(song, turn, candidate);

  let stamped = 0;
  const parsed = parseArrangePatch(raw, request, () => {
    stamped += 1;
    return `s03-${candidate.toLowerCase()}-p${turn.index}-${stamped}`;
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

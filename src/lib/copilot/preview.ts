/**
 * The candidate preview (spec 11.4/6-7).
 *
 * A provider answer — or a demo one — never touches the song. It becomes a
 * *candidate*: a whole song built in memory, checked, shown, listened to, and
 * only then accepted by the person looking at it. Spec 11.4/7 is the rule this
 * file exists to keep: the canonical song changes when the user says so.
 *
 * The checks below are the same ones the server runs, in the same order, using
 * the same functions. Spec 11.4/6 asks for the client to validate again, and
 * "again" has to mean the same checks — a second, friendlier implementation on
 * the client would be a hole shaped exactly like the difference between them.
 *
 * Everything here is pure. The React layer owns the state; this owns what the
 * states mean.
 */
import { applyPatch } from "@/lib/copilot/apply";
import { validateArrangeOutput } from "@/lib/copilot/arrange";
import type { CopilotPatch, CopilotRequest } from "@/lib/copilot/contract";
import { checkLockedSurface, contentKey, digestOf, surfaceDigest } from "@/lib/copilot/scope";
import type { Section, Song, Track } from "@/lib/song/schema";
import { validatePatchSize } from "@/lib/validators/patchSize";
import { runValidators } from "@/lib/validators";
import { errorsOnly, warningsOnly, type ValidationIssue } from "@/lib/validators/types";

export type CandidateBlock =
  /** The answer does not describe the surface it was asked about. */
  | { reason: "out_of_scope"; issues: ValidationIssue[] }
  /** More bars than one patch may touch. */
  | { reason: "too_large"; issues: ValidationIssue[] }
  /** The patch could not be applied to this song at all. */
  | { reason: "not_applicable"; detail: string }
  /** Something outside the target track moved. */
  | { reason: "locked_surface"; fields: string[] }
  /** The resulting song fails a hard check. */
  | { reason: "invalid_song"; issues: ValidationIssue[] };

export type DiffSummary = {
  trackId: string;
  trackName: string;
  sectionId: string;
  sectionName: string;
  /** Bars of the target track whose content is not what it was. */
  changedBars: number;
  addedOnsets: number;
  removedOnsets: number;
  warningCount: number;
  errorCount: number;
};

export type CandidateResult =
  | { ok: true; candidate: Song; diff: DiffSummary; warnings: ValidationIssue[] }
  | { ok: false; block: CandidateBlock };

function onsetsOf(section: Section | undefined, trackId: string): number {
  if (!section) return 0;
  return section.bars.reduce((total, bar) => {
    const slots = bar.slots[trackId];
    if (slots === undefined) return total;
    return (
      total +
      slots.filter((slot) => {
        if (Array.isArray(slot)) return slot.length > 0;
        return slot !== null && slot !== "-";
      }).length
    );
  }, 0);
}

function changedBarCount(
  before: Section | undefined,
  after: Section | undefined,
  trackId: string,
): number {
  if (!before || !after) return 0;
  let changed = 0;
  after.bars.forEach((bar, index) => {
    const was = before.bars[index]?.slots[trackId];
    if (digestOf(was ?? null) !== digestOf(bar.slots[trackId] ?? null)) changed += 1;
  });
  return changed;
}

/** What the musician is being asked to accept, in numbers. */
export function diffSummary(
  baseline: Song,
  candidate: Song,
  patch: CopilotPatch,
  issues: readonly ValidationIssue[],
): DiffSummary {
  const before = baseline.sections.find((entry) => entry.id === patch.sectionId);
  const after = candidate.sections.find((entry) => entry.id === patch.sectionId);
  const track: Track | undefined = candidate.tracks.find(
    (entry) => entry.id === patch.targetTrackId,
  );

  const wasOnsets = onsetsOf(before, patch.targetTrackId);
  const nowOnsets = onsetsOf(after, patch.targetTrackId);

  return {
    trackId: patch.targetTrackId,
    trackName: track?.name ?? patch.targetTrackId,
    sectionId: patch.sectionId,
    sectionName: after?.name ?? patch.sectionId,
    changedBars: changedBarCount(before, after, patch.targetTrackId),
    addedOnsets: Math.max(0, nowOnsets - wasOnsets),
    removedOnsets: Math.max(0, wasOnsets - nowOnsets),
    warningCount: warningsOnly(issues).length,
    errorCount: errorsOnly(issues).length,
  };
}

/**
 * Build the candidate, in the order the server uses:
 * shape, then size, then apply, then locked surface, then the whole chain.
 */
export function buildCandidate(
  baseline: Song,
  request: CopilotRequest,
  patch: CopilotPatch,
  /**
   * Injectable so the locked-surface guard can be exercised against an apply
   * that misbehaves. The real one writes to a single surface by construction,
   * which is exactly why the guard needs something that does not in order to
   * be tested at all.
   */
  apply: typeof applyPatch = applyPatch,
): CandidateResult {
  const shape = validateArrangeOutput(request, patch);
  if (shape.length > 0) {
    return { ok: false, block: { reason: "out_of_scope", issues: shape } };
  }

  const size = validatePatchSize(baseline, patch);
  if (size.length > 0) {
    return { ok: false, block: { reason: "too_large", issues: size } };
  }

  const before = surfaceDigest(baseline);
  const applied = apply(baseline, patch);
  if (!applied.ok) {
    return { ok: false, block: { reason: "not_applicable", detail: applied.reason } };
  }

  const moved = checkLockedSurface(before, surfaceDigest(applied.song), {
    sectionId: request.sectionId,
    targetTrackId: request.targetTrackId,
  });
  if (moved.length > 0) {
    return {
      ok: false,
      block: {
        reason: "locked_surface",
        fields: moved.map((violation) => violation.field),
      },
    };
  }

  const issues = runValidators(applied.song);
  const errors = errorsOnly(issues);
  if (errors.length > 0) {
    return { ok: false, block: { reason: "invalid_song", issues: errors } };
  }

  return {
    ok: true,
    candidate: applied.song,
    diff: diffSummary(baseline, applied.song, patch, issues),
    warnings: warningsOnly(issues),
  };
}

/**
 * A diff that reaches past the target track is a bug, wherever it came from.
 * `buildCandidate` already refuses one; this is the same question asked of a
 * diff on its own, for a caller that has one and wants to be sure.
 */
export function touchesOnlyTarget(
  baseline: Song,
  candidate: Song,
  sectionId: string,
  targetTrackId: string,
): boolean {
  return (
    checkLockedSurface(surfaceDigest(baseline), surfaceDigest(candidate), {
      sectionId,
      targetTrackId,
    }).length === 0
  );
}

export { contentKey };

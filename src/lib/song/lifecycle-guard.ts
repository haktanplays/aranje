/**
 * What every lifecycle command does on its way out (spec 13.17, 2L-B §10).
 *
 * A command builds a candidate song and hands it here. The strict schema and
 * the central validator chain judge it — the same schema every localStorage
 * read passes and the same chain every AI patch passes, not a private
 * opinion. An error refuses the whole candidate atomically; warnings ride
 * along with the success, to be shown and not obeyed.
 *
 * The parsed output is what gets returned, which has a useful side effect:
 * zod builds fresh containers, so the result never aliases the input song
 * and "no command mutates its input" is structural rather than disciplined.
 */
import { songSchema, type Song } from "@/lib/song/schema";
import { hasErrors, runValidators, warningsOnly } from "@/lib/validators";
import type {
  GuardResult,
  LifecycleResult,
} from "@/lib/song/lifecycle-types";

/*
 * Generic over the refusal code since 2L-C: the mixer is not a lifecycle
 * command and speaks its own small vocabulary, but it must be judged by
 * exactly the same schema and the same validator chain. One gate, several
 * callers, no second opinion about what a valid song is.
 */
export function guardCandidate(candidate: Song): LifecycleResult;
export function guardCandidate<Code extends string>(
  candidate: Song,
  failCode: Code,
): GuardResult<Code>;
export function guardCandidate(
  candidate: Song,
  failCode: string = "validation_failed",
): GuardResult<string> {
  const parsed = songSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, error: { code: failCode } };
  const issues = runValidators(parsed.data);
  if (hasErrors(issues)) return { ok: false, error: { code: failCode } };
  return { ok: true, song: parsed.data, warnings: warningsOnly(issues) };
}

/**
 * Which index stays active after a delete (spec 2L-B §6/§7).
 *
 * The thing at the deleted index if one remains there, otherwise the one
 * before it. One rule for sections and tracks both, and the same rule the
 * playback normalisation relies on — deterministic, so a test can name the
 * answer.
 */
export function survivorIndex(deletedIndex: number, newLength: number): number {
  return Math.max(0, Math.min(deletedIndex, newLength - 1));
}

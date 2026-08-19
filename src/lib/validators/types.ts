/** Validator result contract (spec 10). */
import type { Song } from "@/lib/song/schema";

export type Severity = "error" | "warning";

export type ValidationIssue = {
  code: string;
  severity: Severity;
  /** Reader-facing text; names the note and the bar where it applies. */
  message: string;
  sectionId?: string;
  barIndex?: number;
  trackId?: string;
  slotIndex?: number;
};

/** Validators are pure functions and never touch the UI (spec 10). */
export type Validator = (song: Song) => ValidationIssue[];

export function hasErrors(issues: readonly ValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

export function errorsOnly(
  issues: readonly ValidationIssue[],
): ValidationIssue[] {
  return issues.filter((issue) => issue.severity === "error");
}

export function warningsOnly(
  issues: readonly ValidationIssue[],
): ValidationIssue[] {
  return issues.filter((issue) => issue.severity === "warning");
}

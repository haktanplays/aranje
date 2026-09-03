/**
 * Nine copies of one sentence, said once (2W §14).
 *
 * ## What the reader was getting
 *
 * A chord written across six strings can raise the same playability warning
 * once per note. The panel then printed it six times, identically, and the
 * list grew until it pushed the controls — and on a short screen the grid —
 * out of the way. The reader learned nothing from copies two through six and
 * lost the music to make room for them.
 *
 * ## What this does
 *
 * Groups by the sentence itself rather than by code, because two codes with
 * the same wording read as one repetition to the person looking at them, and
 * the person is who this is for. Each line keeps its count and the places it
 * came from, so "the same thing, in four places" stays available for a detail
 * view without being shouted six times in the summary.
 *
 * Pure. It takes issues and returns issues about issues; nothing here reads a
 * Song, a DOM or a clock.
 */
import type { Severity, ValidationIssue } from "@/lib/validators/types";

export type WarningLine = {
  readonly message: string;
  /** How many issues collapsed into this line. Always at least one. */
  readonly count: number;
  readonly severity: Severity;
  /** The strongest code among them, for anything that keys off codes. */
  readonly code: string;
  /** Bar numbers this applies to, ascending, without repeats. */
  readonly bars: readonly number[];
};

export type WarningSummary = {
  readonly lines: readonly WarningLine[];
  /** Every issue that went in, so "4 uyarı" is countable and honest. */
  readonly total: number;
  /** True when at least one line stands for more than one issue. */
  readonly collapsed: boolean;
};

/** One line per distinct sentence, in the order they first appeared. */
export function summarizeWarnings(
  issues: readonly ValidationIssue[],
): WarningSummary {
  const byMessage = new Map<string, { line: WarningLine; bars: Set<number> }>();

  for (const issue of issues) {
    const found = byMessage.get(issue.message);
    if (found) {
      if (issue.barIndex !== undefined) found.bars.add(issue.barIndex + 1);
      byMessage.set(issue.message, {
        bars: found.bars,
        line: { ...found.line, count: found.line.count + 1 },
      });
      continue;
    }
    const bars = new Set<number>();
    if (issue.barIndex !== undefined) bars.add(issue.barIndex + 1);
    byMessage.set(issue.message, {
      bars,
      line: {
        message: issue.message,
        count: 1,
        severity: issue.severity,
        code: issue.code,
        bars: [],
      },
    });
  }

  const lines = [...byMessage.values()].map(({ line, bars }) => ({
    ...line,
    bars: [...bars].sort((a, b) => a - b),
  }));

  return {
    lines,
    total: issues.length,
    collapsed: lines.some((line) => line.count > 1),
  };
}

/**
 * One line, as the reader reads it.
 *
 * The count is only spoken when there is more than one, because "1 yerde"
 * beside a single warning is noise dressed as precision. Bars are named when
 * they are known and few — a list of nine bar numbers is the wall of text
 * this function exists to avoid.
 */
export function warningLineText(line: WarningLine): string {
  if (line.count <= 1) return line.message;
  if (line.bars.length > 0 && line.bars.length <= 3) {
    return `${line.message} (${line.bars.map((bar) => `${bar}. ölçü`).join(", ")})`;
  }
  return `${line.message} · ${line.count} yerde`;
}

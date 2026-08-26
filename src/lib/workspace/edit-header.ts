/**
 * What the one line above the staff says while the reader is writing.
 *
 * The focused edit layout replaces the brand header, the view switch and the
 * section navigator with a single compact row, because at `320×700` those
 * three cost more vertical space than the six strings they sit above. What
 * survives is the only context a writer needs — which section, which bar —
 * and the one control that gets them back out.
 *
 * Pure: it takes what navigation already knows and gives back two strings.
 * Nothing here reads the DOM, and nothing here decides whether the layout is
 * focused; that is the surface's question.
 */
import type { SectionRun } from "@/lib/tab/timeline";

export type EditHeaderModel = {
  /** "Ana Riff" — the section being written into. */
  readonly section: string;
  /** "12. ölçü" — the bar in the song's own numbering, or null when none. */
  readonly bar: string | null;
  /** The whole line, for a screen reader, never truncated. */
  readonly label: string;
};

/**
 * The song-wide bar number for a bar key, which is what a reader counts.
 *
 * A key is `sectionId:localBarIndex`; a musician says "the twelfth bar", not
 * "the second bar of the third section". The run knows where each section
 * starts, so the arithmetic lives here rather than in a component.
 */
export function barNumberOf(
  runs: readonly SectionRun[],
  barKey: string | null,
): number | null {
  if (!barKey) return null;
  const split = barKey.lastIndexOf(":");
  if (split <= 0) return null;
  const sectionId = barKey.slice(0, split);
  const local = Number(barKey.slice(split + 1));
  if (!Number.isInteger(local) || local < 0) return null;
  const run = runs.find((entry) => entry.sectionId === sectionId);
  if (!run || local >= run.barCount) return null;
  return run.firstBar + local;
}

export function editHeaderModel(
  runs: readonly SectionRun[],
  viewedSectionId: string,
  activeBarKey: string | null,
): EditHeaderModel {
  const run = runs.find((entry) => entry.sectionId === viewedSectionId);
  const section = run?.name ?? "Bölüm";
  /*
   * The focused bar only counts when it is in the section being looked at. A
   * bar number from somewhere else would be a true number about the wrong
   * music, which is worse than no number.
   */
  const inView = activeBarKey?.startsWith(`${viewedSectionId}:`) === true;
  const number = inView ? barNumberOf(runs, activeBarKey) : null;
  const bar = number === null ? null : `${number}. ölçü`;

  return {
    section,
    bar,
    label: bar === null ? `Düzenleniyor: ${section}` : `Düzenleniyor: ${section}, ${bar}`,
  };
}

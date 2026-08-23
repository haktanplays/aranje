"use client";

/**
 * Where you are in the song, on the tab (spec 13.11, K-42).
 *
 * The tab shows one screenful of bars at a time, so it needs to say which
 * section that is. It used to say it with a wrapping row of chips — one per
 * section, two rows deep on a narrow screen, eighty-nine pixels of a seven
 * hundred pixel phone spent listing places you are not.
 *
 * This says the same thing in one row: the section you are in, how long it is,
 * and a step either side. Jumping somewhere further away is what the section
 * sheet is for, and it is the same list, opened on purpose rather than kept
 * open permanently.
 *
 * It is not shown on the arrangement at all. There, every section is already
 * on screen with its own header — a second list of the same names would be
 * telling the reader something they are looking at.
 */
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type { SectionRun } from "@/lib/tab/timeline";

export function SectionNavigator({
  runs,
  activeSectionId,
  loopSectionId,
  onJump,
  onOpenList,
}: {
  runs: readonly SectionRun[];
  activeSectionId: string | null;
  loopSectionId: string | null;
  onJump: (sectionId: string) => void;
  onOpenList: () => void;
}) {
  if (runs.length === 0) return null;

  /*
   * No fallback to the first section.
   *
   * This used to clamp a missing id to index 0, which is how the stepper spent
   * a whole checkpoint saying "Intro Riff" while the tab was showing Ana Riff:
   * the id it was given came from the transport and often matched nothing, and
   * the clamp turned that into a confident wrong answer. The viewed section is
   * always a real section now (spec 13.20 §3); if it somehow is not, saying
   * nothing is better than saying the wrong thing.
   */
  const index = runs.findIndex((run) => run.sectionId === activeSectionId);
  const current = runs[index];
  const previous = runs[index - 1];
  const next = runs[index + 1];
  if (!current) return null;

  const step = (
    run: SectionRun | undefined,
    label: string,
    glyph: string,
  ) => (
    <button
      type="button"
      onClick={() => run && onJump(run.sectionId)}
      disabled={run === undefined}
      aria-label={run ? `${label}: ${run.name}` : label}
      className="text-muted border-line shrink-0 rounded-lg border disabled:opacity-30"
      style={{ width: MIN_TOUCH_TARGET_PX, height: MIN_TOUCH_TARGET_PX }}
    >
      <span aria-hidden>{glyph}</span>
    </button>
  );

  return (
    <div
      data-section-nav
      className="border-line flex items-center gap-2 border-b px-3 py-0.5"
    >
      {step(previous, "Önceki bölüm", "‹")}

      {/* The middle is a button too: it opens the full list, which is where a
          jump of more than one step belongs. */}
      <button
        type="button"
        onClick={onOpenList}
        aria-label={`Bölüm: ${current.name}, ${current.barCount} ölçü. Tüm bölümler`}
        className="border-line min-w-0 flex-1 rounded-lg border px-2 text-left"
        style={{ minHeight: MIN_TOUCH_TARGET_PX }}
      >
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-sm">{current.name}</span>
          <span className="text-muted shrink-0 text-[11px] tabular-nums">
            {current.barCount} ölçü
          </span>
          {/* Loop is a state of the music, so it is said rather than coloured. */}
          {loopSectionId === current.sectionId ? (
            <span className="text-bronze shrink-0 text-[11px]">döngü</span>
          ) : null}
        </span>
      </button>

      {step(next, "Sonraki bölüm", "›")}
    </div>
  );
}

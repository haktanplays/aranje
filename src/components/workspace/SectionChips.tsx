"use client";

import type { SectionStatus } from "@/lib/song/schema";

export type SectionRun = {
  sectionId: string;
  name: string;
  status: SectionStatus;
  firstBar: number;
  barCount: number;
};

function statusRing(status: SectionStatus, active: boolean): string {
  if (status === "pending") return "border-dashed border-bronze text-bronze";
  if (status === "accepted") return "border-accept/60 text-accept";
  return active ? "border-steel text-text" : "border-line text-muted";
}

/**
 * Compact section strip. Tapping one scrolls the tab to that section.
 *
 * The pill stays visually small — a section marker should not weigh as much as
 * a transport button — but the **button** around it is a full 44px tall, so
 * what a thumb has to hit is the accessible target rather than the drawn
 * outline (spec 13.5). The strip wraps rather than scrolling, so a long song
 * never puts a second horizontal scroller next to the tab's own.
 */
export function SectionChips({
  runs,
  activeSectionId,
  loopSectionId,
  onJump,
}: {
  runs: readonly SectionRun[];
  activeSectionId: string | null;
  loopSectionId?: string | null;
  onJump: (sectionId: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 border-b border-line px-3">
      {runs.map((run) => (
        <button
          key={run.sectionId}
          type="button"
          onClick={() => onJump(run.sectionId)}
          aria-pressed={run.sectionId === activeSectionId}
          className="flex min-h-11 max-w-full shrink-0 items-center"
        >
          <span
            className={`rounded-full border px-3 py-1.5 text-xs whitespace-nowrap ${statusRing(
              run.status,
              run.sectionId === activeSectionId,
            )}`}
          >
            {run.name}
            <span className="text-muted ml-1.5 tabular-nums">
              {run.barCount} ölçü
            </span>
            {loopSectionId === run.sectionId ? (
              <span aria-label="Loop" className="text-bronze ml-1.5">
                &#8635;
              </span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}

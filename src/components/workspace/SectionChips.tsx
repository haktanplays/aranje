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

/** Compact section strip. Tapping one scrolls the tab to that section. */
export function SectionChips({
  runs,
  activeSectionId,
  onJump,
}: {
  runs: readonly SectionRun[];
  activeSectionId: string | null;
  onJump: (sectionId: string) => void;
}) {
  return (
    <div className="flex gap-2 overflow-x-auto border-b border-line px-3 py-2">
      {runs.map((run) => (
        <button
          key={run.sectionId}
          type="button"
          onClick={() => onJump(run.sectionId)}
          className={`min-h-9 shrink-0 rounded-full border px-3 text-xs whitespace-nowrap ${statusRing(
            run.status,
            run.sectionId === activeSectionId,
          )}`}
        >
          {run.name}
          <span className="text-muted ml-1.5 tabular-nums">
            {run.barCount} bar
          </span>
        </button>
      ))}
    </div>
  );
}

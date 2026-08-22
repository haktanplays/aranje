"use client";

/**
 * Every section, on demand (spec 13.11, K-42).
 *
 * The tab's section navigator shows where you are and a step either side,
 * which covers the way people actually move through a song. Jumping four
 * sections at once is a real thing to want and a bad thing to keep a permanent
 * two-row list on screen for, so it lives here — the same names, the same
 * jump, opened when it is wanted.
 *
 * Status is written rather than only coloured: a section waiting for a decision
 * says so, because a dashed border is not something a reader can be expected to
 * translate.
 */
import { Sheet } from "@/components/workspace/Sheet";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type { SectionRun } from "@/lib/tab/timeline";
import type { SectionStatus } from "@/lib/song/schema";

const STATUS_LABELS: Readonly<Record<SectionStatus, string>> = {
  fixed: "",
  pending: "öneri bekliyor",
  accepted: "kabul edildi",
};

export function SectionSheet({
  runs,
  activeSectionId,
  open,
  onJump,
  onClose,
  onManage,
}: {
  runs: readonly SectionRun[];
  activeSectionId: string | null;
  open: boolean;
  onJump: (sectionId: string) => void;
  onClose: () => void;
  /** Hands over to the section manager (spec 13.17, 2L-B). */
  onManage: () => void;
}) {
  if (!open) return null;

  return (
    <Sheet
      open={open}
      title="Bölümler"
      onClose={onClose}
      labelledBy="section-sheet-title"
    >
      <div role="listbox" aria-label="Bölüm seç" className="flex flex-col gap-1">
        {runs.map((run) => {
          const selected = run.sectionId === activeSectionId;
          const status = STATUS_LABELS[run.status];
          return (
            <button
              key={run.sectionId}
              type="button"
              role="option"
              aria-selected={selected}
              data-section-option={run.sectionId}
              onClick={() => {
                onJump(run.sectionId);
                onClose();
              }}
              className={`flex items-baseline justify-between gap-3 rounded-lg border px-3 text-left ${
                selected
                  ? "border-bronze/60 bg-raised text-bronze"
                  : "border-line text-muted"
              }`}
              style={{ minHeight: MIN_TOUCH_TARGET_PX }}
            >
              <span className="truncate text-sm">{run.name}</span>
              <span className="shrink-0 text-[11px] tabular-nums opacity-70">
                {run.barCount} ölçü{status ? ` · ${status}` : ""}
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        data-section-manage
        onClick={onManage}
        className="border-line mt-3 w-full rounded-lg border text-sm"
        style={{ minHeight: MIN_TOUCH_TARGET_PX }}
      >
        Bölümleri düzenle
      </button>
    </Sheet>
  );
}

"use client";

/**
 * Confirming that a project really is to go (spec 13.21 §17, 2O-A).
 *
 * Its own sheet, not a row that turns red. Two reasons, and both were learned
 * the hard way elsewhere in this app: a confirmation that lives inside an
 * action bar disappears when the action bar re-renders, and a destructive
 * choice offered in the same place as the ordinary ones is a choice made by
 * accident.
 *
 * It says what will be lost in the reader's own terms — the name, and how much
 * music — and it offers the way out *first*: backing the project up is the
 * left-hand button, because somebody who is unsure should meet it before they
 * meet the red one. There is no recycle bin behind this and the sheet does not
 * imply one.
 */
import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import { deleteConfirmation } from "@/lib/projects/project-copy";
import type { ProjectSummary } from "@/lib/projects/project-summary";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";

export function ProjectDeleteSheet({
  target,
  onBackup,
  onCancel,
  onDelete,
}: {
  target: ProjectSummary | null;
  onBackup: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  if (!target) return null;

  return (
    <Sheet
      open
      title="Projeyi sil"
      onClose={onCancel}
      labelledBy="project-delete-title"
      footer={
        <div className="flex flex-col gap-2">
          <SheetButton
            data-testid="project-delete-backup"
            onClick={onBackup}
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
          >
            Önce yedekle
          </SheetButton>
          <div className="flex gap-2">
            <SheetButton
              data-testid="project-delete-cancel"
              onClick={onCancel}
              style={{ minHeight: MIN_TOUCH_TARGET_PX }}
            >
              Vazgeç
            </SheetButton>
            <SheetButton
              data-testid="project-delete-confirm"
              tone="danger"
              onClick={onDelete}
              style={{ minHeight: MIN_TOUCH_TARGET_PX }}
            >
              Projeyi sil
            </SheetButton>
          </div>
        </div>
      }
    >
      <p
        data-testid="project-delete-text"
        className="text-text text-sm whitespace-pre-line"
      >
        {deleteConfirmation(target)}
      </p>
    </Sheet>
  );
}

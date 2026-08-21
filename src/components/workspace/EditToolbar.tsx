"use client";

/**
 * The compact strip that turns editing on (spec 13.1, 13.10).
 *
 * Three controls and no more: the main surface stays the music. Every choice
 * these open lives in a sheet, so nothing here grows into a form.
 *
 * On the arrangement surface the edit toggle is not shown, because there is no
 * tab on screen for it to act on — a button whose target is not there is worse
 * than a missing one. "Aranje et" and undo stay: the first opens a sheet and
 * works from either surface, and the second belongs to the song rather than to
 * whichever view happens to be up.
 */
export function EditToolbar({
  editing,
  canEdit,
  editDisabledReason,
  onToggleEdit,
  onArrange,
  arrangeDisabled,
  canUndo,
  onUndo,
  showUndo = true,
  canToggleEdit = true,
}: {
  editing: boolean;
  canEdit: boolean;
  /** Why editing is unavailable, said plainly rather than by a dead button. */
  editDisabledReason: string | null;
  onToggleEdit: () => void;
  onArrange: () => void;
  arrangeDisabled: boolean;
  canUndo: boolean;
  onUndo: () => void;
  /** Hidden while the selection strip carries its own undo (spec 13.8). */
  showUndo?: boolean;
  /** False on a surface with no tab to edit (spec 13.10). */
  canToggleEdit?: boolean;
}) {
  return (
    <div className="border-line flex flex-col gap-1 border-t px-3 py-1.5">
      <div className="flex items-center gap-2">
        {canToggleEdit ? (
          <button
            type="button"
            onClick={onToggleEdit}
            disabled={!canEdit}
            aria-pressed={editing}
            className={`min-h-11 flex-1 rounded-lg border px-3 text-sm disabled:opacity-40 ${
              editing ? "border-bronze text-bronze" : "border-line text-muted"
            }`}
          >
            {editing ? "Düzenlemeyi bitir" : "Düzenle"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onArrange}
          disabled={arrangeDisabled}
          className="text-muted min-h-11 flex-1 rounded-lg border border-line px-3 text-sm disabled:opacity-40"
        >
          Aranje et
        </button>
        {showUndo ? (
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Son değişikliği geri al"
            className="text-muted min-h-11 min-w-11 rounded-lg border border-line text-sm disabled:opacity-40"
          >
            <span aria-hidden>&#8630;</span>
          </button>
        ) : null}
      </div>
      {canToggleEdit && editDisabledReason ? (
        <p role="status" className="text-muted text-[11px]">
          {editDisabledReason}
        </p>
      ) : null}
      {editing ? (
        <p role="status" className="text-bronze text-[11px]">
          Düzenleme açık — bir tel ve slot seç.
        </p>
      ) : null}
    </div>
  );
}

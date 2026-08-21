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
    <div data-action-row className="border-line flex flex-col border-t px-3 py-0.5">
      <div className="flex items-center gap-2">
        {canToggleEdit ? (
          <button
            type="button"
            onClick={onToggleEdit}
            disabled={!canEdit}
            aria-pressed={editing}
            className={`min-h-11 flex-1 rounded-lg border px-3 text-sm font-medium disabled:opacity-40 ${
              editing
                ? "border-bronze bg-bronze/15 text-bronze"
                : "border-bronze/60 text-bronze"
            }`}
          >
            {editing ? "Düzenlemeyi bitir" : "Düzenle"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onArrange}
          disabled={arrangeDisabled}
          /*
           * Secondary, and sized like it. It was the widest thing on the
           * screen while the Copilot may not even be configured — a fail-closed
           * button has no business being the largest promise on the surface.
           * Disabled it still says why, through `arrangeDisabled` upstream.
           */
          className="text-muted border-line min-h-11 shrink-0 rounded-lg border px-3 text-sm disabled:opacity-40"
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
      {/*
        Both of these are transient. They get a line when they have something
        to say and none when they do not, rather than reserving one for ever.
      */}
      {canToggleEdit && editDisabledReason ? (
        <p role="status" className="text-muted pt-1 text-[11px]">
          {editDisabledReason}
        </p>
      ) : null}
      {editing ? (
        <p role="status" className="text-bronze pt-1 text-[11px]">
          Düzenleme açık — bir tel ve slot seç.
        </p>
      ) : null}
    </div>
  );
}

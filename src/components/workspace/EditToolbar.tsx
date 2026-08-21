"use client";

/**
 * The compact strip that turns editing on (spec 13.1, 13.10).
 *
 * Three controls and no more: the main surface stays the music. Every choice
 * these open lives in a sheet, so nothing here grows into a form.
 *
 * On the arrangement surface the edit toggle is not shown, because there is no
 * tab on screen for it to act on — a button whose target is not there is worse
 * than a missing one. "Aranje et" and the history controls stay: the first
 * opens a sheet and works from either surface, and the second pair belongs to
 * the song rather than to whichever view happens to be up.
 *
 * ## Undo and redo are two controls
 *
 * Not one that changes meaning. A single button that undoes until you shift-
 * click it is a button whose behaviour the reader has to remember; two are
 * ninety pixels of a row that has room for them, and each says what it would
 * do — "Geri al: Ölçüleri silme" rather than "Geri al". They stay on screen
 * when there is nothing to do, disabled: a control that appears and vanishes
 * moves everything beside it, which on a phone means the reader's next tap
 * lands somewhere they did not aim.
 */
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
export function EditToolbar({
  editing,
  canEdit,
  editDisabledReason,
  onToggleEdit,
  onArrange,
  arrangeDisabled,
  canUndo,
  canRedo,
  undoLabel,
  redoLabel,
  onUndo,
  onRedo,
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
  canRedo: boolean;
  /** "Geri al: Ölçüleri silme" — from the one label table (spec 13.13). */
  undoLabel: string;
  redoLabel: string;
  onUndo: () => void;
  onRedo: () => void;
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
        <button
          type="button"
          data-undo
          onClick={onUndo}
          disabled={!canUndo}
          aria-label={undoLabel}
          title={undoLabel}
          className="text-muted border-line shrink-0 rounded-lg border text-sm disabled:opacity-40"
          style={{ minHeight: MIN_TOUCH_TARGET_PX, minWidth: MIN_TOUCH_TARGET_PX }}
        >
          <span aria-hidden>&#8630;</span>
        </button>
        <button
          type="button"
          data-redo
          onClick={onRedo}
          disabled={!canRedo}
          aria-label={redoLabel}
          title={redoLabel}
          className="text-muted border-line shrink-0 rounded-lg border text-sm disabled:opacity-40"
          style={{ minHeight: MIN_TOUCH_TARGET_PX, minWidth: MIN_TOUCH_TARGET_PX }}
        >
          <span aria-hidden>&#8631;</span>
        </button>
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

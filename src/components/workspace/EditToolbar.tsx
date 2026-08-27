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
 * ## The row wraps rather than clipping
 *
 * Both labels grow with the reader's text setting — "Aranje et" goes from 85
 * to 127px between 100% and 150%, "Düzenlemeyi bitir" from 117 to 168 — and a
 * flex item cannot shrink below the width of its own words. On one fixed line
 * that arithmetic runs off the screen: measured at 419px of content in a
 * 284px row at 320px and 150% text, with 135px of it simply gone. Not
 * scrolled away — gone, because the row is not a scroller.
 *
 * So the row wraps, which is what the transport row already does at the same
 * setting (K-56). Nothing is removed, no target shrinks, no label is cut, and
 * at the sizes where everything fit before it still fits on one line. The
 * history pair wraps as a pair: undo and redo belong beside each other, and a
 * lone redo on a second line is a worse row than two of them.
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
  /*
   * One way out, not two (K-59 §4).
   *
   * While editing, the focused edit header already carries "Bitti" at the top
   * of the screen. A second "Düzenlemeyi bitir" down here was the widest
   * control in the row — 117px at 100% text and 168px at 150% — and it was
   * the reason this row wrapped to two lines on a 320px screen. Leaving a
   * mode should be one control in one place.
   */
  const showToggle = canToggleEdit && !editing;

  return (
    <div data-action-row className="border-line flex flex-col border-t px-3 py-0.5">
      <div className="flex flex-wrap items-center gap-2">
        {showToggle ? (
          <button
            type="button"
            onClick={onToggleEdit}
            disabled={!canEdit}
            aria-pressed={editing}
            /*
             * The touch minimum is 44 **pixels**, not 2.75rem. `min-h-11`
             * grows with the reader's text setting, so at 150% each row of
             * this strip was 66px tall for a reason that had nothing to do
             * with the words in it — and on a 320px screen that is a third of
             * the music. The same correction the transport row got in K-56.
             */
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
            className={`min-w-0 flex-1 basis-32 rounded-lg border px-3 text-sm font-medium disabled:opacity-40 ${
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
          style={{ minHeight: MIN_TOUCH_TARGET_PX }}
          className="text-muted border-line shrink-0 rounded-lg border px-3 text-sm disabled:opacity-40"
        >
          Aranje et
        </button>
        <div data-history-pair className="flex shrink-0 items-center gap-2">
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
      </div>
      {/*
        Both of these are transient. They get a line when they have something
        to say and none when they do not, rather than reserving one for ever.
      */}
      {showToggle && editDisabledReason ? (
        <p role="status" className="text-muted pt-1 text-[11px]">
          {editDisabledReason}
        </p>
      ) : null}
      {/*
        The "editing is on" line is gone: the intent doors above the row are
        the sign that it is, and they say it in controls rather than in a
        sentence. On a 320px screen at 150% text that sentence cost two lines
        of the music (2S-A §11).
      */}
    </div>
  );
}

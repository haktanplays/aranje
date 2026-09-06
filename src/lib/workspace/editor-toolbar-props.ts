/**
 * The edit toolbar's props, assembled once (2V-D.2 c2, §23).
 *
 * Eighteen lines of pure assembly used to sit inline in the composition root
 * — no decisions in it, just five different sources gathered into the shape
 * one component wants. That is exactly the kind of thing a composition root
 * should be handing off rather than doing, and it is the extraction that made
 * room for the metre controller without moving a line budget.
 *
 * Two of the fields are real rules rather than pass-throughs, and they are
 * the reason this is a function and not an object literal somewhere else:
 * arranging is refused while a preview is open or nothing can be persisted,
 * and the edit toggle does not exist on the arrangement, which has no staff.
 */

export type ToolbarChrome = {
  readonly canEdit: boolean;
  readonly editDisabledReason: string | null;
  readonly canPersist: boolean;
  readonly previewOpen: boolean;
  readonly skillCount: number;
  readonly onArrange: () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string;
  readonly redoLabel: string;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
};

export function editorToolbarProps(
  editing: { readonly editing: boolean; readonly toggleEdit: () => void },
  view: string,
  chrome: ToolbarChrome,
) {
  return {
    editing: editing.editing,
    onToggleEdit: editing.toggleEdit,
    canEdit: chrome.canEdit,
    editDisabledReason: chrome.editDisabledReason,
    onArrange: chrome.onArrange,
    /* Arranging is refused while a preview is on the screen or the song
       cannot be saved: a second proposal over the first is two answers to
       one question, and one that cannot be kept is worse than none. */
    arrangeDisabled:
      chrome.skillCount === 0 || chrome.previewOpen || !chrome.canPersist,
    canUndo: chrome.canUndo,
    canRedo: chrome.canRedo,
    undoLabel: chrome.undoLabel,
    redoLabel: chrome.redoLabel,
    onUndo: chrome.onUndo,
    onRedo: chrome.onRedo,
    /* Both notation surfaces have a staff to edit; the arrangement does not,
       so the toggle is not offered there at all (2Q-A §8). */
    canToggleEdit: view !== "arrange",
  };
}

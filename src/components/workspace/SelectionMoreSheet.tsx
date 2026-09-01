"use client";

/**
 * What did not fit on the row (2V-B §6).
 *
 * One sheet for both note-selection surfaces, and the reason it is one is the
 * defect it was written to close: the reading surface had a "Daha fazla" whose
 * contents were a hard-coded pair — "Seçimi sil" and, sometimes, "Yapıştır" —
 * while the edit surface had a different hard-coded list that carried the two
 * listening verbs. A founder pressed the first one and found a sheet with a
 * verb already on the grid behind it and nothing else.
 *
 * So this draws what it is given and decides nothing. Which entries a sheet
 * holds is the canon's answer, and it differs between the two modes because
 * the rows in front of them differ — never because the sheets disagree about
 * what the selection can do.
 */
import { Sheet } from "@/components/workspace/Sheet";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type {
  SelectionActionId,
  SelectionActionOffer,
} from "@/lib/song/selection-action-canon";

export function SelectionMoreSheet({
  open,
  actions,
  onRun,
  onClose,
}: {
  readonly open: boolean;
  /** Already filtered to `more_sheet`, in the canon's order. */
  readonly actions: readonly SelectionActionOffer[];
  readonly onRun: (id: SelectionActionId) => void;
  readonly onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      title="Seçimle ne yapılsın?"
      onClose={onClose}
      labelledBy="selection-more-title"
    >
      <h2 id="selection-more-title" className="sr-only">
        Seçimle ne yapılsın?
      </h2>
      <div className="flex flex-col gap-2">
        {actions.map((action) => {
          const off = action.availability === "disabled";
          return (
            <button
              key={action.id}
              type="button"
              data-selection-action={action.label}
              data-selection-action-id={action.id}
              onClick={() => {
                onRun(action.id);
                /*
                 * Only when nothing else opened. "Yapıştır" stages and opens
                 * the paste sheet; closing this one on the way out closed that
                 * one too, and a reader who pressed it got nothing at all.
                 */
                if (action.opens === "immediate") onClose();
              }}
              disabled={off}
              /*
               * The reason travels with the control rather than waiting for a
               * press. A reader learns "Panoda bir şey yok." from a grey
               * entry; they learn nothing from one that looks live and refuses.
               */
              aria-label={off ? `${action.label} — ${action.reason}` : action.label}
              className={`rounded-lg border px-3 py-2 text-left ${
                off ? "border-line/50" : "border-line"
              }`}
              style={{ minHeight: MIN_TOUCH_TARGET_PX }}
            >
              <span className={`block text-sm ${off ? "text-muted/40" : "text-text"}`}>
                {action.label}
              </span>
              <span className="text-muted block text-[11px]">
                {off ? action.reason : action.hint}
              </span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

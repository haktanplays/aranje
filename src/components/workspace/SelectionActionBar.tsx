"use client";

/**
 * What you can do with a selection (spec 13.1).
 *
 * Seven primary actions, fixed, plus a "Daha fazla" sheet for the rest.
 *
 * Four columns, so the seven wrap to two rows. One row was the first attempt
 * and it does not survive arithmetic: seven 44px targets with gaps and padding
 * need 348px, and the narrowest screen this pilot supports is 320. The row did
 * fit — by letting every button shrink to 40px wide, which is under the
 * minimum and was measured that way on a real 320px viewport. Wrapping is what
 * gives up; the touch target is not the thing to give up, and neither is the
 * rule that this screen has exactly one horizontal scroller, which is the tab.
 *
 * The column count does not change with the viewport. A toolbar that reflows
 * between phones is a toolbar whose buttons are somewhere else on a friend's
 * screen, and these seven are meant to be found without looking.
 *
 * Every control is a real button with a real name. Nothing here is a bare icon
 * with a tooltip, because a tooltip is not available to a finger.
 */
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";

export type SelectionAction =
  | "copy"
  | "cut"
  | "duplicate"
  | "repeat"
  | "move"
  | "delete"
  | "more";

const PRIMARY: readonly { readonly action: SelectionAction; readonly label: string }[] = [
  { action: "copy", label: "Kopyala" },
  { action: "cut", label: "Kes" },
  { action: "duplicate", label: "Çoğalt" },
  { action: "repeat", label: "Tekrarla" },
  { action: "move", label: "Taşı" },
  { action: "delete", label: "Sil" },
  { action: "more", label: "Daha fazla" },
];

export type SelectionActionBarProps = {
  readonly summary: string;
  readonly notice?: string | null;
  readonly error?: string | null;
  readonly onAction: (action: SelectionAction) => void;
  readonly onCancel: () => void;
};

export function SelectionActionBar({
  summary,
  notice,
  error,
  onAction,
  onCancel,
}: SelectionActionBarProps) {
  return (
    <div
      data-testid="selection-action-bar"
      className="border-app bg-app safe-bottom border-t"
      role="toolbar"
      aria-label="Seçim işlemleri"
    >
      {/* The summary is the only place the selection is described, and it is
          described in music, never in ticks. */}
      <div className="flex items-center justify-between gap-2 px-3 pt-2">
        <p data-testid="selection-summary" className="text-muted truncate text-sm">
          {summary}
        </p>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Seçimi iptal et"
          className="text-muted shrink-0 px-2 text-sm underline"
          style={{ minHeight: MIN_TOUCH_TARGET_PX }}
        >
          İptal
        </button>
      </div>

      {error ? (
        <p data-testid="selection-error" role="alert" className="px-3 pt-1 text-sm text-red-600">
          {error}
        </p>
      ) : null}
      {!error && notice ? (
        // Calm on purpose: a warning that survived a successful commit is
        // information, not a failure.
        <p data-testid="selection-notice" role="status" className="text-muted px-3 pt-1 text-sm">
          {notice}
        </p>
      ) : null}

      <div className="grid grid-cols-4 gap-1 p-2">
        {PRIMARY.map((entry) => (
          <button
            key={entry.action}
            type="button"
            data-testid={`selection-action-${entry.action}`}
            onClick={() => onAction(entry.action)}
            aria-label={entry.label}
            className="border-app flex flex-col items-center justify-center rounded-md border px-0.5 text-[10px] leading-tight"
            style={{
              minHeight: MIN_TOUCH_TARGET_PX,
              minWidth: MIN_TOUCH_TARGET_PX,
            }}
          >
            <span className="truncate">{entry.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

"use client";

/**
 * What you can do with a selection (spec 13.1).
 *
 * Seven primary actions, fixed, plus a "Daha fazla" sheet for the rest. They
 * stay on one row at 320px because the row scrolls nothing: adding a second
 * horizontal scroller to a screen whose tab is deliberately the only one is
 * how a reader loses track of which thing their finger is moving.
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

      <div className="grid grid-cols-7 gap-1 p-2">
        {PRIMARY.map((entry) => (
          <button
            key={entry.action}
            type="button"
            data-testid={`selection-action-${entry.action}`}
            onClick={() => onAction(entry.action)}
            aria-label={entry.label}
            className="border-app flex flex-col items-center justify-center rounded-md border px-0.5 text-[10px] leading-tight"
            style={{ minHeight: MIN_TOUCH_TARGET_PX, minWidth: 0 }}
          >
            <span className="truncate">{entry.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

"use client";

/**
 * What you can do with a selection (spec 13.1).
 *
 * Eight primary targets, plus a "Daha fazla" sheet for the rest.
 *
 * Four columns, so the eight wrap to two rows. One row was the first attempt
 * and it does not survive arithmetic: seven 44px targets with gaps and padding
 * need 348px, and the narrowest screen this pilot supports is 320. The row did
 * fit — by letting every button shrink to 40px wide, which is under the
 * minimum and was measured that way on a real 320px viewport. Wrapping is what
 * gives up; the touch target is not the thing to give up, and neither is the
 * rule that this screen has exactly one horizontal scroller, which is the tab.
 *
 * The column count does not change with the viewport. A toolbar that reflows
 * between phones is a toolbar whose buttons are somewhere else on a friend's
 * screen, and these are meant to be found without looking.
 *
 * Every control is a real button with a real name. Nothing here is a bare icon
 * with a tooltip, because a tooltip is not available to a finger.
 *
 * ## Why the list is not in this file (2V-B §2)
 *
 * It was, and twice a verb the capability model offered never reached the
 * screen because of it: "Yapıştır" in 2U-B and "Devam" in 2V-A.1. Both were
 * found by a person holding a phone, and both were fixed by adding one entry
 * to this one list — which is not a fix, it is the next one waiting.
 *
 * So the entries come from `selection-action-canon.ts` now, already placed,
 * already labelled and already carrying the model's answer. This file draws
 * eight targets in four columns and knows nothing about which eight.
 */
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type {
  SelectionActionId,
  SelectionActionOffer,
} from "@/lib/song/selection-action-canon";

/**
 * What a press means, for the area that wires them.
 *
 * The same ids the canon uses, so a control this bar draws and a handler the
 * area runs cannot be named differently.
 */
export type SelectionAction = SelectionActionId;

export type SelectionActionBarProps = {
  readonly summary: string;
  readonly notice?: string | null;
  readonly error?: string | null;
  /**
   * The eight, already placed on this surface by the canon (2V-B §3).
   *
   * Empty means nothing is held. A verb the model greys arrives greyed, with
   * the model's own sentence, so the reader learns the rule from the control
   * rather than from a refusal.
   */
  readonly actions: readonly SelectionActionOffer[];
  /** True while "Devam" is waiting for the reader to say where to reach to. */
  readonly extendArmed?: boolean;
  readonly onAction: (action: SelectionAction) => void;
  readonly onCancel: () => void;
};

export function SelectionActionBar({
  summary,
  notice,
  error,
  actions,
  extendArmed = false,
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
        {actions.map((entry) => {
          const off = entry.availability === "disabled";
          const armed = entry.id === "extend" && extendArmed;
          return (
            <button
              key={entry.id}
              type="button"
              data-testid={`selection-action-${entry.id}`}
              /* The canon's id, on every surface that draws one (2V-B §10). */
              data-selection-action-id={entry.id}
              onClick={() => onAction(entry.id)}
              disabled={off}
              /*
               * The reason travels with the control rather than waiting for a
               * press: a reader learns "Uzatılacak yer kalmadı." from a grey
               * button and nothing at all from one that looks live and refuses.
               *
               * The accessible name stays the verb when the control is live,
               * which is what UI Contract v1 asks for — "Devam", not
               * "Devam — …".
               */
              title={off ? entry.reason : undefined}
              aria-label={off ? `${entry.label} — ${entry.reason}` : entry.label}
              /* "Devam" is armed or not; nothing else here is a toggle. */
              aria-pressed={entry.id === "extend" ? extendArmed : undefined}
              className={`flex flex-col items-center justify-center rounded-md border px-0.5 text-[10px] leading-tight ${
                off
                  ? "border-app/50 text-muted/40"
                  : armed
                    ? "border-accent bg-accent/10 text-text"
                    : "border-app"
              }`}
              style={{
                minHeight: MIN_TOUCH_TARGET_PX,
                minWidth: MIN_TOUCH_TARGET_PX,
              }}
            >
              <span className="truncate">{entry.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

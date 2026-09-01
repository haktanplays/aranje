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
 *
 * ## Why "Devam" is here, and was not (2V-A.1 §2)
 *
 * A founder on a real phone held a power chord, was told to press "Devam",
 * and had seven buttons in front of them that did not include it. The
 * capability model had been offering `extend` all along; the compact toolbar
 * had been drawing it since K-59. This bar had not, because its verbs were a
 * hard-coded list that asked the model nothing — the same shape as the 2U-B
 * clipboard defect, where "Yapıştır" was offered by the model and absent from
 * the list that draws.
 *
 * So the list is eight now, and every entry's state comes from the model:
 * offered and live, or greyed with the model's own sentence. Eight targets in
 * a four-column grid is the same two rows seven made, so nothing below moved
 * and no string was lost to it.
 */
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type { SelectionVerb, VerbOffer } from "@/lib/song/selection-capability";

export type SelectionAction =
  | "copy"
  | "cut"
  | "duplicate"
  | "repeat"
  | "move"
  | "extend"
  | "delete"
  | "more";

/**
 * The eight, in the order a finger finds them.
 *
 * "Devam" sits beside "Taşı" because the two are the reaches — one moves what
 * is held, the other grows it — and "Daha fazla" stays last, a door after the
 * verbs rather than one of them.
 *
 * `verb` is how each control asks the capability model what it may do. "Daha
 * fazla" has none: a door is not a verb, and it opens whatever the drawer has
 * left to offer.
 */
const PRIMARY: readonly {
  readonly action: SelectionAction;
  readonly label: string;
  readonly verb: SelectionVerb | null;
}[] = [
  { action: "copy", label: "Kopyala", verb: "copy" },
  { action: "cut", label: "Kes", verb: "cut" },
  { action: "duplicate", label: "Çoğalt", verb: "duplicate" },
  { action: "repeat", label: "Tekrarla", verb: "repeat" },
  { action: "move", label: "Taşı", verb: "move_time" },
  { action: "extend", label: "Devam", verb: "extend" },
  { action: "delete", label: "Sil", verb: "delete" },
  { action: "more", label: "Daha fazla", verb: null },
];

export type SelectionActionBarProps = {
  readonly summary: string;
  readonly notice?: string | null;
  readonly error?: string | null;
  /**
   * What this selection may be asked to do (2U-A §3).
   *
   * Empty means "nothing has been computed", and every control stays live —
   * the state this bar was always in before the model reached it. A verb the
   * model greys is drawn greyed here, with the model's own sentence, so the
   * reader learns the rule from the control rather than from a refusal.
   */
  readonly offers?: readonly VerbOffer[];
  /** True while "Devam" is waiting for the reader to say where to reach to. */
  readonly extendArmed?: boolean;
  readonly onAction: (action: SelectionAction) => void;
  readonly onCancel: () => void;
};

export function SelectionActionBar({
  summary,
  notice,
  error,
  offers,
  extendArmed = false,
  onAction,
  onCancel,
}: SelectionActionBarProps) {
  const stateOf = (verb: SelectionVerb | null) =>
    verb === null ? null : (offers?.find((offer) => offer.verb === verb)?.state ?? null);
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
        {PRIMARY.map((entry) => {
          const state = stateOf(entry.verb);
          const off = state?.kind === "disabled";
          const armed = entry.action === "extend" && extendArmed;
          return (
            <button
              key={entry.action}
              type="button"
              data-testid={`selection-action-${entry.action}`}
              onClick={() => onAction(entry.action)}
              disabled={off}
              /*
               * The reason travels with the control rather than waiting for a
               * press: a reader learns "Uzatılacak yer kalmadı." from a grey
               * button and nothing at all from one that looks live and refuses.
               *
               * The accessible name stays the verb when the control is live,
               * which is what §5 asks for — "Devam", not "Devam — …".
               */
              title={off ? state.reason : undefined}
              aria-label={off ? `${entry.label} — ${state.reason}` : entry.label}
              /* "Devam" is armed or not; nothing else here is a toggle. */
              aria-pressed={entry.action === "extend" ? extendArmed : undefined}
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

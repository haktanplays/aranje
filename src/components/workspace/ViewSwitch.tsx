"use client";

/**
 * Which of the two surfaces is on screen (spec 13.10, K-39).
 *
 * Two real working modes, not a toggle between a view and a placeholder. The
 * arrangement answers "what shape is this song"; the tab answers "what do I
 * play here". Neither is a mode of the other, so neither is hidden behind a
 * menu — both are one tap away at all times, and the tap target is a real one.
 *
 * ## A segmented control, not two cards
 *
 * It started as two full-height buttons and took fifty-seven pixels of a seven
 * hundred pixel screen to say one word each. The two live in one bordered
 * track now, sharing it: gold fill marks the surface you are on, and the strip
 * as a whole reads as one control with two states rather than as two choices
 * competing for attention. The tap target is still forty-four pixels tall —
 * the strip is what shrank, not the thing your finger has to hit.
 *
 * The labels do not change with the state. "Düzene dön" was clearer about what
 * the button *does* from the tab, and wrong about what the control *is*: a
 * segmented control whose segments rename themselves is a control you have to
 * re-read every time you look at it.
 *
 * ## Above the sheets
 *
 * A sheet's backdrop covers the screen at z-30, and it covered this too: with a
 * move staged, the reader could not reach either surface — the only way out was
 * to notice that tapping the dimmed area dismisses it. Primary navigation is
 * not something a transient editing sheet gets to trap, so this strip sits
 * above them. Leaving for the arrangement closes the sheet and drops what it
 * had staged, which is what a pending command is for.
 */
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";

export type WorkspaceView = "arrange" | "tab";

const VIEWS: readonly { readonly id: WorkspaceView; readonly label: string }[] = [
  { id: "arrange", label: "Düzen" },
  { id: "tab", label: "Tab" },
];

export function ViewSwitch({
  view,
  onChange,
}: {
  view: WorkspaceView;
  onChange: (view: WorkspaceView) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Görünüm"
      data-view-switch
      className="bg-app border-line relative z-40 flex border-b px-3"
    >
      <div className="border-line bg-raised/40 flex flex-1 gap-0.5 rounded-lg border">
      {VIEWS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="tab"
          data-testid={`view-${entry.id}`}
          aria-selected={view === entry.id}
          onClick={() => onChange(entry.id)}
          className={`flex-1 rounded-md text-sm transition-colors ${
            view === entry.id
              ? "bg-bronze/15 text-bronze font-medium"
              : "text-muted"
          }`}
          /*
           * The strip is what shrank, not the target. Forty-four pixels is the
           * finger's minimum and it is not negotiable; the seventeen pixels
           * this checkpoint gave back came from the padding around it.
           */
          style={{ minHeight: MIN_TOUCH_TARGET_PX }}
        >
          {entry.label}
        </button>
      ))}
      </div>
    </div>
  );
}

"use client";

/**
 * Which of the two surfaces is on screen (spec 13.10, K-39).
 *
 * Two real working modes, not a toggle between a view and a placeholder. The
 * arrangement answers "what shape is this song"; the tab answers "what do I
 * play here". Neither is a mode of the other, so neither is hidden behind a
 * menu — both are one tap away at all times, and the tap target is a real one.
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

/**
 * The way back, named for what it does from where you are.
 *
 * From the tab, "Düzen" is a destination you are returning to, so it says so.
 * A second, separate "Düzene dön" button would be a duplicate of this one — two
 * controls doing exactly the same thing, which is how a toolbar starts lying
 * about how many choices it offers. One control, correctly named in each state.
 */
function labelFor(entry: (typeof VIEWS)[number], view: WorkspaceView): string {
  if (entry.id === "arrange" && view === "tab") return "Düzene dön";
  return entry.label;
}

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
      className="bg-app border-line relative z-40 flex gap-1 border-b px-3 py-1.5"
    >
      {VIEWS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          role="tab"
          data-testid={`view-${entry.id}`}
          aria-selected={view === entry.id}
          onClick={() => onChange(entry.id)}
          className={`flex-1 rounded-lg border text-sm ${
            view === entry.id
              ? "border-bronze text-bronze bg-bronze/8"
              : "border-line text-muted"
          }`}
          style={{ minHeight: MIN_TOUCH_TARGET_PX }}
        >
          {labelFor(entry, view)}
        </button>
      ))}
    </div>
  );
}

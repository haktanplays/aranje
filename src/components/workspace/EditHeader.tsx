"use client";

/**
 * The one row above the staff while the reader is writing (2S-A §18).
 *
 * ## Why the normal chrome stands down
 *
 * Measured, not assumed: at `320×700` the brand header, the view switch and
 * the section navigator together leave the staff `44px` — and the staff needs
 * `6 × 44 + 22 = 286px` for six strings a finger can actually hit. Writing is
 * a mode with one job, so while it is on, the three rows that are about
 * *getting somewhere else* give their space to the music and one compact row
 * takes their place.
 *
 * It says the two things a writer needs — which section, which bar — and
 * carries the way out. "Bitti" is a real control at the full touch height,
 * because leaving a mode must never be the hardest thing in it.
 *
 * A long section name is allowed to be cut on screen. It is **not** cut for a
 * screen reader: the accessible name on the row carries the whole line.
 */
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type { EditHeaderModel } from "@/lib/workspace/edit-header";

export function EditHeader({
  model,
  onDone,
}: {
  model: EditHeaderModel;
  onDone: () => void;
}) {
  return (
    <div
      data-edit-header
      role="group"
      aria-label={model.label}
      className="border-line flex items-center gap-2 border-b px-3"
      style={{ minHeight: MIN_TOUCH_TARGET_PX }}
    >
      <button
        type="button"
        data-edit-done
        onClick={onDone}
        className="border-bronze/60 text-bronze shrink-0 rounded-lg border px-3 text-sm font-medium"
        style={{ minHeight: MIN_TOUCH_TARGET_PX }}
      >
        Bitti
      </button>
      <p className="text-text min-w-0 flex-1 truncate text-sm" title={model.label}>
        <span data-edit-header-section>{model.section}</span>
        {model.bar ? (
          <>
            <span aria-hidden className="text-muted px-1">
              ·
            </span>
            <span data-edit-header-bar className="text-muted">
              {model.bar}
            </span>
          </>
        ) : null}
      </p>
    </div>
  );
}

"use client";

/**
 * What the app says when something went wrong with the saved file
 * (spec 13.14, K-45).
 *
 * One compact strip, four possible sentences, and none of them is written
 * here — they come from the one table in `storage.ts`. That is the whole
 * defence against a musician being shown a schema path, a parse offset or the
 * name of a browser API: there is no code path from a diagnostic to this
 * component, because this component takes a *state*, not a message.
 *
 * ## It does not take the screen away
 *
 * A recovery is bad news about a file, not about the song in front of the
 * reader. The transport keeps working, both surfaces keep working, and the
 * banner can be put down. The one exception is a file from a newer version:
 * there, editing is genuinely unsafe, so the banner stays as the explanation
 * for controls that are disabled — and it is the disabled controls, not the
 * banner, that stop the reader.
 */
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type { RecoveryState } from "@/lib/song/storage";

export function RecoveryBanner({
  state,
  message,
  onDismiss,
}: {
  state: RecoveryState;
  /** From `RECOVERY_MESSAGES`. Never assembled at the call site. */
  message: string;
  onDismiss: () => void;
}) {
  /*
   * A file from a newer version is the only one that cannot be put down,
   * because it is the reason half the controls below are disabled. Dismissing
   * it would leave the reader looking at an app that refuses to edit and no
   * longer says why.
   */
  const canDismiss = state !== "unsupported_version";

  return (
    <div
      data-recovery-banner={state}
      role="status"
      className="border-reject/50 bg-raised flex items-start gap-2 border-b py-1 pr-1 pl-3"
    >
      <p className="min-w-0 flex-1 self-center py-1 text-xs">{message}</p>
      {canDismiss ? (
        <button
          type="button"
          data-recovery-dismiss
          onClick={onDismiss}
          aria-label="Bildirimi kapat"
          className="text-muted shrink-0 rounded-lg text-sm"
          style={{ minHeight: MIN_TOUCH_TARGET_PX, minWidth: MIN_TOUCH_TARGET_PX }}
        >
          <span aria-hidden>&#10005;</span>
        </button>
      ) : (
        /* Keeps the row the same height as the dismissible ones, so the
           surface below does not jump between recovery states. */
        <span
          aria-hidden
          className="shrink-0"
          style={{ minHeight: MIN_TOUCH_TARGET_PX, minWidth: MIN_TOUCH_TARGET_PX }}
        />
      )}
    </div>
  );
}

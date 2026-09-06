"use client";

/**
 * Whether the reader's last edit is on the device (2V-E.1 §7).
 *
 * It reads the song store directly rather than taking a prop, because it owns
 * exactly one fact and that fact has exactly one source. Threading it through
 * the composition root would put a line of project bookkeeping into a file
 * whose whole job is to compose surfaces.
 *
 * ## Quiet when there is nothing to say
 *
 * A permanent "Kaydedildi" strip costs a line of staff height on a 320-wide
 * phone forever, to tell a reader something that is true almost always. So
 * the visible line appears only when the news is worth a line — a write that
 * failed, or a device that cannot be written to — and the ordinary state is
 * announced to a screen reader and published as an attribute instead.
 *
 * ## "Kaydediliyor…" is in the contract and not on the screen
 *
 * The song store writes and reads back inside one synchronous commit, so
 * there is no moment between "asked to save" and "saved" for React to render.
 * The state exists in `save-status.ts` for the day a write becomes
 * asynchronous; showing it today would mean inventing a delay to have
 * something to display.
 */
import { SAVE_RETRY_LABEL, saveStatus } from "@/lib/home/save-status";
import { useSong } from "@/lib/song/use-song";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";

export function SaveStatusLine() {
  const { persisted, canPersist, retrySave } = useSong();
  const status = saveStatus({ persisted, canPersist, pending: false });

  return (
    <div data-save-status={status.state} data-save-text={status.text ?? ""}>
      <p aria-live="polite" className="sr-only">
        {status.text}
      </p>
      {status.state === "saved" ? null : (
        <div
          className={`border-line flex items-center justify-between gap-2 border-b px-2 py-1 text-xs ${
            status.state === "failed" ? "text-reject" : "text-muted"
          }`}
        >
          <span>{status.text}</span>
          {status.retryable ? (
            <button
              type="button"
              data-save-retry
              /* Not a commit: the song has not changed, so recording a step
                 for it would put an edit in the history that never happened. */
              onClick={retrySave}
              style={{ minHeight: MIN_TOUCH_TARGET_PX - 12 }}
              className="border-line text-text rounded-md border px-2"
            >
              {SAVE_RETRY_LABEL}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

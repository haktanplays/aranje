"use client";

/**
 * The way back to the music, once the reader has scrolled away (2Q-C §6).
 *
 * Scrolling away is deliberate and the surface honours it: playback stops
 * carrying the view. That leaves a state with no way out of it except finding
 * the playhead by hand on a surface that is thousands of pixels wide, which is
 * the sort of dead end an app should not have. So there is one control, and it
 * appears only while there is somewhere to go back to.
 *
 * ## Where it is, and where it is not
 *
 * Over the reading surface, not in the transport row. The transport already
 * fits eight controls into 320px at 150% text (2Q-B §10) and a ninth would
 * break it; this button also has nothing to do with the transport — it moves
 * the view, and the tick that was sounding when it was pressed is the tick
 * still sounding after.
 *
 * A full touch target, because it is a target: a control that only appears
 * when someone is lost is the worst place to save eight pixels.
 */
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";

export function ReturnToPlayback({
  shown,
  onReturn,
}: {
  shown: boolean;
  onReturn: () => void;
}) {
  if (!shown) return null;
  return (
    <button
      type="button"
      data-return-to-playback
      onClick={onReturn}
      aria-label="Çalmaya dön"
      className="bg-raised text-bronze border-bronze/50 absolute right-3 bottom-3 z-20 flex items-center gap-1.5 rounded-full border px-3 text-xs shadow-lg"
      style={{ minHeight: MIN_TOUCH_TARGET_PX, minWidth: MIN_TOUCH_TARGET_PX }}
    >
      <span aria-hidden>▶</span>
      Çalmaya dön
    </button>
  );
}

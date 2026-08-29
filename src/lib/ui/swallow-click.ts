/**
 * Throw away the click a spent press leaves behind (spec 13.1, 2U-C §2).
 *
 * A touch that ends produces a click, and the browser aims that click at
 * whatever is under the finger *when it lands* — not at what was under it when
 * the finger went down. Two gestures in this app need that click destroyed:
 *
 * - A long press that opens a toolbar hands the toolbar a click on whichever
 *   of its buttons happens to appear under the finger. At 320x700 the
 *   selection toolbar puts "Taşı" exactly where a note in the lower half of
 *   the tab is, so selecting that note opened the move sheet on its own.
 * - A bar-range drag ends on a bar header, and a bar header is a seek button.
 *   Without this the reader would hold bar 1, reach to bar 3, lift — and the
 *   playhead would jump to whichever bar they lifted over and carry the view
 *   there with it. That is the founder's «arkadaki tab yüzeyi kayıyor»
 *   arriving one frame after the gesture instead of during it, and no amount
 *   of `touch-action` prevents it, because it is not a scroll.
 *
 * The press has already been spent, so the click means nothing and is stopped
 * in the capture phase, before React's root listener and therefore before any
 * control's handler runs. The window is short and expires on its own, because
 * a touch does not always produce a click at all.
 *
 * `globalThis.document` rather than the bare identifier so a test can stand a
 * recorder in its place — the thing worth checking here is that the listener
 * is registered capturing and then really taken off again, and a listener that
 * is never removed is the failure this would otherwise hide.
 */
import { CLICK_AFTER_PRESS_MS } from "@/lib/ui/interaction";

export function swallowNextClick(): void {
  const target = globalThis.document as Document | undefined;
  if (!target) return;
  const stop = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  target.addEventListener("click", stop, { capture: true, once: true });
  setTimeout(() => {
    target.removeEventListener("click", stop, { capture: true });
  }, CLICK_AFTER_PRESS_MS);
}

"use client";

/**
 * Whether the screen is narrower than the layout's own small breakpoint.
 *
 * ## Why a viewport question exists at all
 *
 * 2S-A §4 made an edit cell a finger tall — `44px` per string rather than the
 * `26px` a reading row needs — because that row *is* the hit target. On a
 * 390px phone that fits. On a 320px one it does not, and the arithmetic is
 * not close: six strings at `44px` plus the bar header is `286px`, and the
 * reading surface at `320×700` measures `249px` at 100% text and `219px` at
 * 150%. The staff was pushed off the surface entirely — measured at
 * `y=423` with the surface ending at `y=402` — so the lowest rows could not
 * be pressed at all, and the practice loop's own way in stopped working.
 *
 * A cell that is `26px` tall is worse than one that is `44px`. A cell that is
 * off the screen is worse than both. So the height is a question about how
 * much room there is, asked once, in the same place the transport asked it in
 * K-55: below `--breakpoint-xs` the layout gives up spacing rather than
 * controls.
 *
 * The `44px` requirement is **not met below that breakpoint**, and that is
 * written down in `eval/intent-composer/FINDINGS.md` and in K-59 rather than
 * being quietly satisfied by a number nobody measured.
 *
 * ## Why it is a hook and not a media query
 *
 * The row height is arithmetic: cells, arcs and the selection band are all
 * placed from it. CSS cannot hand a number back to that arithmetic, so the
 * question is asked in JavaScript and answered from the same breakpoint the
 * stylesheet uses.
 */
import { useEffect, useState } from "react";

/** `--breakpoint-xs` in `globals.css`, in pixels. One source, two readers. */
export const NARROW_BREAKPOINT_PX = 360;

const QUERY = `(max-width: ${NARROW_BREAKPOINT_PX - 1}px)`;

export function useNarrowViewport(): boolean {
  /*
   * False on the server and on the first client frame. The wider layout is
   * the safe default: it is what every screen above the breakpoint gets, and
   * a narrow screen corrects itself on the effect that follows immediately.
   */
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia(QUERY);
    const read = () => setNarrow(query.matches);
    read();
    query.addEventListener("change", read);
    return () => query.removeEventListener("change", read);
  }, []);

  return narrow;
}

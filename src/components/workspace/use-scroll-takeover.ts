"use client";

/**
 * Who owns the horizontal position of a scrolling surface (spec 13.20 §11,
 * 2Q-A §6).
 *
 * Following the playhead is a convenience, and a convenience that overrides a
 * deliberate action is an annoyance: once the reader has scrolled to look at
 * bar 30 while bar 3 is playing, the view stays at bar 30. Pressing play
 * hands the view back to the transport.
 *
 * The rule was written twice — once in the arrangement, once nowhere at all,
 * which is how the multitrack view came to move the reader's view when they
 * tapped a lane header: a re-render restarts the playhead loop, the loop
 * paints once whether or not the transport is running, and that single paint
 * scrolled the surface back to a paused playhead the reader had deliberately
 * scrolled away from. The etiquette now lives in one place so both surfaces
 * answer the question the same way.
 *
 * A scroll the surface makes on the reader's behalf is not the reader taking
 * over, so it goes through `scrollTo` and is recognised when the browser
 * reports it back. The tolerance is there because a scroller may land on a
 * fractional pixel; two is smaller than any scroll a finger makes.
 */
import { useCallback, useEffect, useRef, type RefObject } from "react";

export type ScrollTakeover = {
  /** True while the transport still owns the horizontal position. */
  follows: () => boolean;
  /** Move the surface without counting it as the reader taking over. */
  scrollTo: (target: number) => void;
  /** Count something else the reader did as taking over. */
  markUserScroll: () => void;
};

export function useScrollTakeover(options: {
  scrollRef: RefObject<HTMLDivElement | null>;
  running: boolean;
}): ScrollTakeover {
  const { scrollRef, running } = options;
  const userScrolled = useRef(false);
  const ownScrollLeft = useRef<number | null>(null);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onScroll = () => {
      if (
        ownScrollLeft.current !== null &&
        Math.abs(scroller.scrollLeft - ownScrollLeft.current) < 2
      ) {
        return;
      }
      userScrolled.current = true;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [scrollRef]);

  // Starting playback gives the view back to the transport.
  useEffect(() => {
    if (running) userScrolled.current = false;
  }, [running]);

  const follows = useCallback(() => !userScrolled.current, []);

  const scrollTo = useCallback(
    (target: number) => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      ownScrollLeft.current = target;
      // Set directly: a smooth scroll every frame would trail the playhead.
      scroller.scrollLeft = target;
    },
    [scrollRef],
  );

  const markUserScroll = useCallback(() => {
    userScrolled.current = true;
  }, []);

  return { follows, scrollTo, markUserScroll };
}

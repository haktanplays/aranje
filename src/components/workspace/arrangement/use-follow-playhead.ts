"use client";

/**
 * The arrangement's one animation frame, and the follow-scroll etiquette
 * around it (2L-R, moved verbatim out of ArrangementCanvas).
 *
 * One `requestAnimationFrame` loop for the whole canvas, and only while the
 * transport is running. The playhead column is moved by transform, so a
 * playing bar costs no render. Following the playhead is a convenience, and
 * a convenience that overrides a deliberate action is an annoyance: once the
 * reader scrolls to look at bar 30 while bar 3 is playing, the view stays at
 * bar 30. Pressing play again hands the view back to the transport.
 */
import { useCallback, useEffect, useRef, type RefObject } from "react";

import { TRACK_LABEL_WIDTH } from "@/lib/arrangement/geometry";
import type { ArrangementModel } from "@/lib/arrangement/model";
import type { PlayPosition } from "@/lib/audio/position";

export function useFollowPlayhead(options: {
  scrollRef: RefObject<HTMLDivElement | null>;
  /** The playhead column, moved by style transform inside the frame. */
  columnRef: RefObject<HTMLDivElement | null>;
  model: ArrangementModel;
  getPosition: () => PlayPosition;
  running: boolean;
  onActiveBarChange: (barKey: string | null) => void;
}): {
  /** A scroll this surface makes on the reader's behalf counts as theirs. */
  markUserScroll: () => void;
} {
  const { scrollRef, columnRef, model, getPosition, running, onActiveBarChange } =
    options;

  const lastBarKey = useRef<string | null>(null);
  const userScrolled = useRef(false);
  const ownScrollLeft = useRef<number | null>(null);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onScroll = () => {
      // A scroll this hook set itself is not the reader taking over.
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

  useEffect(() => {
    let frame = 0;

    const draw = () => {
      const position = getPosition();
      const bar = model.bars.find((entry) => entry.barKey === position.barKey);
      const column = columnRef.current;

      if (column) {
        if (!bar) {
          column.style.opacity = "0";
        } else {
          column.style.opacity = "1";
          column.style.width = `${bar.width}px`;
          column.style.transform = `translateX(${bar.left}px)`;
        }
      }

      if (position.barKey !== lastBarKey.current) {
        lastBarKey.current = position.barKey;
        onActiveBarChange(position.barKey);

        // Only on a bar change, and only if the reader has not taken over:
        // a per-frame scroll would fight the finger and trail the music.
        const scroller = scrollRef.current;
        if (bar && scroller && !userScrolled.current) {
          const viewLeft = scroller.scrollLeft;
          const viewRight = viewLeft + scroller.clientWidth - TRACK_LABEL_WIDTH;
          if (bar.left < viewLeft || bar.left + bar.width > viewRight) {
            const target = Math.max(0, bar.left - scroller.clientWidth / 3);
            ownScrollLeft.current = target;
            scroller.scrollLeft = target;
          }
        }
      }

      if (running) frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [running, model, getPosition, onActiveBarChange, scrollRef, columnRef]);

  const markUserScroll = useCallback(() => {
    userScrolled.current = true;
  }, []);

  return { markUserScroll };
}

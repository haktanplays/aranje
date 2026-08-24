"use client";

/**
 * The arrangement's one animation frame, and the follow-scroll etiquette
 * around it (2L-R, moved verbatim out of ArrangementCanvas).
 *
 * One animation-frame loop for the whole canvas, and only while the transport
 * is running — the rule itself lives in `playhead-loop.ts`, which the tab
 * shares, so the two surfaces cannot drift apart about when a frame happens.
 * The playhead column is moved by transform, so a playing bar costs no render.
 *
 * Who owns the horizontal position while the music moves is the same question
 * on every scrolling surface, so it is asked in one place
 * (`use-scroll-takeover.ts`) rather than answered again here.
 */
import { useEffect, useRef, type RefObject } from "react";

import { useScrollTakeover } from "@/components/workspace/use-scroll-takeover";
import { TRACK_LABEL_WIDTH } from "@/lib/arrangement/geometry";
import { runPlayheadLoop } from "@/lib/workspace/playhead-loop";
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
  const takeover = useScrollTakeover({ scrollRef, running });

  useEffect(() => {
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
        if (bar && scroller && takeover.follows()) {
          const viewLeft = scroller.scrollLeft;
          const viewRight = viewLeft + scroller.clientWidth - TRACK_LABEL_WIDTH;
          if (bar.left < viewLeft || bar.left + bar.width > viewRight) {
            takeover.scrollTo(Math.max(0, bar.left - scroller.clientWidth / 3));
          }
        }
      }
    };

    return runPlayheadLoop({ source: "arrangement", running, draw });
  }, [running, model, getPosition, onActiveBarChange, scrollRef, columnRef, takeover]);

  return { markUserScroll: takeover.markUserScroll };
}

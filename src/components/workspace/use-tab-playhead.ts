"use client";

import { useEffect, useRef, type RefObject } from "react";

import { markPlayingOnset } from "@/lib/tab/playing-onset";
import type { PlayPosition } from "@/lib/audio/position";
import { xAtTicks, type SongAxis } from "@/lib/tab/song-axis";
import { runPlayheadLoop } from "@/lib/workspace/playhead-loop";

/**
 * One frame of the tab's playhead (2Q-C §5, 2S-A §4).
 *
 * Extracted from `TabCanvas` when the seventh glyph state arrived: the canvas
 * has a line budget, and a budget that is quietly spent is not a budget. The
 * behaviour is exactly what it was — the same loop, the same order of work,
 * the same dependencies — with the one addition marked below.
 *
 * Audio is never scheduled here. The line is moved by transform rather than by
 * React state, so a frame costs no render, and the onset mark is a DOM
 * attribute for the same reason.
 *
 * The line is not hidden when the reader is elsewhere: the whole song is on
 * one surface, so it is drawn where the music really is, and if that is off
 * screen the reader simply does not see it.
 */
export function useTabPlayhead(options: {
  readonly axis: SongAxis;
  readonly originPx: number;
  readonly running: boolean;
  readonly getPosition: () => PlayPosition;
  readonly follow: (axisX: number | null) => void;
  readonly onActiveBarChange: (barKey: string | null) => void;
  readonly playheadRef: RefObject<HTMLDivElement | null>;
  readonly contentRef: RefObject<HTMLDivElement | null>;
}): void {
  const { axis, originPx, running, getPosition, follow, onActiveBarChange } =
    options;
  const { playheadRef, contentRef } = options;
  const lastBarKey = useRef<string | null>(null);
  const lastOnset = useRef<string | null>(null);

  useEffect(() => {
    const draw = () => {
      const position = getPosition();
      const axisX = xAtTicks(axis, position.ticks);
      const element = playheadRef.current;

      if (element) {
        if (axisX === null) {
          element.style.opacity = "0";
        } else {
          element.style.opacity = "1";
          element.style.transform = `translateX(${axisX + originPx}px)`;
        }
      }

      if (position.barKey !== lastBarKey.current) {
        lastBarKey.current = position.barKey;
        onActiveBarChange(position.barKey);
      }

      // The seventh glyph state, marked without a render (2S-A §4).
      lastOnset.current = markPlayingOnset(
        contentRef.current,
        { barKey: position.barKey, slotIndex: position.slotIndex },
        lastOnset.current,
      );

      follow(axisX);
    };

    return runPlayheadLoop({ source: "tab", running, draw });
  }, [
    axis,
    contentRef,
    follow,
    getPosition,
    onActiveBarChange,
    originPx,
    playheadRef,
    running,
  ]);
}

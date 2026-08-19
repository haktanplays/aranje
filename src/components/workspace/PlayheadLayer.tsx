"use client";

import type { RefObject } from "react";

/**
 * The vertical playhead.
 *
 * One element for the whole canvas, moved by transform on an animation frame.
 * It is never positioned from React state, so playback does not cost a render
 * per frame.
 */
export function PlayheadLayer({
  layerRef,
  height,
}: {
  layerRef: RefObject<HTMLDivElement | null>;
  height: number;
}) {
  return (
    <div
      ref={layerRef}
      aria-hidden
      className="bg-steel pointer-events-none absolute top-0 left-0 z-20 w-0.5 opacity-0"
      style={{ height, willChange: "transform" }}
    />
  );
}

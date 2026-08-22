"use client";

/**
 * One end of a bar selection, as something a finger can move (2L-R, moved
 * verbatim out of ArrangementCanvas).
 *
 * Its own component so the drag flag is its own ref: two handles sharing one
 * flag is two handles that can disagree about who is being dragged, and a ref
 * read inside a `map` during render is a ref read at the wrong time.
 */
import { useRef } from "react";

import type { BarSelectEdge } from "@/components/workspace/ArrangementCanvas";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";

/*
 * The resize handles.
 *
 * A full 44px square at each end would cover most of a single-bar selection
 * and take the cells under it out of reach, so the touch area is spent where
 * the gesture actually needs it: full lane height to grab, narrower across,
 * because the drag is horizontal and the finger only has to *start* on the
 * handle — pointer capture carries the rest.
 */
export const HANDLE_WIDTH = 28;
export const HANDLE_HEIGHT = MIN_TOUCH_TARGET_PX;

export function SelectionHandle({
  edge,
  anchorX,
  left,
  top,
  onDragTo,
}: {
  edge: BarSelectEdge;
  /** Where this edge currently sits, in the arrangement's own pixels. */
  anchorX: number;
  left: number;
  top: number;
  onDragTo: (contentX: number) => void;
}) {
  /*
   * Where the gesture started, on the glass and in the arrangement.
   *
   * Both are taken once, at the press. A delta needs no layout read — the
   * edge's own position in arrangement pixels is already known — but it must
   * be measured from where the edge *was*, not from where it is now: the edge
   * moves as the selection grows, and adding the whole distance travelled to
   * an anchor that has already moved makes the drag run away from the finger.
   */
  const from = useRef<{ readonly clientX: number; readonly anchorX: number } | null>(
    null,
  );
  return (
    <button
      type="button"
      data-arr-handle={edge}
      aria-label={
        edge === "start"
          ? "Seçimin başlangıcını değiştir"
          : "Seçimin sonunu değiştir"
      }
      /*
       * Pointer capture, because the finger leaves the handle immediately —
       * the gesture is a swipe across bars and the handle is narrower than a
       * bar. Without it the drag would end on the first cell it crossed.
       */
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        from.current = { clientX: event.clientX, anchorX };
      }}
      onPointerMove={(event) => {
        const started = from.current;
        if (started === null) return;
        onDragTo(started.anchorX + (event.clientX - started.clientX));
      }}
      onPointerUp={() => {
        from.current = null;
      }}
      onPointerCancel={() => {
        from.current = null;
      }}
      className="border-bronze bg-app absolute z-[6] flex items-center justify-center rounded-md border-2"
      style={{
        left,
        top,
        width: HANDLE_WIDTH,
        height: HANDLE_HEIGHT,
        // The scroller must not take the gesture: this one really is a drag.
        touchAction: "none",
      }}
    >
      <span className="bg-bronze h-4 w-0.5 rounded-full" aria-hidden />
    </button>
  );
}

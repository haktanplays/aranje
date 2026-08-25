"use client";

/**
 * The kit grid's window, kept in step with the surface it lives on (2R-A §6).
 *
 * The arithmetic is `lib/ui/drum-grid-window.ts` and none of it is here. This
 * file owns only the two facts that arithmetic needs and that a pure module
 * cannot have: how wide the scroller is, and where it is scrolled to. Keeping
 * the split means the geometry can be tested without a DOM, and the component
 * below can be read as a drawing rather than as a layout engine (§16).
 *
 * ## Why the grid has its own window and not the reading one
 *
 * The reading surface windows the *song* by bar. An armed kit draws one
 * section by column, at a different origin, in its own coordinates. Sharing
 * one window between the two would mean one set of indices meaning two things
 * — and a tap resolved against the wrong one lands on the wrong beat.
 *
 * The scroller is still shared. This hook listens to it; it never scrolls it.
 * Who moves the surface is `use-reading-surface`'s question, and two owners of
 * one scroll position is the shape 2Q-C removed.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import { SLOT_WIDTH } from "@/components/workspace/geometry";
import {
  drumGridAxis,
  drumGridWindow,
  sameDrumWindow,
  type DrumGridAxis,
  type DrumGridWindow,
  type ScrollDirection,
} from "@/lib/ui/drum-grid-window";
// Which way the reader is going has one rule and one dead band in this app;
// a second copy here would be a grid that disagrees with the lane beside it.
import { directionOf } from "@/lib/ui/horizontal-window";
import type { DrumStepModel } from "@/lib/tab/drum-step-model";

/** No kit armed: a real axis with nothing on it, rather than a null to guard. */
const EMPTY_AXIS: DrumGridAxis = {
  columns: [],
  totalWidthPx: 0,
  slotWidthPx: SLOT_WIDTH,
};

export type DrumGridView = {
  readonly axis: DrumGridAxis;
  readonly window: DrumGridWindow;
};

type Viewport = {
  readonly leftPx: number;
  readonly widthPx: number;
  readonly direction: ScrollDirection;
};

const AT_REST: Viewport = { leftPx: 0, widthPx: 0, direction: "idle" };

export function useDrumGridWindow(options: {
  /** The armed kit's grid, or null when nothing is armed. */
  readonly model: DrumStepModel | null;
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  /**
   * Where the grid's first column sits in the scroller's coordinates.
   *
   * The Tab surface adds its sticky gutter and the section's own x; the Çoklu
   * view adds the section's x alone. Passed in for the reason every other
   * origin in this app is: the conversion happens once, at the surface that
   * knows its own layout, instead of being re-derived by whoever needs it.
   */
  readonly offsetPx?: number;
}): DrumGridView {
  const { model, scrollRef, offsetPx = 0 } = options;

  const axis = useMemo(
    () => (model ? drumGridAxis(model, SLOT_WIDTH) : EMPTY_AXIS),
    [model],
  );

  /*
   * The viewport is what is remembered; the window is derived from it. Storing
   * the window instead would mean holding indices into an axis that a change
   * of section has already replaced — the same set of numbers meaning a
   * different set of columns, which is a grid drawn at the wrong x for a frame.
   */
  const [viewport, setViewport] = useState<Viewport>(AT_REST);
  const view = useMemo<DrumGridView>(
    () => ({
      axis,
      window: drumGridWindow({
        axis,
        viewportLeftPx: viewport.leftPx,
        viewportWidthPx: viewport.widthPx,
        direction: viewport.direction,
      }),
    }),
    [axis, viewport],
  );

  /*
   * The listener below must not be rebuilt every time the axis changes, and
   * the axis changes on every edit — a new Song is a new model. Attaching a
   * fresh scroll listener and a fresh ResizeObserver per tap was measured at
   * 72 observer constructions across 46 taps; reading the current axis through
   * a ref inside the callback keeps that at one.
   */
  const armed = axis.columns.length === 0 ? 0 : 1;
  const axisRef = useRef(axis);
  useEffect(() => {
    axisRef.current = axis;
  }, [axis]);

  const sync = useCallback(
    (scrollLeft: number, widthPx: number) => {
      const live = axisRef.current;
      const leftPx = scrollLeft - offsetPx;
      setViewport((current) => {
        const next: Viewport = {
          leftPx,
          widthPx,
          direction: directionOf(current.leftPx, leftPx),
        };
        /*
         * A scroll of a few pixels almost never changes which columns are
         * mounted, and committing one anyway would re-render every row of the
         * kit to redraw exactly what is already there. So the position is
         * kept only when the window it produces really differs — the two are
         * compared rather than assumed, because the answer depends on where
         * in a column the edge happens to land.
         */
        if (current.widthPx !== widthPx) return next;
        const before = drumGridWindow({
          axis: live,
          viewportLeftPx: current.leftPx,
          viewportWidthPx: current.widthPx,
          direction: current.direction,
        });
        const after = drumGridWindow({
          axis: live,
          viewportLeftPx: leftPx,
          viewportWidthPx: widthPx,
          direction: next.direction,
        });
        return sameDrumWindow(before, after) ? current : next;
      });
    },
    [offsetPx],
  );

  useEffect(() => {
    const scroller = scrollRef.current;
    // Nothing armed is nothing to window: no listener, no observer, and the
    // surface is left exactly as it is when the kit is only being read.
    if (!scroller || armed === 0) return;
    const measure = () => sync(scroller.scrollLeft, scroller.clientWidth);
    measure();
    scroller.addEventListener("scroll", measure, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [armed, scrollRef, sync]);

  return view;
}

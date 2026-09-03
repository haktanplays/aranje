"use client";

/**
 * Who owns a press on the staff (2V-B.3 §12).
 *
 * Four gestures share one element: writing with a pen, dragging a range of
 * notes, panning the empty background, and pinching to zoom. Deciding between
 * them used to be four expressions spread through the component that draws the
 * staff, which is how a rule ends up being enforced in three places and
 * forgotten in the fourth.
 *
 * The arbitration is here, in the order it actually runs: a pen outranks a
 * selection drag, a selection drag outranks a pan, and two fingers outrank
 * everything. `staffPointerHandlers` composes the result, so the staff
 * receives four handlers and makes no decision of its own.
 */
import { pointerOwner } from "@/lib/tab/pointer-ownership";
import { staffPointerHandlers, useBackgroundPan } from "@/lib/ui/use-background-pan";
import type { NoteRangeGesture } from "@/lib/ui/use-note-range-drag";
import type { ViewZoom } from "@/lib/ui/use-view-zoom";
import type { ReadingSurface } from "@/lib/workspace/use-reading-surface";
import { useSurfaceZoom } from "@/lib/workspace/use-surface-zoom";

export function useStaffGestures(input: {
  readonly scrollRef: React.RefObject<HTMLDivElement | null>;
  readonly surface: ReadingSurface;
  readonly zoom: ViewZoom | undefined;
  readonly selectionContentPx: { readonly from: number; readonly to: number } | null;
  readonly noteRange: NoteRangeGesture | undefined;
  /** A pen is armed: the press writes where it lands. */
  readonly penArmed: boolean;
  /** A long press on the staff can start a selection at all. */
  readonly selectionAvailable: boolean;
  /** Something is held, which is what makes panning worth offering. */
  readonly hasSelection: boolean;
  readonly onHandleMove?: (event: React.PointerEvent) => void;
  readonly onHandleUp?: () => void;
}) {
  const {
    hasSelection,
    noteRange,
    onHandleMove,
    onHandleUp,
    penArmed,
    scrollRef,
    selectionAvailable,
    selectionContentPx,
    surface,
    zoom,
  } = input;

  /* A writing pen takes the press; both gestures used to run (K-59.1 §5). */
  const owner = pointerOwner({
    noteRangeOwning: noteRange?.owning === true,
    penArmed,
    selectionAvailable,
  });
  /*
   * The staff's press is the note-range drag (2U-C §3), not a long press that
   * fires and forgets. The gesture is the same up to the threshold; what
   * changed is that the finger is still holding something afterwards, so the
   * hook keeps the sequence instead of handing it back to the scroller.
   */
  const staffPress = noteRange && owner !== "pen" ? noteRange.handlers : null;

  /*
   * Dragging the empty staff moves the camera (2V-B.2 §6).
   *
   * Offered only while a selection is held and no pen is armed — the two
   * conditions `pointerOwner` ranks `background_pan` behind — so the very
   * first long press on an empty staff still selects, and a reader holding a
   * pen still writes where they touch. The press itself is filtered again at
   * pointerdown, because "is there music under this finger" is a fact about
   * one press rather than about the render.
   */
  const pan = useBackgroundPan({
    scrollRef,
    enabled: hasSelection && !penArmed,
  });

  const pinch = useSurfaceZoom({ zoom, surface, selectionContentPx, scrollRef });

  return staffPointerHandlers({ staffPress, pan, pinch, onHandleMove, onHandleUp });
}

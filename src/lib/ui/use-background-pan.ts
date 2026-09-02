"use client";

/**
 * Dragging the empty staff to bring the next bars into view (2V-B.2 §6).
 *
 * ## The gesture the editor did not have
 *
 * Asked to extend a selection past the right-hand edge, the founder's first
 * natural move was not to keep pulling: it was to finish the selection at the
 * visible edge, let go, drag the background until the next bars were on
 * screen, and carry on from there. That is how every map, photo and score
 * application on the device behaves, so it was tried without being taught —
 * and nothing happened, because every press on the staff belonged to the
 * selection gesture.
 *
 * Edge-follow autoscroll already existed and still does. It is a fine gesture
 * for a reader who knows it is there and a poor one for a reader who does
 * not, because it only happens while a selection is being dragged and it
 * moves at a speed the finger does not choose. This is the other half: the
 * ordinary way to move a canvas.
 *
 * ## Why it moves the scroller directly
 *
 * Not by setting state, and not through the view model. The tab already owns
 * a real scroll container, and panning is exactly what that container does;
 * writing to `scrollLeft` keeps one source of truth for where the music is,
 * so the playhead, the windowing and the "return to playback" affordance all
 * keep working without knowing this gesture exists.
 *
 * Nothing here touches the Song, the selection or the history. A pan is a
 * camera move (§7): the reader ends it looking somewhere else and holding
 * exactly what they held before.
 */
import { useCallback, useRef } from "react";

/**
 * What the DOM said about where a press landed.
 *
 * Three booleans rather than an `Element`, so the decision below stays in the
 * node test suite with everything else. Reading them is the adapter's job and
 * it is one line at the call site; deciding what they mean is this file's,
 * and that is the part worth pinning.
 */
export type PressPlace = {
  /** The press was inside a bar header. */
  readonly onHeader: boolean;
  /** The press was inside a staff cell at all. */
  readonly onCell: boolean;
  /** That cell carries a written onset. */
  readonly onOnset: boolean;
};

/**
 * Is this press on staff background rather than on something written?
 *
 * "Background" needs saying carefully on this staff, because the staff has no
 * gaps: every position is a cell button so that a tap anywhere can write a
 * note. What the reader means by *empty background* is therefore not "between
 * the cells" — there is no between — but "a place with no music in it", which
 * is a cell carrying no onset.
 *
 * A bar header is excluded outright. It is a place with its own gesture
 * (K-59.1), and a header that panned would take the measure selection away.
 */
export function isEmptyStaffBackground(place: PressPlace): boolean {
  if (place.onHeader) return false;
  /* Outside the cells altogether — padding, the strip past the last bar — is
     background too, and the most literal kind. */
  if (!place.onCell) return true;
  return !place.onOnset;
}

/** Read those three facts off a real event target. The adapter, and all of it. */
export function pressPlaceOf(target: EventTarget | null): PressPlace {
  if (!(target instanceof Element)) {
    return { onHeader: false, onCell: false, onOnset: false };
  }
  const cell = target.closest("[data-cell]");
  return {
    onHeader: target.closest("[data-tab-bar-header]") !== null,
    onCell: cell !== null,
    onOnset: cell?.hasAttribute("data-onset") === true,
  };
}

export type BackgroundPan = {
  onPointerDown(event: React.PointerEvent): void;
  onPointerMove(event: React.PointerEvent): void;
  onPointerUp(event: React.PointerEvent): void;
  onPointerCancel(event: React.PointerEvent): void;
};

/**
 * How far a finger may drift before this is a pan rather than a tap.
 *
 * Below it the press is still a candidate for everything else, so a reader
 * who means to tap a note and moves three pixels doing it does not scroll the
 * music out from under themselves.
 */
export const PAN_THRESHOLD_PX = 8;

export function useBackgroundPan(input: {
  /** The scroll container to move. */
  readonly scrollRef: React.RefObject<HTMLElement | null>;
  /** False when this press belongs to some other gesture. */
  readonly enabled: boolean;
}): BackgroundPan {
  const { enabled, scrollRef } = input;
  /*
   * One live gesture, held in a ref rather than in state: a pan re-renders
   * nothing, and routing sixty pointermoves a second through React would make
   * the smoothest gesture in the editor the most expensive one.
   */
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
    moved: boolean;
  } | null>(null);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!enabled) return;
      const scroller = scrollRef.current;
      if (!scroller) return;
      drag.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startScrollLeft: scroller.scrollLeft,
        moved: false,
      };
    },
    [enabled, scrollRef],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const live = drag.current;
      if (!live || live.pointerId !== event.pointerId) return;
      const scroller = scrollRef.current;
      if (!scroller) return;
      const dx = event.clientX - live.startX;
      if (!live.moved && Math.abs(dx) < PAN_THRESHOLD_PX) return;
      /*
       * Past the threshold the gesture is a pan and stays one, even if the
       * finger comes back: a drag that stopped panning halfway would leave the
       * reader's next movement doing something else entirely.
       */
      live.moved = true;
      scroller.scrollLeft = live.startScrollLeft - dx;
    },
    [scrollRef],
  );

  const end = useCallback((event: React.PointerEvent) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: end,
    onPointerCancel: end,
  };
}

/**
 * The staff's four pointer handlers, composed once (2V-B.2 §6).
 *
 * Three gestures share one element — the note-range drag, the duration
 * handle's move/up, and now the pan — and composing them inline was pushing
 * `TabCanvas` past its line budget for no gain in clarity. The order inside
 * each handler is the interesting part and it lives here, next to the pan it
 * is about, rather than in the file that merely renders the staff.
 */
export function staffPointerHandlers(input: {
  readonly staffPress: Partial<BackgroundPan> | null;
  readonly pan: BackgroundPan;
  readonly onHandleMove?: (event: React.PointerEvent) => void;
  readonly onHandleUp?: () => void;
}) {
  const { onHandleMove, onHandleUp, pan, staffPress } = input;
  return {
    onPointerDown(event: React.PointerEvent) {
      staffPress?.onPointerDown?.(event);
      /* The note-range drag keeps its own sequence; panning only ever joins a
         press that landed on nothing written. */
      if (isEmptyStaffBackground(pressPlaceOf(event.target))) {
        pan.onPointerDown(event);
      }
    },
    onPointerMove(event: React.PointerEvent) {
      staffPress?.onPointerMove?.(event);
      pan.onPointerMove(event);
      onHandleMove?.(event);
    },
    onPointerUp(event: React.PointerEvent) {
      staffPress?.onPointerUp?.(event);
      pan.onPointerUp(event);
      onHandleUp?.();
    },
    onPointerCancel(event: React.PointerEvent) {
      staffPress?.onPointerCancel?.(event);
      pan.onPointerCancel(event);
    },
  };
}

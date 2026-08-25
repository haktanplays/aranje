"use client";

/**
 * The one horizontal surface both reading views are (2Q-C §3, §4, §5, §6, §7).
 *
 * Tab and Çoklu draw different notation over the same music. Before this they
 * also each answered, in their own way, four questions that have nothing to do
 * with notation: where the bars are, which of them are worth having in the
 * DOM, where the surface should be scrolled to, and who is allowed to scroll
 * it. Two answers to each is how the baseline came to measure a Tab that
 * jumped 400px and a Çoklu that jumped 700 at the same moment in the same
 * song.
 *
 * There is one answer now, and it is here. The components below this hook draw
 * bars; they do not compute a position, a width, a tick or a scroll target.
 *
 * ## Why the hook is per surface and not per app
 *
 * Exactly one reading surface is mounted at a time — `WorkspaceSurface`
 * unmounts the others rather than hiding them — so a hook that lives with the
 * surface is a hook that exists once. Living higher up would mean an
 * observer, a scroll listener and a window state kept alive for a scroller
 * that is not on the screen, which is the shape this file exists to avoid.
 *
 * ## What it never does
 *
 * It does not read or write the Song, storage, history or an export. Nothing
 * here can change what a bar contains, only whether it is currently in the
 * DOM — and a bar that is not in the DOM is still exactly where it was, on an
 * axis that still has its full width.
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
  buildSongAxis,
  barAtTicks,
  pointAtX,
  xAtBarKey,
  type SongAxis,
} from "@/lib/tab/song-axis";
import {
  desiredScrollLeft,
  followMode,
  followsContinuously,
  followTailPx,
  INITIAL_FOLLOW_STATE,
  nextFollowState,
  reducedMotionScrollLeft,
  type FollowEvent,
  type FollowMode,
  type FollowState,
} from "@/lib/ui/continuous-follow";
import {
  directionOf,
  horizontalWindow,
  sameWindow,
  type HorizontalWindow,
} from "@/lib/ui/horizontal-window";
import type { Song } from "@/lib/song/schema";

/** A programmatic scroll landing on a fractional pixel is still ours. */
const OWN_SCROLL_TOLERANCE_PX = 2;

export type ReadingSurface = {
  readonly axis: SongAxis;
  /** The bars to render, and the empty space either side of them. */
  readonly window: HorizontalWindow;
  /** The scroll content's full width: the axis, the origin and the tail. */
  readonly contentWidthPx: number;
  /** Where bar zero starts in scroll coordinates. The tab's gutter, or 0. */
  readonly originPx: number;
  readonly mode: FollowMode;
  /** True while the reader owns the view and the transport wants it back. */
  readonly detached: boolean;
  /**
   * The section under the viewport's left edge, or null before it is measured.
   *
   * A scroll position, not a stored choice: on a surface that draws the whole
   * song, which section is being read *is* where the surface is scrolled to,
   * and anything else would be a second answer able to disagree with the
   * pixels.
   */
  readonly viewedSectionId: string | null;
  /** Move the surface without it counting as the reader taking over. */
  scrollTo(contentX: number): void;
  /**
   * The same, named by bar rather than by pixel.
   *
   * `follows` says whether the request also hands the view back to the
   * transport. A bar tap does — it seeks, so the music is going where the
   * view is going. A section choice does not: the music has not moved, and
   * following would drag the reader back to it in the next frame.
   */
  scrollToBar(barKey: string, follows: boolean): void;
  /**
   * One frame of following. Called from the single playhead loop with the
   * playhead's position on the axis, or null when the transport is nowhere.
   */
  follow(playheadAxisX: number | null): void;
  /**
   * The explicit "Çalmaya dön": take the view back to the playhead now.
   *
   * It scrolls in the same call rather than waiting for the state change to
   * reach the next frame, because the reader pressed a button and a button
   * that appears to do nothing for a frame reads as a button that missed.
   * It moves the surface only: the transport is not touched, so the tick that
   * was sounding when it was pressed is the tick still sounding after.
   */
  returnToPlayback(playheadAxisX: number | null): void;
  /** Something happened that changes who owns the view. */
  report(event: FollowEvent): void;
};

export function useReadingSurface(options: {
  readonly song: Song;
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  /**
   * Whether the transport is running.
   *
   * Pressing play is the reader asking for the view back (§6). It is taken
   * here rather than reported by each surface, because "the transport
   * started" is one fact and two components remembering to say it is two
   * chances for one of them to forget — which is exactly how the first
   * measurement of this build followed on Çoklu and not on Tab.
   */
  readonly running: boolean;
  /**
   * Space before the first bar, in scroll coordinates.
   *
   * The tab has a sticky gutter of string names; the Çoklu view has none. It
   * is passed in rather than assumed because an axis position and a scroll
   * position differ by exactly this, and a component that had to remember to
   * add it would eventually forget — which is how a long press once landed
   * two slots left of the note under the finger.
   */
  readonly originPx?: number;
  /** The reader scrolled themselves into a different section. */
  readonly onScrolledToSection?: (sectionId: string) => void;
}): ReadingSurface {
  const { song, scrollRef, running, originPx = 0, onScrolledToSection } = options;

  const axis = useMemo(() => buildSongAxis(song, SLOT_WIDTH), [song]);
  const [viewportWidthPx, setViewportWidthPx] = useState(0);
  const [follow, setFollow] = useState<FollowState>(INITIAL_FOLLOW_STATE);

  const previousLeft = useRef(0);
  const ownScrollLeft = useRef<number | null>(null);
  const [viewedSectionId, setViewedSectionId] = useState<string | null>(null);

  /*
   * The window is state because React has to re-render to mount a bar. It is
   * *only* set when the answer changed: the frame loop below asks for one
   * sixty times a second, and a `setState` per frame would re-render every
   * lane to say nothing had happened.
   */
  const [window_, setWindow] = useState<HorizontalWindow>(() =>
    horizontalWindow({ axis, viewportLeftPx: 0, viewportWidthPx: 0, direction: "idle" }),
  );

  const syncWindow = useCallback(
    (scrollLeft: number, width: number) => {
      const viewportLeftPx = scrollLeft - originPx;
      const next = horizontalWindow({
        axis,
        viewportLeftPx,
        viewportWidthPx: width,
        direction: directionOf(previousLeft.current, viewportLeftPx),
      });
      previousLeft.current = viewportLeftPx;
      setWindow((current) => (sameWindow(current, next) ? current : next));

      /*
       * Which section is being read, taken from the left edge of the viewport
       * rather than from the window. The window reaches a viewport further
       * back than the reader can see, so reading it would announce the next
       * section a screen early.
       */
      const edge = Math.max(0, Math.min(axis.totalWidthPx, viewportLeftPx));
      const section = pointAtX(axis, edge)?.bar.sectionId ?? null;
      setViewedSectionId((current) => (current === section ? current : section));
      return { window: next, sectionId: section };
    },
    [axis, originPx],
  );

  /*
   * One observer for the surface, not one per lane. The width is needed for
   * both the window and the reading anchor, so measuring it twice would be
   * two chances to disagree about how wide the screen is.
   */
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const measure = () => {
      setViewportWidthPx(scroller.clientWidth);
      syncWindow(scroller.scrollLeft, scroller.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [scrollRef, syncWindow]);

  /*
   * A scroll the surface made on the reader's behalf is not the reader taking
   * over. Everything else is: a wheel, a drag, a flick, the scrollbar.
   */
  const arrivedAt = useRef<string | null>(null);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const onScroll = () => {
      const ours =
        ownScrollLeft.current !== null &&
        Math.abs(scroller.scrollLeft - ownScrollLeft.current) <
          OWN_SCROLL_TOLERANCE_PX;
      const before = arrivedAt.current;
      const { sectionId } = syncWindow(scroller.scrollLeft, scroller.clientWidth);
      arrivedAt.current = sectionId;
      if (!ours) {
        setFollow((state) => nextFollowState(state, { type: "user_scrolled" }));
        /*
         * Which section the reader has arrived at, read off the surface's own
         * geometry rather than from a DOM query — under windowing the section
         * they scrolled to may not be mounted yet, and a `querySelector` for
         * it would find nothing and quietly do nothing.
         */
        if (sectionId !== null && sectionId !== before) {
          onScrolledToSection?.(sectionId);
        }
      }
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [onScrolledToSection, scrollRef, syncWindow]);

  /*
   * Play, or resume, hands the view back to the transport.
   *
   * Only on the edge into running: a reader who scrolls away *while* it plays
   * keeps the view, which is the whole point of the takeover. Adjusted during
   * render rather than in an effect, because the transport is not an external
   * system to synchronise with — it is a prop, and reacting to it in an effect
   * would mean one painted frame in which the surface still believes the
   * reader owns it.
   */
  const [wasRunning, setWasRunning] = useState(running);
  if (running !== wasRunning) {
    setWasRunning(running);
    if (running) {
      setFollow((state) => nextFollowState(state, { type: "playback_started" }));
    }
  }

  /*
   * The system's own preference, genuinely read rather than assumed (§7).
   *
   * This one *is* an external system, so it is an effect: the media query is
   * subscribed to and the answer arrives in its callback. The first reading is
   * taken through the same callback rather than inline, so there is one path
   * into the state instead of two.
   */
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const apply = (reduce: boolean) =>
      setFollow((state) =>
        nextFollowState(state, { type: "reduce_motion_changed", reduce }),
      );
    const onChange = (event: MediaQueryListEvent) => apply(event.matches);
    query.addEventListener("change", onChange);
    if (query.matches) apply(true);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const contentWidthPx =
    originPx + axis.totalWidthPx + followTailPx(viewportWidthPx);

  const scrollTo = useCallback(
    (contentX: number) => {
      const scroller = scrollRef.current;
      if (!scroller) return;
      ownScrollLeft.current = contentX;
      // Set directly. A native smooth scroll is still moving when the next
      // frame asks where the surface is, and "still animating" is not a
      // position.
      scroller.scrollLeft = contentX;
      syncWindow(scroller.scrollLeft, scroller.clientWidth);
    },
    [scrollRef, syncWindow],
  );

  const scrollToBar = useCallback(
    (barKey: string, follows: boolean) => {
      const x = xAtBarKey(axis, barKey);
      if (x === null) return;
      setFollow((state) =>
        nextFollowState(state, {
          type: follows ? "explicit_seek" : "user_scrolled_to_section",
        }),
      );
      scrollTo(Math.max(0, x + originPx));
    },
    [axis, originPx, scrollTo],
  );

  const report = useCallback(
    (event: FollowEvent) => setFollow((state) => nextFollowState(state, event)),
    [],
  );

  const step = useCallback(
    (playheadAxisX: number | null) => {
      const scroller = scrollRef.current;
      if (!scroller || playheadAxisX === null) return;
      if (follow.manual) return;

      const view = { widthPx: scroller.clientWidth, contentWidthPx };
      const contentX = playheadAxisX + originPx;

      if (follow.reduceMotion) {
        const target = reducedMotionScrollLeft(contentX, scroller.scrollLeft, view);
        if (target !== null) scrollTo(target);
        return;
      }

      const target = desiredScrollLeft(contentX, view);
      // Whole pixels: a scroller reports back a rounded value, and comparing
      // a fractional target against it would call every frame a miss.
      if (Math.abs(target - scroller.scrollLeft) >= 0.5) scrollTo(target);
    },
    [contentWidthPx, follow.manual, follow.reduceMotion, originPx, scrollRef, scrollTo],
  );

  const returnToPlayback = useCallback(
    (playheadAxisX: number | null) => {
      setFollow((state) => nextFollowState(state, { type: "return_to_playback" }));
      const scroller = scrollRef.current;
      if (!scroller || playheadAxisX === null) return;
      scrollTo(
        desiredScrollLeft(playheadAxisX + originPx, {
          widthPx: scroller.clientWidth,
          contentWidthPx,
        }),
      );
    },
    [contentWidthPx, originPx, scrollRef, scrollTo],
  );

  return {
    axis,
    window: window_,
    contentWidthPx,
    originPx,
    mode: followMode(follow),
    detached: follow.manual,
    viewedSectionId,
    scrollTo,
    scrollToBar,
    follow: step,
    returnToPlayback,
    report,
  };
}

/**
 * Which section a tick belongs to, for a surface that draws all of them.
 *
 * Here rather than in a component for the reason every other conversion is:
 * the axis is the one authority on where a tick is, and a second reading of
 * it in a component is a second answer waiting to disagree.
 */
export function sectionAtTicks(axis: SongAxis, songTicks: number): string | null {
  return barAtTicks(axis, songTicks)?.sectionId ?? null;
}

/** Whether the surface may move itself this frame. Exported for tests. */
export function surfaceFollows(state: FollowState): boolean {
  return followsContinuously(state);
}

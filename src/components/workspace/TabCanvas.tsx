"use client";

/**
 * One track's notation, over the whole song, on one scroller (2Q-C §4).
 *
 * The tab has always drawn every bar of the song in one horizontal scroller.
 * What 2Q-C changed is who answers the questions around that: where the bars
 * are, which of them are worth mounting, where the surface should be scrolled
 * to and who owns the scroll are all `use-reading-surface`'s, shared with the
 * Çoklu view. This file draws bars.
 *
 * Two consequences worth naming:
 *
 * - **No timing arithmetic here.** A tick becomes an x through the song axis
 *   and nowhere else, so the playhead cannot land a slot away from the note
 *   it is over.
 * - **Only part of the song is mounted.** The scroll content keeps the axis's
 *   full width and every mounted bar sits at its real place on it, so a
 *   selection, a seek, a bar command and an export cannot tell the
 *   difference — they read the Song, never the DOM.
 */
import { useEffect, useMemo, useRef } from "react";

import { DrumBarBlock } from "@/components/workspace/DrumBarBlock";
import { DrumStepLane } from "@/components/workspace/DrumStepLane";
import { PitchedStepLane } from "@/components/workspace/PitchedStepLane";
import type { PitchedStepArming } from "@/components/workspace/PitchedMultiLane";
import type { DrumStepArming } from "@/components/workspace/DrumMultiLane";
import {
  FrettedBarBlock,
  type DurationGestureProps,
  type CellSelection,
  type OnsetSelection,
} from "@/components/workspace/FrettedBarBlock";
import {
  BAR_HEADER_HEIGHT,
  DRUM_ROW_HEIGHT,
  GUTTER_WIDTH,
  RHYTHM_ROW_HEIGHT,
  STAFF_TOP_PADDING,
  EDIT_STRING_ROW_HEIGHT,
  STRING_ROW_HEIGHT,
} from "@/components/workspace/geometry";
import { PlayheadLayer } from "@/components/workspace/PlayheadLayer";
import { ReturnToPlayback } from "@/components/workspace/ReturnToPlayback";
import { SectionMarkers } from "@/components/workspace/SectionMarkers";
import { BarSlot, DRUM_LABEL } from "@/components/workspace/TabBarSlot";
import { TabGutter } from "@/components/workspace/TabGutter";
import { gridLabelFor } from "@/components/workspace/grid-label";
import { frettedRowLabels } from "@/components/workspace/staff";
import { pointerOwner } from "@/lib/tab/pointer-ownership";
import {
  staffPointerHandlers,
  useBackgroundPan,
} from "@/lib/ui/use-background-pan";
import type { NoteRangeGesture } from "@/lib/ui/use-note-range-drag";
import { xAtTicks } from "@/lib/tab/song-axis";
import { useArmedGridRow } from "@/lib/workspace/use-armed-grid-row";
import { useReadingSurface } from "@/lib/workspace/use-reading-surface";
import { useTabPlayhead } from "@/components/workspace/use-tab-playhead";
import type { PlayPosition } from "@/lib/audio/position";
import type { BarRangeGesture } from "@/lib/ui/use-bar-range-drag";
import type { PenGhost } from "@/lib/tab/pen-ghost";
import type { Song } from "@/lib/song/schema";
import type { DrumBar, FrettedBar, TrackTimeline } from "@/lib/tab/timeline";

/** Bars are found by this attribute, so no child refs are needed. */
// Re-exported from geometry so existing importers keep their path.
export { BAR_KEY_ATTRIBUTE } from "@/components/workspace/geometry";




export function TabCanvas({
  song,
  timeline,
  getPosition,
  running,
  activeBarKey,
  onScrolledToSection,
  pendingScroll,
  onPendingHandled,
  onActiveBarChange,
  onSeekBar,
  barRange,
  scrollRef,
  selectionBand,
  onSlotLongPress,
  noteRange,
  onHandleMove,
  onHandleUp,
  drumEntry = null,
  pitchedEntry = null,
  editing = false,
  selectedCell = null,
  duration = null,
  penGhost = null,
  onPenTarget,
  onCellSelect,
  onsetsForBar,
}: {
  song: Song;
  timeline: TrackTimeline;
  getPosition: () => PlayPosition;
  running: boolean;
  activeBarKey: string | null;
  /**
   * The reader scrolled themselves into a different section (2Q-C §4).
   *
   * The tab draws the whole song in one scroller, so which section is on
   * screen is a fact about the scroll position and nothing else. It is
   * reported rather than received: the surface is where the answer actually
   * lives, and it also says so in the DOM.
   */
  onScrolledToSection: (sectionId: string) => void;
  /**
   * A bar the surface has been asked to bring into view, or null.
   *
   * `follows` distinguishes a bar tap (which seeks, so the view may go back
   * to following the transport) from a section choice (which does not).
   */
  pendingScroll: { barKey: string; follows: boolean } | null;
  onPendingHandled: () => void;
  onActiveBarChange: (barKey: string | null) => void;
  onSeekBar: (barKey: string) => void;
  /**
   * A long press on a bar's header, asking for that bar on the active track
   * (spec 13.12). Absent means the gesture is not offered on this surface.
   */
  /**
   * Hold a bar and reach across its neighbours (spec 13.12, 2U-B §8).
   *
   * One gesture for both, rather than a press callback plus a separate way to
   * widen: the founder could select a bar and could not extend the selection
   * to the next one, because "press" and "reach" were different mechanisms
   * living on different surfaces.
   */
  barRange?: BarRangeGesture;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** The time band, already positioned; null when nothing is selected. */
  selectionBand?: React.ReactNode;
  /**
   * A long press landed on a slot. Only fires once the press has outlived the
   * threshold without becoming a drag, so a flick to scroll never reaches it.
   */
  onSlotLongPress?: (x: number) => boolean;
  /** Hold a note and reach across its slots in one gesture (2U-C §3). */
  noteRange?: NoteRangeGesture;
  /** Handle drag, forwarded so the pointer stream has one owner. */
  onHandleMove?: (event: React.PointerEvent) => void;
  onHandleUp?: () => void;
  /** Edit mode turns each bar into a grid of cells (spec 13.1). */
  /**
   * The kit's step grid, armed, or null (2Q-B §5.3).
   *
   * The tab draws a fretboard; a kit is drawn by the same component the
   * Çoklu view uses, from the same model, so a hit written here and a hit
   * written there are the same hit and not two implementations of one.
   */
  drumEntry?: DrumStepArming | null;
  /**
   * The fretless track's strip, armed, or null (2Q-B §7.3).
   *
   * The tab has no notation for an instrument with no fretboard and does not
   * pretend otherwise — the sentence saying so stays. What it gains here is a
   * way to *write*: the same strip the Çoklu view draws, from the same model,
   * under the honest sentence rather than instead of it.
   */
  pitchedEntry?: PitchedStepArming | null;
  editing?: boolean;
  selectedCell?: (CellSelection & { barKey: string }) | null;
  /** The finger on the selected note's length, handed straight through. */
  duration?: DurationGestureProps | null;
  /** The armed pen's whole shape, on the bar it belongs to (K-59 §6). */
  penGhost?: PenGhost | null;
  /** The beat under the finger while a pen is armed (K-59 §6). */
  onPenTarget?: (cell: (CellSelection & { barKey: string }) | null) => void;
  onCellSelect?: (cell: CellSelection & { barKey: string }) => void;
  /** The group selection, resolved for one bar at a time (spec 13.1). */
  onsetsForBar?: (bar: FrettedBar) => OnsetSelection | null;
}) {
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  /*
   * Where the bars are, which of them are mounted, and who owns the scroll.
   *
   * All four questions have one owner (2Q-C §3–§7), shared with the Çoklu
   * view. The origin is the sticky gutter: an axis position and a scroll
   * position differ by exactly its width, and this is the only place that
   * conversion happens.
   */
  const surface = useReadingSurface({
    song,
    scrollRef,
    running,
    originPx: GUTTER_WIDTH,
    onScrolledToSection,
  });

  const drawn = useMemo(
    () => new Set(surface.window.renderedBarKeys),
    [surface.window],
  );

  /*
   * An armed kit draws one section as a step grid, at that section's own x on
   * the shared axis so its bar lines still land where the reading lane's
   * would. Only the columns near the viewport are mounted: at 1/32 a section
   * is 256 of them and about eleven fit on a phone (2R-A §6).
   *
   * The row's three parts still add up to `contentWidthPx` exactly — the tail
   * is a remainder, not a sum — so an armed kit never widens the surface.
   */
  const { grid, leadPx, tailPx } = useArmedGridRow({
    surface,
    model: drumEntry?.model ?? null,
    scrollRef,
    originPx: GUTTER_WIDTH,
  });

  const { scrollToBar } = surface;
  useEffect(() => {
    if (pendingScroll === null) return;
    scrollToBar(pendingScroll.barKey, pendingScroll.follows);
    onPendingHandled();
  }, [onPendingHandled, pendingScroll, scrollToBar]);

  const { axis, follow, originPx } = surface;
  useTabPlayhead({
    axis,
    originPx,
    running,
    getPosition,
    follow,
    onActiveBarChange,
    playheadRef,
    contentRef,
  });

  /*
   * The press is measured against the content, not the viewport, so the tick
   * it resolves to is the one under the finger whatever the tab is scrolled
   * to. Reading the rect at fire time rather than at press time keeps that
   * true even if the tab moved during the press.
   */
  /* A writing pen takes the press; both gestures used to run (K-59.1 §5). */
  const owner = pointerOwner({
    noteRangeOwning: noteRange?.owning === true,
    penArmed: onPenTarget !== undefined,
    selectionAvailable: onSlotLongPress !== undefined,
  });
  /*
   * The staff's press is the note-range drag now (2U-C §3), not a long press
   * that fires and forgets. The gesture is the same up to the threshold; what
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
    enabled: selectionBand != null && onPenTarget === undefined,
  });

  if (timeline.kind === "unsupported") {
    if (!pitchedEntry) {
      return (
        <div className="text-muted flex h-full items-center justify-center px-6 text-center text-sm">
          {timeline.reason}
        </div>
      );
    }
    return (
      <div className="flex h-full flex-col">
        <p className="text-muted shrink-0 px-4 py-3 text-xs">{timeline.reason}</p>
        <div
          ref={scrollRef}
          className="overflow-x-auto overscroll-x-contain"
          style={{ paddingTop: STAFF_TOP_PADDING }}
        >
          <PitchedStepLane model={pitchedEntry.model} entry={pitchedEntry} />
        </div>
      </div>
    );
  }

  const isFretted = timeline.kind === "fretted";
  const rows = isFretted ? timeline.strings.length : timeline.lanes.length;
  /*
   * The gutter's labels sit on the same rows the staff does, and in edit mode
   * a fretted row is the finger's height rather than the reading height
   * (2S-A §4). One expression, so the two can never disagree.
   */
  const rowHeight = isFretted
    ? editing
      ? EDIT_STRING_ROW_HEIGHT
      : STRING_ROW_HEIGHT
    : DRUM_ROW_HEIGHT;
  const bodyHeight = Math.max(rows, 1) * rowHeight;

  const labels = isFretted
    ? frettedRowLabels(timeline.strings)
    : timeline.lanes.map((lane) => DRUM_LABEL[lane] ?? lane.slice(0, 2));

  const bars: readonly (FrettedBar | DrumBar)[] = timeline.bars;
  /*
   * Where the window starts in the timeline. The window is a contiguous run
   * of bars, so one index is enough to give a mounted bar its real position —
   * and the grid label has to know it, because "the grid changed here" is a
   * claim about the bar before this one whether or not that bar is mounted.
   */
  const firstDrawn = Math.max(
    0,
    bars.findIndex((bar) => drawn.has(bar.key)),
  );

  return (
    <div className="relative h-full">
      <ReturnToPlayback
        shown={surface.detached}
        onReturn={() => surface.returnToPlayback(xAtTicks(axis, getPosition().ticks))}
      />
      <div
        ref={scrollRef}
        className="h-full overflow-x-auto overscroll-x-contain"
        style={{ paddingTop: STAFF_TOP_PADDING }}
      >
        <div
          data-tab-content
          data-viewed-section={surface.viewedSectionId ?? undefined}
          className="relative flex"
          style={{ width: surface.contentWidthPx }}
          ref={contentRef}
          {...staffPointerHandlers({ staffPress, pan, onHandleMove, onHandleUp })}
        >
          <TabGutter labels={labels} rowHeight={rowHeight} bodyHeight={bodyHeight} />

          {/* Positioned in tab coordinates, so it scrolls with the music and
              stays under the sticky gutter rather than over the string names. */}
          {selectionBand}

          {/* Not while writing: the header already names it (K-59 §4). */}
          {editing ? null : <SectionMarkers axis={surface.axis} sections={song.sections} />}

          {/* The bars before this window. Empty, never a hit target, and
              exactly as wide as the music it stands in for — which is what
              makes a scroll position mean the same thing whether or not the
              bar under it happens to be mounted. */}
          <div
            aria-hidden
            data-window-lead
            className="shrink-0"
            style={{ width: leadPx }}
          />

          {timeline.kind === "fretted"
            ? timeline.bars
                .filter((bar) => drawn.has(bar.key))
                .map((bar, index) => (
                <BarSlot key={bar.key} bar={bar} bars={bars} showSectionName={!editing}>
                  <FrettedBarBlock
                    bar={bar}
                    gridLabel={gridLabelFor(bars, firstDrawn + index)}
                    stringCount={timeline.strings.length}
                    selected={activeBarKey === bar.key}
                    onSelect={() => onSeekBar(bar.key)}
                    editing={editing}
                    selectedCell={
                      selectedCell?.barKey === bar.key ? selectedCell : null
                    }
                    onCellSelect={(cell) =>
                      onCellSelect?.({ ...cell, barKey: bar.key })
                    }
                    onsets={onsetsForBar?.(bar) ?? null}
                    duration={selectedCell?.barKey === bar.key ? duration : null}
                    ghost={penGhost?.barKey === bar.key ? penGhost : null}
                    onPenTarget={(cell) =>
                      onPenTarget?.(cell && { ...cell, barKey: bar.key })
                    }
                    timeSelectionOwnsPress={onSlotLongPress !== undefined}
                    barDrag={
                      barRange
                        ? {
                            handlers: barRange.handlers(bar.barIndex, bar.sectionId),
                            owning: barRange.owning,
                          }
                        : undefined
                    }
                  />
                </BarSlot>
              ))
            : drumEntry
            ? [
                <DrumStepLane
                  key="drum-step"
                  model={drumEntry.model}
                  axis={grid.axis}
                  window={grid.window}
                  entry={drumEntry}
                />,
              ]
            : timeline.bars
                .filter((bar) => drawn.has(bar.key))
                .map((bar, index) => (
                <BarSlot key={bar.key} bar={bar} bars={bars} showSectionName={!editing}>
                  <DrumBarBlock
                    bar={bar}
                    gridLabel={gridLabelFor(bars, firstDrawn + index)}
                    laneCount={timeline.lanes.length}
                    selected={activeBarKey === bar.key}
                    onSelect={() => onSeekBar(bar.key)}
                    barDrag={
                      barRange
                        ? {
                            handlers: barRange.handlers(bar.barIndex, bar.sectionId),
                            owning: barRange.owning,
                          }
                        : undefined
                    }
                  />
                </BarSlot>
              ))}
          {/*
            The bars after this window, and then the tail.
            
            The tail is the room every section needs to reach the reading
            anchor: without it the tab can only scroll until its content runs
            out, and on a short song that is nowhere near far enough — the
            reproduction measured a requested scroll of 272 against a possible
            188, so asking for the second section left the first one exactly
            where it was (spec 13.20 §3, `eval/tab/DEFECTS.json`). It carries
            no bar, no key and no ticks: it is not on the axis, and nothing
            that reasons about the song can see it.
          */}
          <div
            aria-hidden
            data-tab-tail
            className="shrink-0"
            style={{ width: tailPx }}
          />

          <PlayheadLayer
            layerRef={playheadRef}
            height={BAR_HEADER_HEIGHT + bodyHeight + RHYTHM_ROW_HEIGHT}
          />
        </div>
      </div>

      {/* The timeline carries on past the right edge. */}
      <div
        aria-hidden
        className="from-app pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l to-transparent"
      />
    </div>
  );
}

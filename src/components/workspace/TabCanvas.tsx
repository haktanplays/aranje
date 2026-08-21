"use client";

import { useEffect, useRef } from "react";

import { DrumBarBlock } from "@/components/workspace/DrumBarBlock";
import {
  FrettedBarBlock,
  type CellSelection,
  type OnsetSelection,
} from "@/components/workspace/FrettedBarBlock";
import {
  BAR_HEADER_HEIGHT,
  DRUM_ROW_HEIGHT,
  GUTTER_WIDTH,
  RHYTHM_ROW_HEIGHT,
  STAFF_TOP_PADDING,
  STRING_ROW_HEIGHT,
} from "@/components/workspace/geometry";
import { PlayheadLayer } from "@/components/workspace/PlayheadLayer";
import { followScrollLeft, playheadX } from "@/components/workspace/playhead";
import { frettedRowLabels } from "@/components/workspace/staff";
import { useLongPress } from "@/lib/ui/use-long-press";
import type { PlayPosition } from "@/lib/audio/position";
import type { SongPlan } from "@/lib/audio/schedule";
import type { SectionStatus } from "@/lib/song/schema";
import type { DrumBar, FrettedBar, TrackTimeline } from "@/lib/tab/timeline";
import {
  isTripletGrid,
  resolutionLabel,
  type Resolution,
} from "@/lib/music/timing";

/** Bars are found by this attribute, so no child refs are needed. */
export const BAR_KEY_ATTRIBUTE = "data-bar-key";

/**
 * The grid to write on a bar's header, or nothing (spec 5.5, 13.x, K-34).
 *
 * Shown when the grid *changes* — a reader needs to know the counting just
 * changed, and marking every bar of a piece written on one grid would be
 * noise — and always on a triplet bar, because "three to the beat here" is
 * true whether or not the bar before it was the same.
 *
 * The label is a note value, never the raw number: "1/12" sitting next to
 * "1/16" reads as a straight grid, which is exactly what it is not.
 */
export function gridLabelFor(
  bars: readonly { resolution: Resolution }[],
  index: number,
): string | null {
  const bar = bars[index];
  if (!bar) return null;
  const previous = index > 0 ? bars[index - 1] : undefined;
  const changed = previous === undefined || previous.resolution !== bar.resolution;
  if (!changed && !isTripletGrid(bar.resolution)) return null;
  return resolutionLabel(bar.resolution);
}

const DRUM_LABEL: Record<string, string> = {
  crash: "CR",
  china: "CH",
  ride: "RD",
  open_hat: "OH",
  closed_hat: "HH",
  tom_high: "T1",
  tom_mid: "T2",
  tom_floor: "FT",
  snare: "SN",
  kick: "BD",
};

/** Spec 13.6: bronze marks an AI suggestion, green an accepted one; a settled
    section stays neutral so gold does not end up on every bar. */
function sectionAccent(status: SectionStatus): string {
  if (status === "pending") return "bg-bronze";
  if (status === "accepted") return "bg-accept";
  return "bg-muted/60";
}

function sectionText(status: SectionStatus): string {
  if (status === "pending") return "text-bronze";
  if (status === "accepted") return "text-accept";
  return "text-muted";
}

/** True when this track writes nothing anywhere in the section. */
function sectionIsSilent(
  bars: readonly (FrettedBar | DrumBar)[],
  sectionId: string,
): boolean {
  const inSection = bars.filter((bar) => bar.sectionId === sectionId);
  return inSection.length > 0 && inSection.every((bar) => bar.silent);
}

export function TabCanvas({
  timeline,
  plan,
  getPosition,
  running,
  activeBarKey,
  onActiveBarChange,
  onSeekBar,
  scrollRef,
  selectionBand,
  onSlotLongPress,
  onHandleMove,
  onHandleUp,
  editing = false,
  selectedCell = null,
  onCellSelect,
  onsetsForBar,
}: {
  timeline: TrackTimeline;
  plan: SongPlan;
  getPosition: () => PlayPosition;
  running: boolean;
  activeBarKey: string | null;
  onActiveBarChange: (barKey: string | null) => void;
  onSeekBar: (barKey: string) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** The time band, already positioned; null when nothing is selected. */
  selectionBand?: React.ReactNode;
  /**
   * A long press landed on a slot. Only fires once the press has outlived the
   * threshold without becoming a drag, so a flick to scroll never reaches it.
   */
  onSlotLongPress?: (x: number) => void;
  /** Handle drag, forwarded so the pointer stream has one owner. */
  onHandleMove?: (event: React.PointerEvent) => void;
  onHandleUp?: () => void;
  /** Edit mode turns each bar into a grid of cells (spec 13.1). */
  editing?: boolean;
  selectedCell?: (CellSelection & { barKey: string }) | null;
  onCellSelect?: (cell: CellSelection & { barKey: string }) => void;
  /** The group selection, resolved for one bar at a time (spec 13.1). */
  onsetsForBar?: (bar: FrettedBar) => OnsetSelection | null;
}) {
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const lastBarKey = useRef<string | null>(null);

  /*
   * The playhead is driven from the transport on an animation frame. Audio is
   * never scheduled here, and the element is moved by transform rather than by
   * React state, so a frame costs no render.
   */
  useEffect(() => {
    let frame = 0;

    const draw = () => {
      const position = getPosition();
      const x = playheadX(plan, position);
      const element = playheadRef.current;

      if (element) {
        if (x === null) {
          element.style.opacity = "0";
        } else {
          element.style.opacity = "1";
          element.style.transform = `translateX(${x}px)`;
        }
      }

      if (position.barKey !== lastBarKey.current) {
        lastBarKey.current = position.barKey;
        onActiveBarChange(position.barKey);
      }

      const scroller = scrollRef.current;
      if (scroller && x !== null) {
        const target = followScrollLeft(
          x,
          { scrollLeft: scroller.scrollLeft, clientWidth: scroller.clientWidth },
          scroller.scrollWidth,
        );
        // Set directly: a smooth scroll every frame would trail the playhead.
        if (target !== null) scroller.scrollLeft = target;
      }

      if (running) frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [running, plan, getPosition, onActiveBarChange, scrollRef]);

  const contentRef = useRef<HTMLDivElement | null>(null);

  /*
   * The press is measured against the content, not the viewport, so the tick
   * it resolves to is the one under the finger whatever the tab is scrolled
   * to. Reading the rect at fire time rather than at press time keeps that
   * true even if the tab moved during the press.
   */
  const longPress = useLongPress(
    ({ clientX }) => {
      const element = contentRef.current;
      if (!element || !onSlotLongPress) return;
      /*
       * The content row begins with the sticky gutter, so a position measured
       * from its left edge is one gutter too far right for the bars. Without
       * this the finger lands a slot or two before the note it is over, and
       * the selection quietly picks the wrong music.
       */
      onSlotLongPress(clientX - element.getBoundingClientRect().left - GUTTER_WIDTH);
    },
    { enabled: onSlotLongPress !== undefined },
  );

  if (timeline.kind === "unsupported") {
    return (
      <div className="text-muted flex h-full items-center justify-center px-6 text-center text-sm">
        {timeline.reason}
      </div>
    );
  }

  const isFretted = timeline.kind === "fretted";
  const rows = isFretted ? timeline.strings.length : timeline.lanes.length;
  const rowHeight = isFretted ? STRING_ROW_HEIGHT : DRUM_ROW_HEIGHT;
  const bodyHeight = Math.max(rows, 1) * rowHeight;

  const labels = isFretted
    ? frettedRowLabels(timeline.strings)
    : timeline.lanes.map((lane) => DRUM_LABEL[lane] ?? lane.slice(0, 2));

  const bars: readonly (FrettedBar | DrumBar)[] = timeline.bars;

  return (
    <div className="relative h-full">
      <div
        ref={scrollRef}
        className="h-full overflow-x-auto overscroll-x-contain"
        style={{ paddingTop: STAFF_TOP_PADDING }}
      >
        <div
          data-tab-content
          className="relative flex min-w-max"
          ref={contentRef}
          {...longPress}
          onPointerMove={(event) => {
            longPress.onPointerMove(event);
            onHandleMove?.(event);
          }}
          onPointerUp={() => {
            longPress.onPointerUp();
            onHandleUp?.();
          }}
        >
          {/* String or lane names stay put while the bars scroll past */}
          <div
            className="bg-app sticky left-0 z-10 shrink-0"
            style={{ width: GUTTER_WIDTH }}
          >
            <div style={{ height: BAR_HEADER_HEIGHT }} />
            <div className="relative" style={{ height: bodyHeight }}>
              {labels.map((label, index) => (
                <span
                  key={index}
                  className="text-muted/80 absolute flex items-center justify-center font-mono text-[10px]"
                  style={{
                    top: index * rowHeight,
                    height: rowHeight,
                    width: GUTTER_WIDTH,
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
            <div style={{ height: RHYTHM_ROW_HEIGHT }} />

            {/* Notes scrolling past the labels disappear under this strip
                instead of being sliced in half at the gutter edge. A fret
                glyph is about 14px wide, so the solid part alone is wider than
                any glyph can be. */}
            <span
              aria-hidden
              className="bg-app pointer-events-none absolute inset-y-0 left-full w-2.5"
            />
            <span
              aria-hidden
              className="from-app pointer-events-none absolute inset-y-0 w-4 bg-gradient-to-r to-transparent"
              style={{ left: "calc(100% + 0.625rem)" }}
            />
          </div>

          {/* Positioned in tab coordinates, so it scrolls with the music and
              stays under the sticky gutter rather than over the string names. */}
          {selectionBand}

          {timeline.kind === "fretted"
            ? timeline.bars.map((bar, barIndex) => (
                <BarSlot key={bar.key} bar={bar} bars={bars}>
                  <FrettedBarBlock
                    bar={bar}
                    gridLabel={gridLabelFor(timeline.bars, barIndex)}
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
                  />
                </BarSlot>
              ))
            : timeline.bars.map((bar, barIndex) => (
                <BarSlot key={bar.key} bar={bar} bars={bars}>
                  <DrumBarBlock
                    bar={bar}
                    gridLabel={gridLabelFor(timeline.bars, barIndex)}
                    laneCount={timeline.lanes.length}
                    selected={activeBarKey === bar.key}
                    onSelect={() => onSeekBar(bar.key)}
                  />
                </BarSlot>
              ))}
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

/** Wraps a bar with its section marker and, at a section start, its name. */
function BarSlot({
  bar,
  bars,
  children,
}: {
  bar: FrettedBar | DrumBar;
  bars: readonly (FrettedBar | DrumBar)[];
  children: React.ReactNode;
}) {
  return (
    <div data-bar-key={bar.key} className="relative">
      {bar.isSectionStart ? (
        <>
          <span
            aria-hidden
            className={`absolute top-0 bottom-0 left-0 z-10 w-0.5 ${sectionAccent(
              bar.sectionStatus,
            )}`}
          />
          <span
            className={`absolute -top-5 left-1.5 text-[9px] font-semibold tracking-[0.12em] whitespace-nowrap uppercase ${sectionText(
              bar.sectionStatus,
            )}`}
          >
            {bar.sectionName}
            {sectionIsSilent(bars, bar.sectionId) ? (
              <span className="text-muted/60 ml-1.5 tracking-normal normal-case">
                (bu track susuyor)
              </span>
            ) : null}
          </span>
        </>
      ) : null}
      {children}
    </div>
  );
}

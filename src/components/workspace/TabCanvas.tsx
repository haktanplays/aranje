"use client";

import { useEffect, useRef } from "react";

import { DrumBarBlock } from "@/components/workspace/DrumBarBlock";
import {
  FrettedBarBlock,
  type CellSelection,
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
import type { PlayPosition } from "@/lib/audio/position";
import type { SongPlan } from "@/lib/audio/schedule";
import type { SectionStatus } from "@/lib/song/schema";
import type { DrumBar, FrettedBar, TrackTimeline } from "@/lib/tab/timeline";

/** Bars are found by this attribute, so no child refs are needed. */
export const BAR_KEY_ATTRIBUTE = "data-bar-key";

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
  editing = false,
  selectedCell = null,
  onCellSelect,
}: {
  timeline: TrackTimeline;
  plan: SongPlan;
  getPosition: () => PlayPosition;
  running: boolean;
  activeBarKey: string | null;
  onActiveBarChange: (barKey: string | null) => void;
  onSeekBar: (barKey: string) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** Edit mode turns each bar into a grid of cells (spec 13.1). */
  editing?: boolean;
  selectedCell?: (CellSelection & { barKey: string }) | null;
  onCellSelect?: (cell: CellSelection & { barKey: string }) => void;
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
        <div className="relative flex min-w-max">
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

          {timeline.kind === "fretted"
            ? timeline.bars.map((bar) => (
                <BarSlot key={bar.key} bar={bar} bars={bars}>
                  <FrettedBarBlock
                    bar={bar}
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
                  />
                </BarSlot>
              ))
            : timeline.bars.map((bar) => (
                <BarSlot key={bar.key} bar={bar} bars={bars}>
                  <DrumBarBlock
                    bar={bar}
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

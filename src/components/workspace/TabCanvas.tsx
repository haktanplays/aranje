"use client";

import { DrumBarBlock } from "@/components/workspace/DrumBarBlock";
import { FrettedBarBlock } from "@/components/workspace/FrettedBarBlock";
import {
  BAR_HEADER_HEIGHT,
  DRUM_ROW_HEIGHT,
  GUTTER_WIDTH,
  RHYTHM_ROW_HEIGHT,
  STAFF_TOP_PADDING,
  STRING_ROW_HEIGHT,
} from "@/components/workspace/geometry";
import type { PlayheadPosition } from "@/components/workspace/PlayheadLayer";
import { frettedRowLabels } from "@/components/workspace/staff";
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
  selectedBarKey,
  onSelectBar,
  scrollRef,
}: {
  timeline: TrackTimeline;
  selectedBarKey: string | null;
  onSelectBar: (barKey: string) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  // The transport is the next checkpoint, so no playhead is placed yet.
  const playhead: PlayheadPosition | null = null;

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
          </div>

          {timeline.kind === "fretted"
            ? timeline.bars.map((bar) => (
                <BarSlot key={bar.key} bar={bar} bars={bars}>
                  <FrettedBarBlock
                    bar={bar}
                    stringCount={timeline.strings.length}
                    selected={selectedBarKey === bar.key}
                    playhead={playhead}
                    onSelect={() => onSelectBar(bar.key)}
                  />
                </BarSlot>
              ))
            : timeline.bars.map((bar) => (
                <BarSlot key={bar.key} bar={bar} bars={bars}>
                  <DrumBarBlock
                    bar={bar}
                    laneCount={timeline.lanes.length}
                    selected={selectedBarKey === bar.key}
                    playhead={playhead}
                    onSelect={() => onSelectBar(bar.key)}
                  />
                </BarSlot>
              ))}
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

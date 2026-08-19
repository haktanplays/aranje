"use client";

import { DrumBarBlock } from "@/components/workspace/DrumBarBlock";
import { FrettedBarBlock } from "@/components/workspace/FrettedBarBlock";
import {
  BAR_HEADER_HEIGHT,
  DRUM_ROW_HEIGHT,
  GUTTER_WIDTH,
  RHYTHM_ROW_HEIGHT,
  STRING_ROW_HEIGHT,
} from "@/components/workspace/geometry";
import type { PlayheadPosition } from "@/components/workspace/PlayheadLayer";
import { frettedRowLabels } from "@/components/workspace/staff";
import type { TrackTimeline } from "@/lib/tab/timeline";

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

/** Bars are found by this attribute, so no child refs are needed. */
export const BAR_KEY_ATTRIBUTE = "data-bar-key";

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

  // Fretted staves read thinnest string first; drum lanes keep their own
  // cymbal-to-kick order untouched.
  const labels = isFretted
    ? frettedRowLabels(timeline.strings)
    : timeline.lanes.map((lane) => DRUM_LABEL[lane] ?? lane.slice(0, 2));

  return (
    <div
      ref={scrollRef}
      className="flex h-full items-center overflow-x-auto overscroll-x-contain"
    >
      <div className="flex min-w-max">
        {/* String or lane names stay put while the bars scroll past */}
        <div
          className="bg-app sticky left-0 z-10 shrink-0 border-r border-line"
          style={{ width: GUTTER_WIDTH }}
        >
          <div style={{ height: BAR_HEADER_HEIGHT }} />
          <div className="relative" style={{ height: bodyHeight }}>
            {labels.map((label, index) => (
              <span
                key={index}
                className="text-muted absolute flex items-center justify-center text-[10px] font-medium tracking-wide"
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
              <div key={bar.key} data-bar-key={bar.key} className="relative">
                {bar.isSectionStart ? <SectionMark /> : null}
                <FrettedBarBlock
                  bar={bar}
                  stringCount={timeline.strings.length}
                  selected={selectedBarKey === bar.key}
                  playhead={playhead}
                  onSelect={() => onSelectBar(bar.key)}
                />
              </div>
            ))
          : timeline.bars.map((bar) => (
              <div key={bar.key} data-bar-key={bar.key} className="relative">
                {bar.isSectionStart ? <SectionMark /> : null}
                <DrumBarBlock
                  bar={bar}
                  laneCount={timeline.lanes.length}
                  selected={selectedBarKey === bar.key}
                  playhead={playhead}
                  onSelect={() => onSelectBar(bar.key)}
                />
              </div>
            ))}
      </div>
    </div>
  );
}

/** Bronze rule on the bar line where a section begins. The name itself sits in
    the bar header, so nothing covers the bar number. */
function SectionMark() {
  return (
    <span
      aria-hidden
      className="bg-bronze absolute top-0 bottom-0 left-0 z-10 w-0.5"
    />
  );
}

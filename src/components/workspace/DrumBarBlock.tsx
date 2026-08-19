import {
  BAR_HEADER_HEIGHT,
  DRUM_ROW_HEIGHT,
  RHYTHM_ROW_HEIGHT,
  SLOT_WIDTH,
  barWidth,
} from "@/components/workspace/geometry";
import {
  PlayheadLayer,
  type PlayheadPosition,
} from "@/components/workspace/PlayheadLayer";
import { RhythmStrip } from "@/components/workspace/RhythmStrip";
import { drumRhythm, type DrumBar } from "@/lib/tab/timeline";
import type { DrumPiece } from "@/lib/song/schema";

const CYMBALS = new Set<DrumPiece>(["crash", "ride", "china"]);
const HATS = new Set<DrumPiece>(["closed_hat", "open_hat"]);

/** Cymbals and hats read as crosses, membranes as filled heads. */
function Glyph({ piece }: { piece: DrumPiece }) {
  if (HATS.has(piece)) {
    return (
      <span className="text-bronze text-[11px] leading-none font-semibold">
        x
      </span>
    );
  }
  if (CYMBALS.has(piece)) {
    return (
      <span className="border-bronze block size-2.5 rotate-45 border" />
    );
  }
  return <span className="bg-bronze block size-2.5 rounded-full" />;
}

export function DrumBarBlock({
  bar,
  laneCount,
  selected,
  playhead,
  onSelect,
}: {
  bar: DrumBar;
  laneCount: number;
  selected: boolean;
  playhead: PlayheadPosition | null;
  onSelect: () => void;
}) {
  const width = barWidth(bar.slotCount);
  const gridHeight = Math.max(laneCount, 1) * DRUM_ROW_HEIGHT;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Bar ${bar.barNumber}`}
      className={`relative shrink-0 border-r text-left ${
        selected ? "bg-raised border-steel" : "border-line bg-transparent"
      }`}
      style={{ width }}
    >
      <div
        className="flex items-center gap-1.5 overflow-hidden border-b border-line px-1.5"
        style={{ height: BAR_HEADER_HEIGHT }}
      >
        <span className="text-muted text-[10px] tabular-nums">
          {bar.barNumber}
        </span>
        {bar.isSectionStart ? (
          <span className="text-bronze truncate text-[9px] font-semibold tracking-[0.12em] uppercase">
            {bar.sectionName}
          </span>
        ) : null}
      </div>

      <div className="relative" style={{ height: gridHeight }}>
        {Array.from({ length: laneCount }, (_, laneIndex) => (
          <div
            key={laneIndex}
            className="bg-line/60 absolute right-0 left-0 h-px"
            style={{ top: laneIndex * DRUM_ROW_HEIGHT + DRUM_ROW_HEIGHT / 2 }}
          />
        ))}

        {Array.from({ length: bar.slotCount }, (_, slotIndex) =>
          slotIndex === 0 ? null : (
            <div
              key={`tick-${slotIndex}`}
              className="bg-line/40 absolute top-0 bottom-0 w-px"
              style={{ left: slotIndex * SLOT_WIDTH }}
            />
          ),
        )}

        {bar.silent ? (
          <span className="text-muted/50 absolute inset-0 flex items-center justify-center text-[10px] tracking-[0.2em] uppercase">
            sus
          </span>
        ) : null}

        {bar.marks.map((mark, index) => (
          <span
            key={index}
            className="absolute flex items-center justify-center"
            style={{
              left: mark.slotIndex * SLOT_WIDTH,
              top: mark.laneIndex * DRUM_ROW_HEIGHT,
              width: SLOT_WIDTH,
              height: DRUM_ROW_HEIGHT,
            }}
            title={mark.piece}
          >
            <Glyph piece={mark.piece} />
          </span>
        ))}

        <PlayheadLayer
          position={playhead}
          barKey={bar.key}
          height={gridHeight}
        />
      </div>

      <div style={{ height: RHYTHM_ROW_HEIGHT }}>
        <RhythmStrip states={drumRhythm(bar)} />
      </div>
    </button>
  );
}

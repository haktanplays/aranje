import {
  BAR_HEADER_HEIGHT,
  DRUM_ROW_HEIGHT,
  RHYTHM_ROW_HEIGHT,
  RHYTHM_STRIP_HEIGHT,
  SLOT_WIDTH,
  barWidth,
  slotsPerBeat,
} from "@/components/workspace/geometry";
import { RhythmGuideLayer } from "@/components/workspace/RhythmGuideLayer";
import { RhythmStrip } from "@/components/workspace/RhythmStrip";
import { buildRhythmGuide } from "@/lib/tab/rhythm-guide";
import { NO_PRESS, useLongPress } from "@/lib/ui/use-long-press";
import { drumRhythm, type DrumBar } from "@/lib/tab/timeline";
import type { DrumPiece } from "@/lib/song/schema";

const CYMBALS = new Set<DrumPiece>(["crash", "ride", "china"]);
const HATS = new Set<DrumPiece>(["closed_hat", "open_hat"]);

/** Cymbals and hats read as crosses, membranes as filled heads. */
function Glyph({ piece }: { piece: DrumPiece }) {
  if (HATS.has(piece)) {
    return (
      <span className="text-text/80 font-mono text-[11px] leading-none">x</span>
    );
  }
  if (CYMBALS.has(piece)) {
    return <span className="border-text/70 block size-2 rotate-45 border" />;
  }
  return <span className="bg-text/80 block size-2 rounded-full" />;
}

export function DrumBarBlock({
  bar,
  laneCount,
  gridLabel = null,
  selected,
  onSelect,
  onBarLongPress,
}: {
  bar: DrumBar;
  laneCount: number;
  /** Written in the header when the counting changes (spec 5.5, K-34). */
  gridLabel?: string | null;
  selected: boolean;
  onSelect: () => void;
  /** A long press on the header picks this bar up on this track (13.12). */
  onBarLongPress?: () => void;
}) {
  const width = barWidth(bar.slotCount);
  const gridHeight = Math.max(laneCount, 1) * DRUM_ROW_HEIGHT;
  const beat = slotsPerBeat(bar.timeSignature, bar.resolution);
  /* One reading of the bar's rhythm, shared by the strip and the guide. */
  const states = drumRhythm(bar);
  const barPress = useLongPress(onBarLongPress ?? NO_PRESS, {
    enabled: onBarLongPress !== undefined,
  });

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Bar ${bar.barNumber}`}
      className={`relative shrink-0 border-r text-left ${
        selected ? "bg-steel/8 border-steel" : "border-line bg-transparent"
      }`}
      style={{ width }}
    >
      <div
        {...barPress}
        onPointerDown={(event) => {
          if (!onBarLongPress) return;
          event.stopPropagation();
          barPress.onPointerDown(event);
        }}
        data-tab-bar-header={bar.key}
        className="flex items-center gap-1.5 overflow-hidden px-1.5"
        style={{ height: BAR_HEADER_HEIGHT, touchAction: "pan-x" }}
      >
        <span className="text-muted/70 text-[10px] tabular-nums">
          {bar.barNumber}
        </span>
        {gridLabel ? (
          <span className="text-bronze/80 truncate text-[10px]">{gridLabel}</span>
        ) : null}
      </div>

      <div className="relative" style={{ height: gridHeight }}>
        {Array.from({ length: laneCount }, (_, laneIndex) => (
          <div
            key={laneIndex}
            className="bg-line/70 absolute right-0 left-0 h-px"
            style={{ top: laneIndex * DRUM_ROW_HEIGHT + DRUM_ROW_HEIGHT / 2 }}
          />
        ))}

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

      </div>

      <div style={{ height: RHYTHM_ROW_HEIGHT }} className="relative">
        <RhythmStrip states={states} slotsPerBeat={beat} />
        {/* Drums get the same guide from the same states: a row of hi-hat
            eighths is exactly the rhythm this is for (spec 13.20 §7). */}
        <div className="absolute inset-x-0" style={{ top: RHYTHM_STRIP_HEIGHT }}>
          <RhythmGuideLayer
            guide={buildRhythmGuide(states, bar.timeSignature, bar.resolution)}
          />
        </div>
      </div>
    </button>
  );
}

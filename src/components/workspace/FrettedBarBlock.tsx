import { FretGlyph } from "@/components/workspace/FretGlyph";
import {
  BAR_HEADER_HEIGHT,
  RHYTHM_ROW_HEIGHT,
  SLOT_WIDTH,
  STRING_ROW_HEIGHT,
  barWidth,
  slotCentre,
  slotsPerBeat,
} from "@/components/workspace/geometry";
import {
  PlayheadLayer,
  type PlayheadPosition,
} from "@/components/workspace/PlayheadLayer";
import { RhythmStrip } from "@/components/workspace/RhythmStrip";
import { rowOffset } from "@/components/workspace/staff";
import { frettedRhythm, type FrettedBar } from "@/lib/tab/timeline";

export function FrettedBarBlock({
  bar,
  stringCount,
  selected,
  playhead,
  onSelect,
}: {
  bar: FrettedBar;
  stringCount: number;
  selected: boolean;
  playhead: PlayheadPosition | null;
  onSelect: () => void;
}) {
  const width = barWidth(bar.slotCount);
  const staffHeight = stringCount * STRING_ROW_HEIGHT;
  const beat = slotsPerBeat(bar.timeSignature, bar.resolution);

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
        className="flex items-center gap-1.5 overflow-hidden px-1.5"
        style={{ height: BAR_HEADER_HEIGHT }}
      >
        <span className="text-muted/70 text-[10px] tabular-nums">
          {bar.barNumber}
        </span>
      </div>

      <div className="relative" style={{ height: staffHeight }}>
        {/* Strings */}
        {Array.from({ length: stringCount }, (_, stringIndex) => (
          <div
            key={stringIndex}
            className="bg-line absolute right-0 left-0 h-px"
            style={{
              top:
                rowOffset(stringCount, stringIndex, STRING_ROW_HEIGHT) +
                STRING_ROW_HEIGHT / 2,
            }}
          />
        ))}

        {bar.silent ? null : (
          <>
            {/* How long each note keeps sounding */}
            {bar.spans.map((span, index) =>
              span.endSlot > span.startSlot || span.openEnd || span.openStart ? (
                <div
                  key={`sustain-${index}`}
                  className="bg-muted/45 absolute h-px"
                  style={{
                    top:
                      rowOffset(
                        stringCount,
                        span.stringIndex,
                        STRING_ROW_HEIGHT,
                      ) +
                      STRING_ROW_HEIGHT / 2,
                    left: span.openStart ? 0 : slotCentre(span.startSlot) + 7,
                    width: Math.max(
                      0,
                      (span.openEnd
                        ? width
                        : slotCentre(span.endSlot) + SLOT_WIDTH / 3) -
                        (span.openStart ? 0 : slotCentre(span.startSlot) + 7),
                    ),
                  }}
                />
              ) : null,
            )}

            {/* Fret numbers at each onset */}
            {bar.spans.map((span, index) =>
              span.openStart ? null : (
                <span
                  key={`fret-${index}`}
                  className="absolute flex items-center justify-center"
                  style={{
                    left: span.startSlot * SLOT_WIDTH,
                    top: rowOffset(
                      stringCount,
                      span.stringIndex,
                      STRING_ROW_HEIGHT,
                    ),
                    width: SLOT_WIDTH,
                    height: STRING_ROW_HEIGHT,
                  }}
                  title={span.pitch}
                >
                  <FretGlyph fret={span.fret} articulation={span.articulation} />
                </span>
              ),
            )}
          </>
        )}

        <PlayheadLayer
          position={playhead}
          barKey={bar.key}
          height={staffHeight}
        />
      </div>

      <div style={{ height: RHYTHM_ROW_HEIGHT }}>
        <RhythmStrip states={frettedRhythm(bar)} slotsPerBeat={beat} />
      </div>
    </button>
  );
}

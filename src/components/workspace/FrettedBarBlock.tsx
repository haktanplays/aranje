import {
  BAR_HEADER_HEIGHT,
  RHYTHM_ROW_HEIGHT,
  SLOT_WIDTH,
  STRING_ROW_HEIGHT,
  barWidth,
  slotCentre,
} from "@/components/workspace/geometry";
import {
  PlayheadLayer,
  type PlayheadPosition,
} from "@/components/workspace/PlayheadLayer";
import { rowOffset } from "@/components/workspace/staff";
import { RhythmStrip } from "@/components/workspace/RhythmStrip";
import { frettedRhythm, type FrettedBar } from "@/lib/tab/timeline";

/** Palm mutes read quieter than accents, so they are drawn quieter too. */
function fretClasses(articulation: string | undefined): string {
  if (articulation === "palm_mute") return "text-muted";
  if (articulation === "accent") return "text-text font-semibold";
  return "text-text";
}

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

        {/* Slot ticks, so the grid stays readable while scrolling */}
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

        {bar.silent ? null : (
          <>
            {/* Sustain lines: how long a note keeps sounding */}
            {bar.spans.map((span, index) =>
              span.endSlot > span.startSlot || span.openEnd || span.openStart ? (
                <div
                  key={`sustain-${index}`}
                  className="bg-bronze/60 absolute h-px"
                  style={{
                    top:
                      rowOffset(
                        stringCount,
                        span.stringIndex,
                        STRING_ROW_HEIGHT,
                      ) +
                      STRING_ROW_HEIGHT / 2,
                    left: span.openStart ? 0 : slotCentre(span.startSlot),
                    width:
                      (span.openEnd
                        ? width
                        : slotCentre(span.endSlot) + SLOT_WIDTH / 3) -
                      (span.openStart ? 0 : slotCentre(span.startSlot)),
                  }}
                />
              ) : null,
            )}

            {/* Fret numbers at each onset */}
            {bar.spans.map((span, index) =>
              span.openStart ? null : (
                <span
                  key={`fret-${index}`}
                  className={`bg-app absolute flex items-center justify-center text-[13px] leading-none tabular-nums ${fretClasses(
                    span.articulation,
                  )}`}
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
                  {span.fret ?? "?"}
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
        <RhythmStrip states={frettedRhythm(bar)} />
      </div>
    </button>
  );
}

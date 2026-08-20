"use client";

import { useCallback, useRef } from "react";

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
import { RhythmStrip } from "@/components/workspace/RhythmStrip";
import { rowOffset } from "@/components/workspace/staff";
import { frettedRhythm, type FrettedBar } from "@/lib/tab/timeline";

export type CellSelection = { slotIndex: number; stringIndex: number };

/** How long a press has to be held before it means "select this chord". */
export const LONG_PRESS_MS = 400;

/** What the bar knows about the group selection sitting on it (spec 13.1). */
export type OnsetSelection = {
  /** Slots in this bar that start a chord, so a tap has something to take. */
  onsetSlots: ReadonlySet<number>;
  /** Slots drawn as selected: the chosen chords and the ties they hold. */
  selectedSlots: ReadonlySet<number>;
  /** True once a selection exists, when a plain tap toggles rather than edits. */
  active: boolean;
  onToggle: (slotIndex: number) => void;
  onLongPress: (slotIndex: number) => void;
};

export function FrettedBarBlock({
  bar,
  stringCount,
  selected,
  onSelect,
  editing = false,
  selectedCell = null,
  onCellSelect,
  onsets = null,
}: {
  bar: FrettedBar;
  stringCount: number;
  selected: boolean;
  onSelect: () => void;
  /** In edit mode the bar is a grid of cells rather than one seek target. */
  editing?: boolean;
  selectedCell?: CellSelection | null;
  onCellSelect?: (cell: CellSelection) => void;
  onsets?: OnsetSelection | null;
}) {
  const width = barWidth(bar.slotCount);
  const staffHeight = stringCount * STRING_ROW_HEIGHT;
  const beat = slotsPerBeat(bar.timeSignature, bar.resolution);

  // A long press has to suppress the click that follows it, or picking a chord
  // up would also open the fret sheet behind it.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);

  const cancelHold = useCallback(() => {
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    holdTimer.current = null;
  }, []);

  const startHold = useCallback(
    (slotIndex: number) => {
      if (!onsets?.onsetSlots.has(slotIndex)) return;
      held.current = false;
      cancelHold();
      holdTimer.current = setTimeout(() => {
        held.current = true;
        onsets.onLongPress(slotIndex);
      }, LONG_PRESS_MS);
    },
    [cancelHold, onsets],
  );

  const Frame = editing ? "div" : "button";
  const frameProps = editing
    ? ({} as Record<string, unknown>)
    : {
        type: "button" as const,
        onClick: onSelect,
        "aria-pressed": selected,
        "aria-label": `Bar ${bar.barNumber}`,
      };

  return (
    <Frame
      {...frameProps}
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

        {/* Edit mode: one hit target per string and slot. The grid sits above
            the staff so a tap lands on a cell rather than on the bar. */}
        {editing
          ? Array.from({ length: bar.slotCount }, (_, slotIndex) =>
              Array.from({ length: stringCount }, (__, stringIndex) => {
                const isSelected =
                  selectedCell?.slotIndex === slotIndex &&
                  selectedCell.stringIndex === stringIndex;
                const inGroup = onsets?.selectedSlots.has(slotIndex) ?? false;
                const isOnset = onsets?.onsetSlots.has(slotIndex) ?? false;
                const groupActive = onsets?.active ?? false;
                const label = [
                  `Bar ${bar.barNumber}, slot ${slotIndex + 1}, tel ${stringIndex + 1}`,
                  isOnset ? "akor başlangıcı" : null,
                  inGroup ? "seçili" : null,
                ]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <button
                    key={`cell-${slotIndex}-${stringIndex}`}
                    type="button"
                    data-cell={`${slotIndex}:${stringIndex}`}
                    data-onset={isOnset ? "" : undefined}
                    data-group-selected={inGroup ? "" : undefined}
                    aria-pressed={isSelected || inGroup}
                    aria-label={label}
                    onPointerDown={() => startHold(slotIndex)}
                    onPointerUp={cancelHold}
                    onPointerLeave={cancelHold}
                    onPointerCancel={cancelHold}
                    onClick={() => {
                      cancelHold();
                      // The press that opened the selection is not also a tap.
                      if (held.current) {
                        held.current = false;
                        return;
                      }
                      if (groupActive) {
                        // A rest or a tie is not a chord of its own, so a tap
                        // on one changes nothing (spec 13.1).
                        if (isOnset) onsets?.onToggle(slotIndex);
                        return;
                      }
                      onCellSelect?.({ slotIndex, stringIndex });
                    }}
                    className={`absolute rounded-sm ${
                      inGroup
                        ? "ring-accept bg-accept/15 ring-2 ring-offset-0"
                        : isSelected
                          ? "ring-bronze bg-bronze/15 ring-2"
                          : "hover:bg-steel/10"
                    }`}
                    style={{
                      left: slotIndex * SLOT_WIDTH,
                      top: rowOffset(stringCount, stringIndex, STRING_ROW_HEIGHT),
                      width: SLOT_WIDTH,
                      height: STRING_ROW_HEIGHT,
                    }}
                  />
                );
              }),
            )
          : null}
      </div>

      <div style={{ height: RHYTHM_ROW_HEIGHT }}>
        <RhythmStrip states={frettedRhythm(bar)} slotsPerBeat={beat} />
      </div>
    </Frame>
  );
}

"use client";

import { useCallback, useRef } from "react";

import { ArticulationGlyph } from "@/components/workspace/ArticulationGlyph";
import { FretGlyph } from "@/components/workspace/FretGlyph";
import { TechniqueLayer } from "@/components/workspace/TechniqueLayer";
import {
  BAR_HEADER_HEIGHT,
  RHYTHM_ROW_HEIGHT,
  RHYTHM_STRIP_HEIGHT,
  EDIT_STRING_ROW_HEIGHT,
  SLOT_WIDTH,
  STRING_ROW_HEIGHT,
  barWidth,
  slotCentre,
  slotsPerBeat,
} from "@/components/workspace/geometry";
import { RhythmGuideLayer } from "@/components/workspace/RhythmGuideLayer";
import { RhythmStrip } from "@/components/workspace/RhythmStrip";
import {
  buildTechniquePrimitives,
  techniqueNoteKey,
} from "@/lib/tab/technique-geometry";
import type { GlyphState } from "@/lib/tab/glyph-model";
import { buildRhythmGuide } from "@/lib/tab/rhythm-guide";
import { rowOffset } from "@/components/workspace/staff";
import { frettedRhythm, type FrettedBar } from "@/lib/tab/timeline";
import { pitchToMidi } from "@/lib/music/pitch";
import { LONG_PRESS_MS } from "@/lib/ui/interaction";
import { NO_PRESS, useLongPress } from "@/lib/ui/use-long-press";

export type CellSelection = { slotIndex: number; stringIndex: number };

/**
 * Which way a slide leans, read from the bar itself.
 *
 * The direction is the **pitch** the hand ends up at against the pitch it left,
 * not which way the note moves on the screen and not which string it is on
 * (spec 13.9, K-23). On a fretboard drawn thickest-string-first those can point
 * opposite ways, and the glyph has to agree with what is heard.
 *
 * Only the previous onset on the same string within this bar is consulted: the
 * glyph is a hint about direction, and the validator is what decides whether a
 * slide is playable at all (spec 10.3).
 */
export function risingAt(
  bar: FrettedBar,
  span: FrettedBar["spans"][number],
): boolean | undefined {
  let previous: FrettedBar["spans"][number] | undefined;
  for (const other of bar.spans) {
    if (other.stringIndex !== span.stringIndex) continue;
    if (other.startSlot >= span.startSlot) continue;
    if (other.openStart) continue;
    previous = other;
  }
  if (!previous) return undefined;
  const from = pitchToMidi(previous.pitch);
  const to = pitchToMidi(span.pitch);
  if (from === null || to === null || from === to) return undefined;
  return to > from;
}


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
  gridLabel = null,
  selected,
  onSelect,
  editing = false,
  selectedCell = null,
  onCellSelect,
  onsets = null,
  timeSelectionOwnsPress = false,
  onBarLongPress,
}: {
  bar: FrettedBar;
  stringCount: number;
  /** Written in the header when the counting changes (spec 5.5, K-34). */
  gridLabel?: string | null;
  selected: boolean;
  onSelect: () => void;
  /** In edit mode the bar is a grid of cells rather than one seek target. */
  editing?: boolean;
  selectedCell?: CellSelection | null;
  onCellSelect?: (cell: CellSelection) => void;
  onsets?: OnsetSelection | null;
  /**
   * True when the time selection (spec 13.1) is listening for the same hold.
   *
   * Two selection models cannot both answer one finger. Held on an onset, the
   * press used to arm this block's chord pick *and* the time selection, so a
   * single hold produced a green group ring and a time band at once — two
   * different answers to one gesture, at two different thresholds. The newer
   * model owns the hold wherever it is live; the chord pick keeps it only on
   * the surfaces where it is not, such as while a Copilot preview is open.
   */
  timeSelectionOwnsPress?: boolean;
  /**
   * A long press on the bar's header, asking for the bar itself (spec 13.12).
   *
   * The header is where a bar is named, so it is where the bar is picked up —
   * the same idea as the arrangement's bar-number row, reached from the other
   * surface. It selects the *active track's* content in this bar and nothing
   * else: the tab draws one track, and a gesture made on one track's staff
   * must not quietly reach the seven the reader cannot see.
   */
  onBarLongPress?: () => void;
}) {
  const width = barWidth(bar.slotCount);
  /*
   * One reading of the bar's rhythm, shared by the strip and the guide. The
   * guide's "a chord is one onset, a tie is not" comes from these states
   * rather than from a second look at the bar (spec 13.20 §7).
   */
  const states = frettedRhythm(bar);
  const guide = buildRhythmGuide(states, bar.timeSignature, bar.resolution);
  /*
   * Reading rows are compact; writing rows are the finger's (2S-A §4). One
   * number, used everywhere in this block, so the strings, the sustains, the
   * numbers, the arcs and the cells cannot end up on different grids.
   *
   * The writing height is the finger's on every screen. It did not fit at
   * `320×700` while the reading chrome was still up — six rows plus the bar
   * header is `286px` and the surface was `219px` — so the *chrome* gave way
   * rather than the target: entering edit mode replaces the brand header, the
   * view switch and the section navigator with one compact row (2S-A §18).
   */
  const rowHeight = editing ? EDIT_STRING_ROW_HEIGHT : STRING_ROW_HEIGHT;
  const staffHeight = stringCount * rowHeight;
  const beat = slotsPerBeat(bar.timeSignature, bar.resolution);
  /*
   * Every technique mark. Which notes are one gesture, how much room a mark
   * owns and where its curve goes are all the pure model's; this component
   * only says which staff it is drawing over.
   */
  const techniques = buildTechniquePrimitives(bar, {
    slotWidth: SLOT_WIDTH,
    stringRowHeight: rowHeight,
    stringCount,
    rowTop: (stringIndex) =>
      rowOffset(stringCount, stringIndex, rowHeight),
  });

  /** What the reader is meant to understand about this note right now. */
  const stateOf = (span: FrettedBar["spans"][number]): GlyphState => {
    if (onsets?.selectedSlots.has(span.startSlot)) return "selected";
    if (
      selectedCell?.slotIndex === span.startSlot &&
      selectedCell.stringIndex === span.stringIndex
    ) {
      return "selected";
    }
    if (span.articulation === "hammer_on" || span.articulation === "pull_off") {
      return "legato";
    }
    return "normal";
  };

  /** The fret a slurred note came from, so its name can say the movement. */
  const slurredFrom = (span: FrettedBar["spans"][number]): number | null => {
    for (const phrase of techniques.legato) {
      if (phrase.stringIndex !== span.stringIndex) continue;
      const mark = phrase.marks.find((entry) => entry.toSlot === span.startSlot);
      if (mark) return mark.fromFret;
    }
    return null;
  };

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
      if (timeSelectionOwnsPress) return;
      if (!onsets?.onsetSlots.has(slotIndex)) return;
      held.current = false;
      cancelHold();
      holdTimer.current = setTimeout(() => {
        held.current = true;
        onsets.onLongPress(slotIndex);
      }, LONG_PRESS_MS);
    },
    [cancelHold, onsets, timeSelectionOwnsPress],
  );

  /*
   * `stopPropagation` on the way down, because the tab's content element is
   * carrying the time-selection press. Without it one finger arms two
   * selections, and the reader gets a band of slots they never asked for
   * alongside the bars they did.
   */
  const barPress = useLongPress(onBarLongPress ?? NO_PRESS, {
    enabled: onBarLongPress !== undefined,
  });

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
        {/* Grey, because a grid label is passive information. Gold on this
            surface means a control the reader chose, and this is neither. */}
        {gridLabel ? (
          <span className="text-muted/80 truncate text-[10px]">{gridLabel}</span>
        ) : null}
      </div>

      <div className="relative" style={{ height: staffHeight }}>
        {/* Strings */}
        {Array.from({ length: stringCount }, (_, stringIndex) => (
          <div
            key={stringIndex}
            data-string-line={stringIndex}
            className="bg-line absolute right-0 left-0 h-px"
            style={{
              top:
                rowOffset(stringCount, stringIndex, rowHeight) +
                rowHeight / 2,
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
                        rowHeight,
                      ) +
                      rowHeight / 2,
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

            {/* Technique marks, above the strings and under nothing. Drawn
                before the numbers so a number is never covered by one, and the
                layer takes no pointer events at all. */}
            <TechniqueLayer
              primitives={techniques}
              width={width}
              height={staffHeight}
              preview={(stringIndex, slot) =>
                (selectedCell?.slotIndex === slot &&
                  selectedCell.stringIndex === stringIndex) ||
                (onsets?.selectedSlots.has(slot) ?? false)
              }
            />

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
                      rowHeight,
                    ),
                    width: SLOT_WIDTH,
                    height: rowHeight,
                  }}
                  title={span.pitch}
                >
                  <FretGlyph
                    fret={span.fret}
                    articulation={span.articulation}
                    state={stateOf(span)}
                    slurredFrom={slurredFrom(span)}
                    slotIndex={span.startSlot}
                  />
                  {/* The character mark is the fallback, not the notation: it
                      appears only where the geometry layer drew nothing, so an
                      articulation the tab cannot honour is still visible. */}
                  {span.articulation &&
                  !techniques.annotated.has(
                    techniqueNoteKey(span.stringIndex, span.startSlot),
                  ) ? (
                    <ArticulationGlyph
                      articulation={span.articulation}
                      rising={risingAt(bar, span)}
                    />
                  ) : null}
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
                      top: rowOffset(stringCount, stringIndex, rowHeight),
                      width: SLOT_WIDTH,
                      height: rowHeight,
                    }}
                  />
                );
              }),
            )
          : null}
      </div>

      <div style={{ height: RHYTHM_ROW_HEIGHT }} className="relative">
        <RhythmStrip states={states} slotsPerBeat={beat} />
        {/* Below the ticks, so the beams sit under the rhythm they describe. */}
        <div className="absolute inset-x-0" style={{ top: RHYTHM_STRIP_HEIGHT }}>
          <RhythmGuideLayer guide={guide} />
        </div>
      </div>
    </Frame>
  );
}

"use client";

import { useCallback, useRef } from "react";

import { ArticulationGlyph } from "@/components/workspace/ArticulationGlyph";
import { FretGlyph } from "@/components/workspace/FretGlyph";
import { strumMarks } from "@/lib/tab/strum-mark";
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
import { RhythmTailLayer } from "@/components/workspace/RhythmTailLayer";
import { ticksPerSlot } from "@/lib/music/timing";
import { RhythmStrip } from "@/components/workspace/RhythmStrip";
import {
  buildTechniquePrimitives,
  techniqueNoteKey,
} from "@/lib/tab/technique-geometry";
import type { GlyphState } from "@/lib/tab/glyph-model";
import { glyphStateFor, legatoNotes } from "@/lib/tab/glyph-state";
import type { PenGhost } from "@/lib/tab/pen-ghost";
import { buildRhythmTail } from "@/lib/tab/rhythm-tail";
import { rowOffset } from "@/components/workspace/staff";
import { frettedRhythm, type FrettedBar } from "@/lib/tab/timeline";
import { pitchToMidi } from "@/lib/music/pitch";
import { LONG_PRESS_MS } from "@/lib/ui/interaction";
import { NO_PRESS, useLongPress } from "@/lib/ui/use-long-press";

export type CellSelection = { slotIndex: number; stringIndex: number };

/**
 * The duration gesture, as this block needs it (2T-B §6).
 *
 * Spelled out here rather than imported from the controller: a bar block
 * should not know which session owns the finger, only what a finger on a
 * length can do. The controller's own type satisfies this structurally.
 */
export type DurationGestureProps = {
  /** What the note would become while the finger is down, else null. */
  readonly previewTicks: number | null;
  readonly label: string | null;
  readonly active: boolean;
  grab(noteIndex: number): void;
  moveBy(deltaPx: number, slotWidthPx: number): void;
  release(): void;
  cancel(): void;
  /** One whole step, from the buttons rather than from a drag. */
  step(noteIndex: number, steps: number): void;
};

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
  ghost = null,
  onPenTarget,
  onCellSelect,
  onsets = null,
  duration = null,
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
  /**
   * The whole shape an armed pen would write here, or null (K-59 §6).
   *
   * Drawn, never written. The layer takes no pointer events and is not
   * measured: it cannot move a number, grow the staff or steal a cell.
   */
  ghost?: PenGhost | null;
  /**
   * The beat under the finger while a pen is armed, or null on release.
   *
   * Given only when something is held. A pen writes on the tap, so the moment
   * a preview can exist is the press itself — and a preview of the tap in
   * flight is the only preview that does not need a sheet in front of the
   * staff to have somewhere to live.
   */
  onPenTarget?: (cell: CellSelection | null) => void;
  onCellSelect?: (cell: CellSelection) => void;
  onsets?: OnsetSelection | null;
  /**
   * The finger on the selected note's length, or null where there is none.
   *
   * Given only in edit mode and used only on the selected cell: a handle on
   * every note would be a row of grips over the music, and a length is the
   * one thing you can only mean about a note you have already chosen.
   */
  duration?: DurationGestureProps | null;
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
   * One reading of the bar's rhythm, shared by the strip and the tail. The
   * strip's beat ticks come from these states; the tail reads the same bar's
   * spans, whose lengths are now Score Truth rather than tie runs (2T-B §4),
   * so the two cannot disagree about where a note starts or how long it is.
   */
  const states = frettedRhythm(bar);
  const tail = buildRhythmTail({
    spans: bar.spans,
    restSlots: bar.rests,
    timeSignature: bar.timeSignature,
    resolution: bar.resolution,
    slotCount: bar.slotCount,
  });
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
  /*
   * The note the duration handle belongs to: the selected cell, if a note
   * actually starts there. A tie tail or an empty cell has no length of its
   * own to drag, so it gets no grip (2T-B §6).
   */
  const heldNote =
    editing && duration && selectedCell
      ? (bar.spans.find(
          (span) =>
            !span.openStart &&
            span.startSlot === selectedCell.slotIndex &&
            span.stringIndex === selectedCell.stringIndex,
        ) ?? null)
      : null;
  /*
   * Where the note ends *while the finger is down*, which is the whole point
   * of a live preview: the grip and the band follow the drag, and the song is
   * not touched until release.
   */
  const heldEndSlot =
    heldNote === null
      ? null
      : duration?.previewTicks != null && duration.active
        ? heldNote.startSlot +
          Math.max(1, Math.ceil(duration.previewTicks / ticksPerSlot(bar.resolution))) -
          1
        : heldNote.endSlot;
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

  /** The onsets a drawn slur already covers, so nothing says it twice. */
  const arcNotes = legatoNotes(techniques);

  /** What the reader is meant to understand about this note right now. */
  const stateOf = (span: FrettedBar["spans"][number]): GlyphState =>
    glyphStateFor({
      ...(span.articulation === undefined
        ? {}
        : { articulation: span.articulation }),
      selected:
        (onsets?.selectedSlots.has(span.startSlot) ?? false) ||
        (selectedCell?.slotIndex === span.startSlot &&
          selectedCell.stringIndex === span.stringIndex),
      underArc: arcNotes.has(
        techniqueNoteKey(span.stringIndex, span.startSlot),
      ),
    });

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

            {/* What an armed pen would write here: every voice of it, on the
                real beat, at a third of the ink and behind no touch target. */}
            {ghost ? (
              <div
                aria-hidden
                data-pen-ghost={ghost.notes.length}
                className="pointer-events-none absolute inset-0 opacity-60"
              >
                {ghost.notes.map((note) => (
                  <span
                    key={note.stringIndex}
                    className="absolute flex items-center justify-center"
                    style={{
                      left: ghost.slotIndex * SLOT_WIDTH,
                      top: rowOffset(stringCount, note.stringIndex, rowHeight),
                      width: SLOT_WIDTH,
                      height: rowHeight,
                    }}
                  >
                    <FretGlyph fret={note.fret} state="ghost" />
                  </span>
                ))}
              </div>
            ) : null}

            {/* One arrow per strummed chord, beside the numbers rather than
                on them: a strum is a single gesture across the strings, so it
                is drawn once and reaches only the strings it crosses. */}
            {strumMarks(bar.spans).map((mark) => {
              const top =
                rowOffset(stringCount, mark.fromString, rowHeight) + rowHeight / 2;
              const bottom =
                rowOffset(stringCount, mark.toString, rowHeight) + rowHeight / 2;
              return (
                <span
                  key={`strum-${mark.slotIndex}`}
                  data-strum-mark={mark.direction}
                  data-strum-slot={mark.slotIndex}
                  role="img"
                  aria-label={mark.label}
                  className="text-bronze pointer-events-none absolute flex items-center justify-center font-mono text-[10px] leading-none"
                  style={{
                    left: slotCentre(mark.slotIndex) - SLOT_WIDTH / 2 - 6,
                    top: Math.min(top, bottom) - 4,
                    height: Math.abs(bottom - top) + 8,
                  }}
                >
                  <span aria-hidden>{mark.direction === "down" ? "↓" : "↑"}</span>
                </span>
              );
            })}

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
                    onPointerDown={() => {
                      startHold(slotIndex);
                      onPenTarget?.({ slotIndex, stringIndex });
                    }}
                    onPointerUp={() => {
                      cancelHold();
                      onPenTarget?.(null);
                    }}
                    onPointerLeave={() => {
                      cancelHold();
                      onPenTarget?.(null);
                    }}
                    onPointerCancel={() => {
                      cancelHold();
                      onPenTarget?.(null);
                    }}
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

        {/* What the length would become while the finger is on the sheet's
            grip: drawn here, on the note itself, and never written. */}
        {heldNote !== null && heldEndSlot !== null && duration?.active ? (
          <span
            aria-hidden
            data-duration-preview
            className="bg-accent/20 border-accent/50 pointer-events-none absolute rounded-sm border border-dashed"
            style={{
              left: heldNote.startSlot * SLOT_WIDTH,
              top: rowOffset(stringCount, heldNote.stringIndex, rowHeight),
              width: (heldEndSlot - heldNote.startSlot + 1) * SLOT_WIDTH,
              height: rowHeight,
            }}
          />
        ) : null}
      </div>

      <div style={{ height: RHYTHM_ROW_HEIGHT }} className="relative">
        <RhythmStrip states={states} slotsPerBeat={beat} />
        {/* Below the ticks, so the tail sits under the rhythm it describes. */}
        <div className="absolute inset-x-0" style={{ top: RHYTHM_STRIP_HEIGHT }}>
          <RhythmTailLayer tail={tail} />
        </div>
      </div>
    </Frame>
  );
}

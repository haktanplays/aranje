"use client";

/**
 * The kit, written into rather than read (2Q-B §5).
 *
 * A row per piece, a cell per slot, laid out on exactly the geometry the
 * reading lane uses — same bar widths, same slot width — so a kit that is
 * being edited still lines up with every other lane above and below it. That
 * is not decoration: the Çoklu view exists to make instruments comparable in
 * time, and a lane that widened its cells to be easier to tap would break the
 * one thing it is for.
 *
 * ## What a tap means
 *
 * One physical tap, one command. An empty cell writes a hit; a filled one
 * takes that hit away; nothing else is touched, including the other pieces on
 * the same beat. The decision is made from the model the cell was drawn from,
 * not from the last render, so a fast double tap cannot write twice.
 *
 * A long press deliberately does nothing here: selection is the tab's gesture
 * and a kit has no onset groups to move yet (§9.1).
 *
 * ## The honest size of a target
 *
 * A row is a full touch height, because a row *is* the target. The width
 * stays one slot — 34px — for the alignment reason above, and that is
 * reported as measured rather than dressed up as 44.
 */
import {
  BAR_HEADER_HEIGHT,
  DRUM_STEP_ROW_HEIGHT,
  SLOT_WIDTH,
  barWidth,
} from "@/components/workspace/geometry";
import type { DrumStepBar, DrumStepModel } from "@/lib/tab/drum-step-model";
import type { DrumPiece } from "@/lib/instruments/registry";

export type DrumStepEntry = {
  /** Write or erase this piece at this moment. */
  toggle(ticks: number, piece: DrumPiece): void;
};

/** Cymbals and hats read as crosses, membranes as filled heads — as the tab. */
function Mark({ piece }: { piece: DrumPiece }) {
  if (piece === "closed_hat" || piece === "open_hat") {
    return <span className="text-text font-mono text-[13px] leading-none">x</span>;
  }
  if (piece === "crash" || piece === "ride" || piece === "china") {
    return <span className="border-text block size-2.5 rotate-45 border" />;
  }
  return <span className="bg-text block size-2.5 rounded-full" />;
}

function StepBar({
  bar,
  rows,
  entry,
  gridLabel,
}: {
  bar: DrumStepBar;
  rows: DrumStepModel["rows"];
  entry: DrumStepEntry;
  gridLabel: string | null;
}) {
  return (
    <div
      data-drum-step-bar={bar.key}
      className="border-line shrink-0 border-r"
      style={{ width: barWidth(bar.slotCount) }}
    >
      <div
        className="flex items-center gap-1.5 overflow-hidden px-1.5"
        style={{ height: BAR_HEADER_HEIGHT }}
      >
        <span className="text-muted/70 text-[10px] tabular-nums">{bar.barNumber}</span>
        {gridLabel ? (
          <span className="text-bronze/80 truncate text-[10px]">{gridLabel}</span>
        ) : null}
      </div>

      {rows.map((row) => (
        <div
          key={row.piece}
          className="border-line/50 relative border-t"
          style={{ height: DRUM_STEP_ROW_HEIGHT }}
        >
          {Array.from({ length: bar.slotCount }, (_, slotIndex) => {
            const cell = row.cells.find(
              (entryCell) =>
                entryCell.barIndex === bar.barIndex && entryCell.slotIndex === slotIndex,
            );
            if (!cell) return null;
            const filled = cell.hit !== null;
            return (
              <button
                key={slotIndex}
                type="button"
                data-drum-cell={`${row.piece}:${cell.ticks}`}
                data-filled={filled ? "" : undefined}
                aria-pressed={filled}
                aria-label={`${row.label}, ${bar.barNumber}. ölçü, ${slotIndex + 1}. adım`}
                onClick={() => entry.toggle(cell.ticks, row.piece)}
                className={`absolute top-0 flex items-center justify-center ${
                  filled ? "bg-steel/15" : "bg-transparent"
                }`}
                style={{
                  left: slotIndex * SLOT_WIDTH,
                  width: SLOT_WIDTH,
                  height: DRUM_STEP_ROW_HEIGHT,
                }}
              >
                {filled ? (
                  <Mark piece={row.piece} />
                ) : (
                  /* An empty cell still shows where it is: a faint dot is the
                     difference between "tap here" and a blank rectangle. */
                  <span className="bg-line block size-1 rounded-full" aria-hidden />
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function DrumStepLane({
  model,
  entry,
  gridLabelFor,
}: {
  model: DrumStepModel;
  entry: DrumStepEntry;
  /** The one grid-label rule, passed in rather than reimplemented. */
  gridLabelFor?: (bars: readonly DrumStepBar[], index: number) => string | null;
}) {
  return (
    <div data-drum-step={model.trackId} className="flex">
      {model.bars.map((bar, index) => (
        <div key={bar.key} data-bar-key={bar.key}>
          <StepBar
            bar={bar}
            rows={model.rows}
            entry={entry}
            gridLabel={gridLabelFor?.(model.bars, index) ?? null}
          />
        </div>
      ))}
    </div>
  );
}

/** The row labels, drawn once beside the lane rather than inside every bar. */
export function DrumStepLegend({ model }: { model: DrumStepModel }) {
  return (
    <div data-drum-step-legend={model.trackId} className="shrink-0">
      <div style={{ height: BAR_HEADER_HEIGHT }} />
      {model.rows.map((row) => (
        <div
          key={row.piece}
          className="border-line/50 text-muted flex items-center border-t px-2 text-[11px]"
          style={{ height: DRUM_STEP_ROW_HEIGHT }}
        >
          {row.label}
        </div>
      ))}
    </div>
  );
}

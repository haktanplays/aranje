"use client";

/**
 * The kit, written into rather than read (2Q-B §5, 2R-A §6).
 *
 * A row per piece, a column per slot, laid out on exactly the geometry the
 * reading lane uses — same bar widths, same slot width — so a kit that is
 * being edited still lines up with every other lane above and below it. That
 * is not decoration: the Çoklu view exists to make instruments comparable in
 * time, and a lane that widened its cells to be easier to tap would break the
 * one thing it is for.
 *
 * ## Only the columns that can be seen
 *
 * Which those are is `lib/ui/drum-grid-window.ts`'s answer, measured there and
 * handed here as a prop. What this file guarantees is what it does with it: a
 * column that is not mounted has not been deleted. The empty width either side
 * is exactly as wide as the columns it stands in for, and the answer to "is
 * there a hit here" comes from the model, never from the DOM.
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
import { useMemo } from "react";

import {
  BAR_HEADER_HEIGHT,
  DRUM_STEP_ROW_HEIGHT,
  SLOT_WIDTH,
} from "@/components/workspace/geometry";
import {
  cellIndex,
  type DrumGridAxis,
  type DrumGridWindow,
} from "@/lib/ui/drum-grid-window";
import type { DrumStepBar, DrumStepModel } from "@/lib/tab/drum-step-model";
import type { DrumPiece } from "@/lib/instruments/registry";

export type DrumStepEntry = {
  /** Write or erase this piece at this moment. */
  toggle(ticks: number, piece: DrumPiece): void;
};

/** Cymbals and hats read as crosses, membranes as filled heads — as the tab. */
function Mark({ piece }: { piece: DrumPiece }) {
  if (piece === "closed_hat" || piece === "open_hat") {
    return (
      <span className="text-text font-mono text-[13px] leading-none">x</span>
    );
  }
  if (piece === "crash" || piece === "ride" || piece === "china") {
    return <span className="border-text block size-2.5 rotate-45 border" />;
  }
  return <span className="bg-text block size-2.5 rounded-full" />;
}

/**
 * The bar numbers, positioned from the axis rather than nested in the bars.
 *
 * A header inside a bar's element would be mounted whenever any of that bar's
 * columns were, and at 1/32 a bar is three screens wide.
 */
function BarHeaders({
  bars,
  axis,
  gridLabelFor,
}: {
  bars: readonly DrumStepBar[];
  axis: DrumGridAxis;
  gridLabelFor?: (bars: readonly DrumStepBar[], index: number) => string | null;
}) {
  return (
    <div className="relative" style={{ height: BAR_HEADER_HEIGHT }}>
      {bars.map((bar, index) => {
        const first = axis.columns.find((column) => column.barKey === bar.key);
        if (!first) return null;
        const label = gridLabelFor?.(bars, index) ?? null;
        return (
          <span
            key={bar.key}
            data-drum-step-bar={bar.key}
            className="text-muted/70 absolute top-0 flex items-center gap-1.5 px-1.5 text-[10px] tabular-nums"
            style={{ left: first.leftPx, height: BAR_HEADER_HEIGHT }}
          >
            {bar.barNumber}
            {label ? <span className="text-bronze/80">{label}</span> : null}
          </span>
        );
      })}
    </div>
  );
}

export function DrumStepLane({
  model,
  axis,
  window: view,
  entry,
  gridLabelFor,
}: {
  model: DrumStepModel;
  /** Where every column is. Built once by the surface, not per render here. */
  axis: DrumGridAxis;
  /** The columns worth mounting right now. */
  window: DrumGridWindow;
  entry: DrumStepEntry;
  /** The one grid-label rule, passed in rather than reimplemented. */
  gridLabelFor?: (bars: readonly DrumStepBar[], index: number) => string | null;
}) {
  /*
   * One index per row, rebuilt only when the model changes. The component used
   * to scan the row's whole cell list per cell; that was measured at 0,559 ms
   * on the ceiling fixture — small, but a window needs a lookup by position
   * anyway, so the scan has nowhere left to be.
   */
  const indexes = useMemo(
    () => model.rows.map((row) => cellIndex(row)),
    [model.rows],
  );

  return (
    <div
      data-drum-step={model.trackId}
      className="relative shrink-0"
      style={{ width: axis.totalWidthPx }}
    >
      <BarHeaders bars={model.bars} axis={axis} gridLabelFor={gridLabelFor} />

      {model.rows.map((row, rowIndex) => (
        <div
          key={row.piece}
          data-drum-step-row={row.piece}
          className="border-line/50 flex border-t"
          style={{ height: DRUM_STEP_ROW_HEIGHT }}
        >
          {/* The columns before this window: empty width, never a target. */}
          <div
            aria-hidden
            data-drum-window-lead
            className="shrink-0"
            style={{ width: view.beforePx }}
          />
          {view.columns.map((column) => {
            const cell = indexes[rowIndex]?.get(
              `${column.barIndex}:${column.slotIndex}`,
            );
            if (!cell) return null;
            const filled = cell.hit !== null;
            return (
              <button
                key={column.key}
                type="button"
                data-drum-cell={`${row.piece}:${cell.ticks}`}
                data-filled={filled ? "" : undefined}
                aria-pressed={filled}
                aria-label={`${row.label}, ${column.barNumber}. ölçü, ${
                  column.slotIndex + 1
                }. adım`}
                onClick={() => entry.toggle(cell.ticks, row.piece)}
                className={`flex shrink-0 items-center justify-center ${
                  column.endsBar ? "border-line border-r" : ""
                } ${filled ? "bg-steel/15" : "bg-transparent"}`}
                style={{ width: SLOT_WIDTH, height: DRUM_STEP_ROW_HEIGHT }}
              >
                {filled ? (
                  <Mark piece={row.piece} />
                ) : (
                  /* A faint dot: the difference between "tap here" and a blank. */
                  <span aria-hidden className="bg-line block size-1 rounded-full" />
                )}
              </button>
            );
          })}
          {/* And the columns after it. */}
          <div
            aria-hidden
            data-drum-window-tail
            className="shrink-0"
            style={{ width: view.afterPx }}
          />
        </div>
      ))}
    </div>
  );
}

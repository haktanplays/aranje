/**
 * Which columns of the kit's step grid are worth having in the DOM (2R-A §6).
 *
 * Pure arithmetic over the step model and a scroll position. It knows nothing
 * about React, nothing about the DOM, and nothing about the song beyond the
 * model it is handed.
 *
 * ## Why this exists, measured rather than assumed
 *
 * `eval/practice-loop/` timed a tap on the contract's ceiling — eight tracks,
 * thirty-two bars, a section of eight 4/4 bars at 1/32 — and split the cost in
 * two. The central gate (parse plus the validator chain) is about 37 ms and
 * belongs to every edit the app makes, drum or not. The rest, about 185 ms, is
 * the grid: **1.792 cells and 1.811 buttons**, of which roughly eleven columns
 * are on a 320px screen at any moment.
 *
 * The obvious other suspect was measured and cleared: the component's
 * per-cell `row.cells.find(...)` really is quadratic in the section's length,
 * and it costs 0,559 ms. Fixing it saves a tenth of a millisecond. It is
 * fixed here anyway, because a window needs an index to look cells up by
 * position — not because it was the problem.
 *
 * ## The unit is a column, not a bar
 *
 * A bar at 1/32 is 32 columns and 1.088 pixels — more than three screens at
 * 320px. Windowing by bar would still mount three times what can be seen, so
 * the unit is the column: one slot of one bar, the thing a finger actually
 * lands on.
 */
import type {
  DrumStepCell,
  DrumStepModel,
  DrumStepRow,
} from "@/lib/tab/drum-step-model";

/** One slot of one bar: the cell a finger lands on, and where it is. */
export type DrumGridColumn = {
  readonly key: string;
  readonly barKey: string;
  readonly barIndex: number;
  readonly barNumber: number;
  readonly slotIndex: number;
  /** Ticks from the start of the section — what an entry command wants. */
  readonly ticks: number;
  readonly leftPx: number;
  readonly widthPx: number;
  /** True on the last column of a bar, which is where the bar line is drawn. */
  readonly endsBar: boolean;
};

export type DrumGridAxis = {
  readonly columns: readonly DrumGridColumn[];
  readonly totalWidthPx: number;
  readonly slotWidthPx: number;
};

/**
 * Every column of the grid, left to right.
 *
 * The slot width is an argument rather than an imported constant, which keeps
 * the direction of dependency right — a module under `lib/` does not reach
 * into a component for its numbers — and makes the axis testable in any unit.
 */
export function drumGridAxis(
  model: DrumStepModel,
  slotWidthPx: number,
): DrumGridAxis {
  /*
   * The tick each position stands for, read off the model once.
   *
   * The model already resolved every cell's tick through the central timing
   * module, so this reads that answer rather than deriving a second one — and
   * reads it into a map, because asking the row's cell list per column would
   * be the very scan this module exists to remove.
   */
  const ticks = new Map<string, number>();
  for (const row of model.rows) {
    for (const cell of row.cells) {
      const key = `${cell.barIndex}:${cell.slotIndex}`;
      if (!ticks.has(key)) ticks.set(key, cell.ticks);
    }
  }

  const columns: DrumGridColumn[] = [];
  let leftPx = 0;
  for (const bar of model.bars) {
    for (let slotIndex = 0; slotIndex < bar.slotCount; slotIndex += 1) {
      columns.push({
        key: `${bar.key}:${slotIndex}`,
        barKey: bar.key,
        barIndex: bar.barIndex,
        barNumber: bar.barNumber,
        slotIndex,
        /*
         * A grid with no rows has no cell to read a tick off, and the bar's
         * own start is then the only honest answer for its first column. It
         * cannot be reached from the UI — a kit always has the core rows —
         * but the model does not promise that, so it is not assumed.
         */
        ticks: ticks.get(`${bar.barIndex}:${slotIndex}`) ?? bar.startTicks,
        leftPx,
        widthPx: slotWidthPx,
        endsBar: slotIndex === bar.slotCount - 1,
      });
      leftPx += slotWidthPx;
    }
  }
  return { columns, totalWidthPx: leftPx, slotWidthPx };
}

/** A row's cells, by position, so a lookup is one map read rather than a scan. */
export function cellIndex(row: DrumStepRow): ReadonlyMap<string, DrumStepCell> {
  const index = new Map<string, DrumStepCell>();
  for (const cell of row.cells)
    index.set(`${cell.barIndex}:${cell.slotIndex}`, cell);
  return index;
}

export type ScrollDirection = "forward" | "backward" | "idle";

export type DrumGridOverscan = {
  /** Toward the reader's travel: this is the one that prevents a blank strip. */
  readonly ahead: number;
  /** Behind them: enough that a flick back does not land on nothing. */
  readonly behind: number;
};

/**
 * The one the app ships with.
 *
 * One place, chosen by measurement rather than by "a screen either side ought
 * to do": `eval/practice-loop/OVERSCAN.json` holds the candidates that were
 * run, the blank columns each produced while swiping, and what each costs in
 * mounted cells.
 */
export const DRUM_GRID_OVERSCAN: DrumGridOverscan = { ahead: 1, behind: 0.5 };

export type DrumGridWindow = {
  /** Index into `axis.columns`. -1 with an empty grid, and then nothing renders. */
  readonly firstColumn: number;
  readonly lastColumn: number;
  readonly beforePx: number;
  readonly renderedPx: number;
  readonly afterPx: number;
  readonly columns: readonly DrumGridColumn[];
};

const EMPTY: DrumGridWindow = {
  firstColumn: -1,
  lastColumn: -1,
  beforePx: 0,
  renderedPx: 0,
  afterPx: 0,
  columns: [],
};

export type DrumGridWindowInput = {
  readonly axis: DrumGridAxis;
  /** Where the viewport's left edge is, in the grid's own coordinates. */
  readonly viewportLeftPx: number;
  readonly viewportWidthPx: number;
  readonly direction: ScrollDirection;
  /** Only the overscan measurement passes this. */
  readonly overscan?: DrumGridOverscan;
};

export function drumGridWindow(input: DrumGridWindowInput): DrumGridWindow {
  const { axis, viewportLeftPx, viewportWidthPx, direction } = input;
  if (axis.columns.length === 0) return EMPTY;

  const width = Math.max(0, viewportWidthPx);
  const overscan = input.overscan ?? DRUM_GRID_OVERSCAN;
  const aheadPx = width * overscan.ahead;
  const behindPx = width * overscan.behind;
  const backward = direction === "backward";
  const forward = direction === "forward";

  const leftMargin = backward ? aheadPx : forward ? behindPx : aheadPx;
  const rightMargin = backward ? behindPx : aheadPx;

  const from = viewportLeftPx - leftMargin;
  const to = viewportLeftPx + width + rightMargin;

  /*
   * Columns are uniform, so the range is arithmetic rather than a scan — the
   * grid is asked for a window on every scroll frame and a walk over two
   * thousand columns per frame would be the cost this module exists to remove.
   */
  const slot = axis.slotWidthPx;
  const last = axis.columns.length - 1;
  const firstColumn =
    slot <= 0 ? 0 : Math.max(0, Math.min(last, Math.floor(from / slot)));
  const lastColumn =
    slot <= 0
      ? last
      : Math.max(firstColumn, Math.min(last, Math.ceil(to / slot) - 1));

  const columns = axis.columns.slice(firstColumn, lastColumn + 1);
  const beforePx = columns[0]!.leftPx;
  const renderedPx = columns.length * slot;

  return {
    firstColumn,
    lastColumn,
    beforePx,
    renderedPx,
    // Subtraction rather than a second sum: the three parts have to add up to
    // the grid exactly, or the scroll width disagrees with the music.
    afterPx: axis.totalWidthPx - beforePx - renderedPx,
    columns,
  };
}

/** Whether two windows would render the same thing. O(1), so it can run a frame. */
export function sameDrumWindow(a: DrumGridWindow, b: DrumGridWindow): boolean {
  return a.firstColumn === b.firstColumn && a.lastColumn === b.lastColumn;
}

/**
 * Where a bar starts in the grid, for a request that names a bar.
 *
 * Null when the grid has no such bar — a stale key names nothing rather than
 * scrolling somewhere arbitrary.
 */
export function xAtBar(axis: DrumGridAxis, barKey: string): number | null {
  const column = axis.columns.find((entry) => entry.barKey === barKey);
  return column?.leftPx ?? null;
}

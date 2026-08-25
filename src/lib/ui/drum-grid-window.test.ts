/**
 * The kit's step grid, windowed (2R-A §6, §17).
 *
 * The claim under all of it is arithmetic: `before + rendered + after` is the
 * grid, exactly. A window whose parts do not add up is a scroll width that
 * disagrees with the music, and every position derived from it — a tap, a
 * bar line, a programmatic jump — is then wrong by the difference.
 *
 * The fixture is the one the baseline measured: eight 4/4 bars at 1/32, which
 * is 256 columns and, with the rows this kit produces, the surface that took
 * 221 ms a tap before this module existed.
 */
import { describe, expect, it } from "vitest";

import { buildDrumStepModel } from "@/lib/tab/drum-step-model";
import {
  cellIndex,
  drumGridAxis,
  drumGridWindow,
  DRUM_GRID_OVERSCAN,
  sameDrumWindow,
  xAtBar,
  type DrumGridWindowInput,
} from "@/lib/ui/drum-grid-window";
import { slotCount, ticksPerSlot } from "@/lib/music/timing";
import {
  songSchema,
  type Bar,
  type DrumSlot,
  type Song,
  type TimeSignature,
} from "@/lib/song/schema";

const SLOT = 34;

/** A kit section of `bars` 4/4 bars at `resolution`, with a hit every 8 slots. */
function kitSong(
  bars: number,
  resolution: 8 | 16 | 32,
  meter: TimeSignature = [4, 4],
): Song {
  const count = slotCount(meter, resolution);
  const bar = (index: number): Bar => ({
    timeSignature: meter,
    resolution,
    slots: {
      drums: Array.from(
        { length: count },
        (_, slotIndex): DrumSlot =>
          (slotIndex + index) % 8 === 0
            ? [{ piece: "kick", velocity: 100 }]
            : [],
      ),
    },
  });
  return songSchema.parse({
    version: 2,
    title: "Kit",
    bpm: 120,
    key: "E minor",
    tracks: [
      {
        id: "drums",
        name: "Davul",
        instrumentId: "drum_kit",
        presetId: "rock",
        volumeDb: -6,
      },
    ],
    sections: [
      {
        id: "s1",
        name: "Bölüm",
        status: "fixed",
        bars: Array.from({ length: bars }, (_, index) => bar(index)),
      },
    ],
  }) as Song;
}

const dense = kitSong(8, 32);
const model = buildDrumStepModel(dense, "s1", "drums");
const axis = drumGridAxis(model, SLOT);

const at = (
  viewportLeftPx: number,
  viewportWidthPx = 320,
  direction: DrumGridWindowInput["direction"] = "forward",
) => drumGridWindow({ axis, viewportLeftPx, viewportWidthPx, direction });

describe("245. the grid's columns are one axis", () => {
  it("gives every slot of every bar its own column", () => {
    expect(axis.columns).toHaveLength(8 * 32);
    expect(axis.totalWidthPx).toBe(8 * 32 * SLOT);
    expect(new Set(axis.columns.map((column) => column.key)).size).toBe(
      axis.columns.length,
    );
  });

  it("lays them out left to right with no gap and no overlap", () => {
    let expected = 0;
    for (const column of axis.columns) {
      expect(column.leftPx, column.key).toBe(expected);
      expected += column.widthPx;
    }
    expect(expected).toBe(axis.totalWidthPx);
  });

  it("carries the tick the model resolved, not a second derivation", () => {
    const step = ticksPerSlot(32);
    for (const column of axis.columns) {
      expect(column.ticks, column.key).toBe(
        column.barIndex * 32 * step + column.slotIndex * step,
      );
    }
  });

  it("marks the bar line on the last column of each bar", () => {
    const ends = axis.columns.filter((column) => column.endsBar);
    expect(ends).toHaveLength(8);
    for (const column of ends) expect(column.slotIndex).toBe(31);
  });

  it("keeps mixed grids honest: a bar's column count is its own", () => {
    const mixed = songSchema.parse({
      ...kitSong(2, 16),
      sections: [
        {
          id: "s1",
          name: "Bölüm",
          status: "fixed",
          bars: [
            {
              timeSignature: [4, 4],
              resolution: 8,
              slots: { drums: Array.from({ length: 8 }, (): DrumSlot => []) },
            },
            {
              timeSignature: [3, 4],
              resolution: 12,
              slots: { drums: Array.from({ length: 9 }, (): DrumSlot => []) },
            },
          ],
        },
      ],
    }) as Song;
    const built = drumGridAxis(buildDrumStepModel(mixed, "s1", "drums"), SLOT);
    expect(built.columns).toHaveLength(8 + 9);
    expect(built.columns.filter((column) => column.endsBar)).toHaveLength(2);
    expect(built.totalWidthPx).toBe(17 * SLOT);
  });

  it("has no columns at all for a grid with no bars", () => {
    /*
     * The Song Contract will not accept a section with no bars, so this state
     * cannot be reached through the schema. The axis is handed models rather
     * than songs, though, and a model with no bars is representable — so it
     * answers rather than dividing by nothing.
     */
    expect(
      songSchema.safeParse({
        ...kitSong(1, 8),
        sections: [{ id: "s1", name: "Bölüm", status: "fixed", bars: [] }],
      }).success,
    ).toBe(false);

    const built = drumGridAxis({ ...model, bars: [] }, SLOT);
    expect(built.columns).toEqual([]);
    expect(built.totalWidthPx).toBe(0);
  });

  it("finds a bar's x by key, and nothing for a key it does not have", () => {
    expect(xAtBar(axis, "s1:0")).toBe(0);
    expect(xAtBar(axis, "s1:3")).toBe(3 * 32 * SLOT);
    expect(xAtBar(axis, "s1:99")).toBeNull();
    expect(xAtBar(axis, "nope:0")).toBeNull();
  });

  it("indexes a row's cells by position", () => {
    const row = model.rows[0]!;
    const index = cellIndex(row);
    expect(index.size).toBe(row.cells.length);
    for (const cell of row.cells) {
      expect(index.get(`${cell.barIndex}:${cell.slotIndex}`)).toBe(cell);
    }
    expect(index.get("99:99")).toBeUndefined();
  });
});

describe("246. the window covers the viewport and adds up to the grid", () => {
  it("adds up to the grid at every scroll position", () => {
    for (let left = 0; left <= axis.totalWidthPx; left += 71) {
      for (const direction of ["forward", "backward", "idle"] as const) {
        const window = at(left, 320, direction);
        expect(window.beforePx + window.renderedPx + window.afterPx).toBe(
          axis.totalWidthPx,
        );
        expect(window.beforePx).toBeGreaterThanOrEqual(0);
        expect(window.afterPx).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("always covers the viewport itself", () => {
    for (let left = 0; left <= axis.totalWidthPx - 320; left += 53) {
      const window = at(left);
      const first = window.columns[0]!;
      const last = window.columns[window.columns.length - 1]!;
      expect(first.leftPx).toBeLessThanOrEqual(left);
      expect(last.leftPx + last.widthPx).toBeGreaterThanOrEqual(left + 320);
    }
  });

  it("mounts a fraction of the grid, which is the whole point", () => {
    const window = at(0);
    expect(window.columns.length).toBeLessThan(axis.columns.length / 4);
    expect(window.columns.length).toBeGreaterThan(320 / SLOT);
  });

  it("clamps at both ends rather than running past them", () => {
    const start = at(0, 320, "backward");
    expect(start.firstColumn).toBe(0);
    expect(start.beforePx).toBe(0);

    const end = at(axis.totalWidthPx - 320, 320, "forward");
    expect(end.lastColumn).toBe(axis.columns.length - 1);
    expect(end.afterPx).toBe(0);
  });

  it("keeps more ahead than behind while moving forward", () => {
    const middle = Math.round(axis.totalWidthPx / 2);
    const window = at(middle, 320, "forward");
    const last = window.columns[window.columns.length - 1]!;
    const ahead = last.leftPx + last.widthPx - (middle + 320);
    const behind = middle - window.columns[0]!.leftPx;
    expect(ahead).toBeGreaterThan(behind);
  });

  it("mirrors that while moving backward", () => {
    const middle = Math.round(axis.totalWidthPx / 2);
    const backward = at(middle, 320, "backward");
    const forward = at(middle, 320, "forward");
    expect(backward.firstColumn).toBeLessThan(forward.firstColumn);
    expect(backward.lastColumn).toBeLessThan(forward.lastColumn);
  });

  it("scales with the viewport, not with a column count", () => {
    const middle = Math.round(axis.totalWidthPx / 2);
    expect(at(middle, 390).columns.length).toBeGreaterThan(
      at(middle, 200).columns.length,
    );
  });

  it("states the overscan in viewports, in one place", () => {
    expect(DRUM_GRID_OVERSCAN.ahead).toBeGreaterThan(0);
    expect(DRUM_GRID_OVERSCAN.behind).toBeGreaterThan(0);
    expect(DRUM_GRID_OVERSCAN.ahead).toBeGreaterThanOrEqual(
      DRUM_GRID_OVERSCAN.behind,
    );
  });

  it("says two windows over the same columns are the same window", () => {
    expect(sameDrumWindow(at(10), at(12))).toBe(
      at(10).firstColumn === at(12).firstColumn &&
        at(10).lastColumn === at(12).lastColumn,
    );
    expect(sameDrumWindow(at(0), at(axis.totalWidthPx - 320))).toBe(false);
  });

  it("renders nothing for an empty grid rather than a column that is not there", () => {
    const built = drumGridAxis({ ...model, bars: [], rows: [] }, SLOT);
    const window = drumGridWindow({
      axis: built,
      viewportLeftPx: 0,
      viewportWidthPx: 320,
      direction: "idle",
    });
    expect(window.firstColumn).toBe(-1);
    expect(window.columns).toEqual([]);
    expect(window.beforePx + window.renderedPx + window.afterPx).toBe(0);
  });

  it("survives a viewport wider than the whole grid", () => {
    const small = drumGridAxis(
      buildDrumStepModel(kitSong(1, 8), "s1", "drums"),
      SLOT,
    );
    const window = drumGridWindow({
      axis: small,
      viewportLeftPx: 0,
      viewportWidthPx: 2000,
      direction: "idle",
    });
    expect(window.columns).toHaveLength(small.columns.length);
    expect(window.beforePx).toBe(0);
    expect(window.afterPx).toBe(0);
  });

  it("does not change the model it was given", () => {
    const before = JSON.stringify(model);
    for (let left = 0; left <= axis.totalWidthPx; left += 211) at(left);
    expect(JSON.stringify(model)).toBe(before);
  });
});

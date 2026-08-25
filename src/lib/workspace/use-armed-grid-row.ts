"use client";

/**
 * The Tab surface's row when a kit is armed (2R-A §6, §III).
 *
 * Three facts that belong together and were three separate expressions in the
 * component: where the armed grid's section starts on the shared axis, which
 * of its columns are worth mounting, and how wide the row's empty parts are.
 *
 * They belong together because they are one decision — *what fills the row* —
 * and splitting them across a component is how the grid came to be rendered
 * beside the reading window's spacers instead of instead of them, adding a
 * whole section's width to a surface that is supposed to be exactly as long
 * as the music.
 */
import { readingRow, type ReadingRow } from "@/lib/ui/reading-row";
import { useDrumGridWindow, type DrumGridView } from "@/lib/workspace/use-drum-grid-window";
import { xAtSection } from "@/lib/tab/song-axis";
import type { DrumStepModel } from "@/lib/tab/drum-step-model";
import type { ReadingSurface } from "@/lib/workspace/use-reading-surface";
import type { RefObject } from "react";

export type ArmedGridRow = ReadingRow & {
  readonly grid: DrumGridView;
  /** Where the armed section starts on the shared axis, or null if none is. */
  readonly gridLeadPx: number | null;
};

export function useArmedGridRow(options: {
  readonly surface: ReadingSurface;
  /** The armed kit's grid model, or null when nothing is armed. */
  readonly model: DrumStepModel | null;
  readonly scrollRef: RefObject<HTMLDivElement | null>;
  readonly originPx: number;
}): ArmedGridRow {
  const { surface, model, scrollRef, originPx } = options;

  const gridLeadPx = model ? (xAtSection(surface.axis, model.sectionId) ?? 0) : null;
  const grid = useDrumGridWindow({
    model,
    scrollRef,
    offsetPx: originPx + (gridLeadPx ?? 0),
  });
  const row = readingRow({
    contentWidthPx: surface.contentWidthPx,
    originPx,
    windowBeforePx: surface.window.beforePx,
    windowRenderedPx: surface.window.renderedPx,
    armedGrid:
      gridLeadPx === null
        ? null
        : { leadPx: gridLeadPx, widthPx: grid.axis.totalWidthPx },
  });

  return { ...row, grid, gridLeadPx };
}

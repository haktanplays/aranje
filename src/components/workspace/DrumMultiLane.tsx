"use client";

/**
 * A drum kit's notation inside a multi-track lane (2Q-A §7).
 *
 * The same block the Tab surface draws, so the lane order, the piece glyphs
 * and the kick/snare/hat/cymbal separation are the ones the reader already
 * knows — and the bar geometry is identical to the fretted lane above it,
 * which is what makes the two comparable at all.
 */
import { DrumBarBlock } from "@/components/workspace/DrumBarBlock";
import { DrumStepLane } from "@/components/workspace/DrumStepLane";
import { gridLabelFor } from "@/components/workspace/grid-label";
import type { DrumGridAxis, DrumGridWindow } from "@/lib/ui/drum-grid-window";
import type { DrumStepModel } from "@/lib/tab/drum-step-model";
import type { DrumPiece } from "@/lib/instruments/registry";
import type { DrumBar } from "@/lib/tab/timeline";

/**
 * What it takes to write into a kit: the grid, and what a tap on it means.
 *
 * One object rather than two props, so a lane either has both or neither —
 * a model with no way to act on it would be a grid that silently does
 * nothing when tapped.
 */
export type DrumStepArming = {
  readonly model: DrumStepModel;
  toggle(ticks: number, piece: DrumPiece): void;
};

export function DrumMultiLane({
  trackId,
  bars,
  laneCount,
  activeBarKey,
  editable,
  entry,
  grid,
  onSelectBar,
}: {
  trackId: string;
  bars: readonly DrumBar[];
  laneCount: number;
  activeBarKey: string | null;
  editable: boolean;
  /** Armed for writing, or null: the lane reads instead. */
  entry: DrumStepArming | null;
  /**
   * Where the armed grid's columns are and which of them to mount.
   *
   * Handed down rather than computed here: the window depends on the shared
   * scroller's position, and this lane does not own that scroller (2R-A §6).
   */
  grid: { axis: DrumGridAxis; window: DrumGridWindow };
  onSelectBar: (barKey: string) => void;
}) {
  /*
   * Reading and writing are two different drawings of the same music, and
   * the step grid replaces the notation rather than sitting on top of it: a
   * tap has to mean one thing, and two overlapping surfaces is how it comes
   * to mean two.
   */
  if (entry) {
    return (
      <div data-multi-drums={trackId} className="flex">
        <DrumStepLane
          model={entry.model}
          axis={grid.axis}
          window={grid.window}
          entry={entry}
        />
      </div>
    );
  }

  return (
    <div data-multi-drums={trackId} className="flex">
      {bars.map((bar, index) => (
        /* The bar key on a wrapper, as on the Tab surface and the lane above. */
        <div key={bar.key} data-bar-key={bar.key}>
          <DrumBarBlock
            bar={bar}
            laneCount={laneCount}
            gridLabel={gridLabelFor(bars, index)}
            selected={editable && bar.key === activeBarKey}
            onSelect={() => onSelectBar(bar.key)}
          />
        </div>
      ))}
    </div>
  );
}

"use client";

/**
 * A fretted track's notation inside a multi-track lane (2Q-A §7).
 *
 * It draws the bars the single-track tab draws, through the same block, so a
 * guitar read beside a bass is the same guitar the reader edits on the Tab
 * surface — same staff, same fret numbers, same tie and legato marks, same
 * rhythm guide, same chord alignment. A second fretted renderer would be a
 * second answer to "what does this bar look like", and the two would drift.
 *
 * What it does not draw is a gutter of string names. The multi view is a
 * comparison, and six string labels repeated down four lanes is forty pixels
 * per lane spent on something the reader already knows.
 */
import {
  FrettedBarBlock,
  type CellSelection,
  type OnsetSelection,
} from "@/components/workspace/FrettedBarBlock";
import { gridLabelFor } from "@/components/workspace/TabCanvas";
import type { FrettedBar } from "@/lib/tab/timeline";

/**
 * The edit seam, handed to the active lane and to no other.
 *
 * Not a flag the lane interprets: the whole object is absent on every lane
 * but one, so there is nothing for an inactive lane to get wrong. A
 * selection cannot leak to a track that was never given the machinery.
 */
export type LaneEditing = {
  readonly cell: (CellSelection & { barKey: string }) | null;
  onCellSelect(cell: CellSelection & { barKey: string }): void;
  onsetsForBar(bar: { sectionId: string; barIndex: number }): OnsetSelection;
};

export function FrettedMultiLane({
  trackId,
  bars,
  stringCount,
  activeBarKey,
  editable,
  editing,
  onSelectBar,
}: {
  trackId: string;
  bars: readonly FrettedBar[];
  stringCount: number;
  activeBarKey: string | null;
  /**
   * True on the active lane only.
   *
   * A tap on an inactive lane makes it active first (§8); it does not edit
   * it. So the cell grid is armed on one lane at a time, and a gesture can
   * never resolve against a track the reader is not editing.
   */
  editable: boolean;
  /** Present only while this lane is the active one *and* edit mode is on. */
  editing: LaneEditing | null;
  onSelectBar: (barKey: string) => void;
}) {
  return (
    <div data-multi-fretted={trackId} className="flex">
      {bars.map((bar, index) => (
        /*
         * The bar key lives on a wrapper here for the same reason it does on
         * the Tab surface: it is how a scroll target and a measurement find a
         * bar without a ref per block, and it is what makes "every lane's bar
         * lines are at the same x" a thing a harness can check rather than a
         * claim (§6).
         */
        <div key={bar.key} data-bar-key={bar.key}>
          <FrettedBarBlock
            bar={bar}
            stringCount={stringCount}
            gridLabel={gridLabelFor(bars, index)}
            selected={editable && bar.key === activeBarKey}
            onSelect={() => onSelectBar(bar.key)}
            editing={editing !== null}
            selectedCell={
              editing && editing.cell?.barKey === bar.key ? editing.cell : null
            }
            onCellSelect={
              editing
                ? (cell) => editing.onCellSelect({ ...cell, barKey: bar.key })
                : undefined
            }
            onsets={
              editing
                ? editing.onsetsForBar({
                    sectionId: bar.sectionId,
                    barIndex: bar.barIndex,
                  })
                : null
            }
          />
        </div>
      ))}
    </div>
  );
}

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
import { gridLabelFor } from "@/components/workspace/TabCanvas";
import type { DrumBar } from "@/lib/tab/timeline";

export function DrumMultiLane({
  trackId,
  bars,
  laneCount,
  activeBarKey,
  editable,
  onSelectBar,
}: {
  trackId: string;
  bars: readonly DrumBar[];
  laneCount: number;
  activeBarKey: string | null;
  editable: boolean;
  onSelectBar: (barKey: string) => void;
}) {
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

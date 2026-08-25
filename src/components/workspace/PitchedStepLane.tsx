"use client";

/**
 * A fretless track, written into rather than read (2Q-B §7).
 *
 * One row of moments on exactly the geometry every other lane uses, so a
 * piano being written still lines up in time with the guitar above it. What
 * a moment shows is the pitch that is there, or the fact that nothing is.
 *
 * ## Why a tap opens a sheet instead of writing
 *
 * A drum cell knows what a tap means: the row *is* the piece. A melodic
 * moment does not — the pitch is the question — so the tap opens the note
 * sheet and the sheet writes. Guessing a pitch from where a finger landed
 * would need a vertical range this app does not have for any instrument, and
 * would be a fact about the instrument that is not in the registry.
 *
 * ## The honest size of a target
 *
 * A moment is one slot wide — 34px — because the shared time axis is the
 * point of the lane, and a full touch height tall. That is reported as
 * measured, not rounded up to 44.
 */
import {
  BAR_HEADER_HEIGHT,
  DRUM_STEP_ROW_HEIGHT,
  SLOT_WIDTH,
  barWidth,
} from "@/components/workspace/geometry";
import type { PitchedStepBar, PitchedStepModel } from "@/lib/tab/pitched-step-model";

export type PitchedStepEntry = {
  /** Ask the reader what belongs at this moment. */
  open(ticks: number): void;
};

/** The one word a moment says, or nothing at all. */
function cellText(state: string, pitches: readonly string[]): string {
  if (state === "note") return pitches[0] ?? "";
  if (state === "tie") return "–";
  return "";
}

function StepBar({
  bar,
  model,
  entry,
  gridLabel,
}: {
  bar: PitchedStepBar;
  model: PitchedStepModel;
  entry: PitchedStepEntry;
  gridLabel: string | null;
}) {
  return (
    <div
      data-pitched-step-bar={bar.key}
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

      <div
        className="border-line/50 relative border-t"
        style={{ height: DRUM_STEP_ROW_HEIGHT }}
      >
        {model.cells
          .filter((cell) => cell.barIndex === bar.barIndex)
          .map((cell) => {
            const written = cell.state === "note";
            return (
              <button
                key={cell.slotIndex}
                type="button"
                data-pitched-cell={cell.ticks}
                data-state={cell.state}
                data-filled={written ? "" : undefined}
                aria-label={`${bar.barNumber}. ölçü, ${cell.slotIndex + 1}. adım${
                  written ? `, ${cell.pitches.join(" ")}` : ""
                }`}
                onClick={() => entry.open(cell.ticks)}
                className={`absolute top-0 flex items-center justify-center overflow-hidden ${
                  written ? "bg-steel/15" : "bg-transparent"
                }`}
                style={{
                  left: cell.slotIndex * SLOT_WIDTH,
                  width: SLOT_WIDTH,
                  height: DRUM_STEP_ROW_HEIGHT,
                }}
              >
                {written || cell.state === "tie" ? (
                  <span className="text-text font-mono text-[10px] leading-none">
                    {cellText(cell.state, cell.pitches)}
                  </span>
                ) : (
                  <span className="bg-line block size-1 rounded-full" aria-hidden />
                )}
              </button>
            );
          })}
      </div>
    </div>
  );
}

export function PitchedStepLane({
  model,
  entry,
  gridLabelFor,
}: {
  model: PitchedStepModel;
  entry: PitchedStepEntry;
  gridLabelFor?: (bars: readonly PitchedStepBar[], index: number) => string | null;
}) {
  return (
    <div data-pitched-step={model.trackId} className="flex">
      {model.bars.map((bar, index) => (
        <div key={bar.key} data-bar-key={bar.key}>
          <StepBar
            bar={bar}
            model={model}
            entry={entry}
            gridLabel={gridLabelFor?.(model.bars, index) ?? null}
          />
        </div>
      ))}
    </div>
  );
}

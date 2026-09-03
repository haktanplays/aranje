import { SLOT_WIDTH } from "@/components/workspace/geometry";
import type { SlotState } from "@/lib/tab/timeline";

/**
 * Thin strip under the staff that carries the timing information the staff
 * itself cannot: where a note is struck, where it is still ringing, and where
 * the bar is silent. Beat positions get a slightly taller tick, which replaces
 * the full-height grid lines a spreadsheet would use.
 */
export function RhythmStrip({
  states,
  slotsPerBeat,
  column = SLOT_WIDTH,
}: {
  states: readonly SlotState[];
  slotsPerBeat: number;
  /** One stored column's width; narrower in a bar raised to a lattice (§7). */
  column?: number;
}) {
  return (
    <div className="relative h-full">
      {states.map((state, slotIndex) => {
        const onBeat = slotIndex % slotsPerBeat === 0;
        return (
          <div
            key={slotIndex}
            className="absolute inset-y-0 flex flex-col items-center justify-start"
            style={{ left: slotIndex * column, width: column }}
          >
            <span
              className={onBeat ? "bg-line block h-1.5 w-px" : "bg-line/50 block h-1 w-px"}
            />
            <span className="mt-1 flex h-2 items-center">
              {state === "onset" ? (
                <span className="bg-text/70 block size-1 rounded-full" />
              ) : state === "sustain" ? (
                <span className="bg-muted/45 block h-px w-3" />
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

import { SLOT_WIDTH } from "@/components/workspace/geometry";
import type { SlotState } from "@/lib/tab/timeline";

/**
 * Thin strip under the staff that separates an attack from a held note and
 * from a rest. Without it the tab cannot say how long a note lasts.
 */
export function RhythmStrip({ states }: { states: readonly SlotState[] }) {
  return (
    <div className="relative h-full border-t border-line">
      {states.map((state, slotIndex) => (
        <div
          key={slotIndex}
          className="absolute inset-y-0 flex items-center justify-center"
          style={{ left: slotIndex * SLOT_WIDTH, width: SLOT_WIDTH }}
        >
          {state === "onset" ? (
            <span className="bg-bronze block h-2.5 w-px" />
          ) : state === "sustain" ? (
            <span className="bg-bronze/50 block h-px w-4" />
          ) : state === "rest" ? (
            <span className="bg-muted/50 block h-px w-2" />
          ) : null}
        </div>
      ))}
    </div>
  );
}

"use client";

import type { OnsetMovement } from "@/lib/song/move";

const MOVES: { movement: OnsetMovement; glyph: string; label: string }[] = [
  { movement: "previous_bar", glyph: "«", label: "Seçimi bir ölçü geri taşı" },
  { movement: "previous_slot", glyph: "‹", label: "Seçimi bir slot sola taşı" },
  { movement: "next_slot", glyph: "›", label: "Seçimi bir slot sağa taşı" },
  { movement: "next_bar", glyph: "»", label: "Seçimi bir ölçü ileri taşı" },
];

/**
 * The controls for a group of chosen chords (spec 13.1, phase 2E).
 *
 * Only four directions, and no dragging. A drag would fight the tab's own
 * horizontal scroll, and that is not a fight worth picking before the thing
 * has been held in a hand.
 */
export function SelectionBar({
  count,
  error,
  onMove,
  onClear,
}: {
  count: number;
  error: string | null;
  onMove: (movement: OnsetMovement) => void;
  onClear: () => void;
}) {
  if (count === 0) return null;

  return (
    <div className="border-t border-line">
      {error ? (
        <p role="alert" className="border-reject/50 bg-raised border-b px-3 py-2 text-xs">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <p aria-live="polite" className="text-text mr-1 text-xs tabular-nums">
          {count} akor seçili
        </p>

        {MOVES.map((entry) => (
          <button
            key={entry.movement}
            type="button"
            onClick={() => onMove(entry.movement)}
            aria-label={entry.label}
            className="border-line text-muted flex min-h-11 min-w-11 items-center justify-center rounded-lg border text-base"
          >
            <span aria-hidden>{entry.glyph}</span>
          </button>
        ))}

        <button
          type="button"
          onClick={onClear}
          aria-label="Seçimi temizle"
          className="border-line text-muted ml-auto flex min-h-11 min-w-11 items-center justify-center rounded-lg border px-3 text-xs"
        >
          Temizle
        </button>

      </div>
    </div>
  );
}

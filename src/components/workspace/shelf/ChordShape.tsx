"use client";

/**
 * The shape, so a reader can see the chord before they hear it (§11 step 7).
 *
 * A chord flow that names a chord and offers "Dinle" asks the reader to trust
 * a word. A guitarist reads shapes: six strings, a fret number or an open
 * circle or a cross on each, and the hand position beside it. That is what
 * this draws, in the smallest form that is still readable — one row, not a
 * chord-box diagram, because the shelf is a strip and a diagram would be the
 * card-inside-a-card §18 forbids.
 *
 * It draws; it decides nothing. The voicing comes from the same recommender
 * the write uses, so what is shown and what is written cannot disagree.
 */
import type { ChordVoicing } from "@/lib/chords/chord-voicing";

/** Thickest string first, the way the data is ordered and a tab is read. */
const CELL =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-sm font-mono text-[11px] tabular-nums";

export function ChordShape({ voicing }: { voicing: ChordVoicing | null }) {
  if (!voicing || voicing.kind !== "fretted") return null;
  const { strings, anchor } = voicing.shape;
  return (
    <div className="flex items-center gap-1.5" data-chord-shape={voicing.id}>
      <div className="flex gap-0.5" aria-hidden>
        {[...strings].reverse().map((entry, index) => (
          <span
            key={index}
            data-shape-string={strings.length - 1 - index}
            className={
              entry.kind === "muted"
                ? `${CELL} text-muted/40`
                : entry.fret === 0
                  ? `${CELL} border-line text-muted border`
                  : `${CELL} border-bronze/50 text-bronze border`
            }
          >
            {entry.kind === "muted" ? "×" : entry.fret === 0 ? "○" : entry.fret}
          </span>
        ))}
      </div>
      {/* Where the hand sits. Absent when nothing is fretted, because "1.
          pozisyon" for a shape of open strings would be a number about
          nothing. */}
      {anchor > 0 ? (
        <span data-shape-anchor={anchor} className="text-muted text-[11px]">
          {anchor}. pozisyon
        </span>
      ) : null}
    </div>
  );
}

/** What a screen reader is told, since the row above is glyphs. */
export function shapeLabel(voicing: ChordVoicing | null): string {
  if (!voicing || voicing.kind !== "fretted") return "";
  return voicing.shape.strings
    .map((entry, index) =>
      entry.kind === "muted"
        ? `${index + 1}. tel susturulmuş`
        : entry.fret === 0
          ? `${index + 1}. tel boş`
          : `${index + 1}. tel ${entry.fret}. perde`,
    )
    .join(", ");
}

"use client";

/**
 * The selection, drawn as a band of time (spec 13.1, K-37).
 *
 * V1 selects a track, a section and a span of time — not a free rectangle of
 * strings — so the band covers the whole staff height rather than a few rows.
 * Drawing it any other way would promise a shape the core cannot express, and
 * a reader who selected one string of a chord would be told something untrue
 * about what is about to move.
 *
 * Colour alone never carries it. There is a filled surface, a solid edge at
 * each end, a stronger tint on the onsets inside it, and handles that are
 * visible objects — so it reads in bright sun, in dark mode, and to someone
 * who cannot separate the accent hue from the background.
 *
 * It sits at z-5: above the staff it is selecting, below the sticky gutter so
 * it never covers the string names, and below the playhead so the line saying
 * where the music is stays readable across it.
 */
import { SELECTION_HANDLE_WIDTH_PX } from "@/lib/ui/interaction";
import type { Section } from "@/lib/song/schema";
import type { TimeSelection } from "@/lib/song/time-selection";

export type TimeSelectionBandProps = {
  readonly section: Section;
  readonly selection: TimeSelection;
  readonly height: number;
  /** Reader-facing description, for assistive technology. */
  readonly label: string;
  /** Already resolved in tab coordinates by the caller. */
  readonly left: number;
  readonly width: number;
  readonly onHandleDown?: (edge: "start" | "end", event: React.PointerEvent) => void;
};

export function TimeSelectionBand({
  selection,
  height,
  label,
  left,
  width,
  onHandleDown,
}: TimeSelectionBandProps) {

  return (
    <div
      data-testid="time-selection-band"
      data-start-ticks={selection.startTicks}
      data-end-ticks={selection.endTicks}
      className="pointer-events-none absolute top-0 z-[5]"
      style={{ left, width, height }}
      role="region"
      aria-label={label}
    >
      {/* The surface. Deliberately translucent: the notes underneath are the
          thing being selected and must stay readable through it. */}
      <div className="bg-accent/20 ring-accent/70 absolute inset-0 rounded-sm ring-2 ring-inset" />

      {/* Solid ends, so the range reads without relying on the fill. A band
          crossing a bar line has exactly one of each: it is one selection. */}
      <div className="bg-accent absolute inset-y-0 left-0 w-[2px]" />
      <div className="bg-accent absolute inset-y-0 right-0 w-[2px]" />

      {(["start", "end"] as const).map((edge) => (
        <button
          key={edge}
          type="button"
          data-testid={`selection-handle-${edge}`}
          aria-label={edge === "start" ? "Seçim başlangıcını taşı" : "Seçim sonunu taşı"}
          onPointerDown={(event) => onHandleDown?.(edge, event)}
          className="pointer-events-auto absolute top-1/2 -translate-y-1/2 touch-none"
          style={{
            [edge === "start" ? "left" : "right"]: -SELECTION_HANDLE_WIDTH_PX / 2,
            width: SELECTION_HANDLE_WIDTH_PX,
            height: SELECTION_HANDLE_WIDTH_PX,
          }}
        >
          {/* The grab area meets the touch minimum; the visible grip is small,
              so it does not cover the music it is next to. */}
          <span className="bg-accent border-app mx-auto block h-6 w-2 rounded-full border" />
        </button>
      ))}
    </div>
  );
}

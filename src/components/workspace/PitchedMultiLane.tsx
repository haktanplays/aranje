"use client";

/**
 * A melodic instrument with no fretboard, in a multi-track lane (2Q-A §7).
 *
 * ## What this is, said plainly
 *
 * It is a **pitch lane**, not piano notation. There is no staff, no clef, no
 * key signature, no accidental placement, no stem direction and no rest
 * glyph. A note is a block: its horizontal place is when it happens, its
 * height is how high it sounds, and its label is the note name. That is the
 * whole vocabulary.
 *
 * Calling this "piano notation" would be the lie that matters here, because
 * a reader who believes it would trust the vertical positions to mean the
 * things a staff means. They do not. What the lane honestly answers is *is
 * this instrument playing here, and roughly where* — which is exactly the
 * question the multi-track view exists for.
 *
 * ## Nothing is invented
 *
 * No string, no fret. A pitched instrument does not have them, and drawing a
 * fret number under a piano note would be a fact about a guitar that is not
 * in this song. The pitch axis is the lane's own, computed once for the
 * whole section so two bars of the same melody are drawn at the same height.
 */
import { SLOT_WIDTH } from "@/components/workspace/geometry";
import {
  PitchedStepLane,
  type PitchedStepEntry,
} from "@/components/workspace/PitchedStepLane";
import type { PitchedStepModel } from "@/lib/tab/pitched-step-model";
import type { PitchAxis, PitchedBar } from "@/lib/multitrack/model";

/**
 * A pitch lane armed for writing (2Q-B §7.3).
 *
 * One object rather than two props, so a lane either has both a model and a
 * way to act on it or neither.
 */
export type PitchedStepArming = PitchedStepEntry & {
  readonly model: PitchedStepModel;
};

/** How tall the note field is. The axis is mapped onto exactly this. */
const FIELD_HEIGHT = 72;
/** A note block is never thinner than this, however short the note. */
const MIN_NOTE_WIDTH = 10;

export function PitchedMultiLane({
  trackId,
  bars,
  axis,
  slotCounts,
  entry = null,
  height = FIELD_HEIGHT,
}: {
  trackId: string;
  bars: readonly PitchedBar[];
  axis: PitchAxis;
  /** The shared axis's slot count per bar, so widths match every other lane. */
  slotCounts: readonly number[];
  /** Armed for writing, or null: the lane reads instead. */
  entry?: PitchedStepArming | null;
  height?: number;
}) {
  /*
   * Reading and writing are two drawings of the same music, and the strip
   * replaces the pitch blocks rather than sitting over them: a tap has to
   * mean one thing.
   */
  if (entry) {
    return (
      <div data-multi-pitched={trackId} className="flex">
        <PitchedStepLane model={entry.model} entry={entry} />
      </div>
    );
  }

  /** Where a midi number sits: high notes up, and the span never divides by nothing. */
  const yOf = (midi: number): number => {
    const span = Math.max(1, axis.span);
    const through = (midi - axis.lowMidi) / span;
    return height - through * height;
  };

  return (
    <div data-multi-pitched={trackId} className="flex">
      {bars.map((bar, index) => {
        const slots = slotCounts[index] ?? 0;
        return (
          <div
            key={bar.key}
            data-bar-key={bar.key}
            className="border-line/60 relative shrink-0 border-r"
            style={{ width: slots * SLOT_WIDTH, height }}
          >
            {bar.notes.map((note, noteIndex) => {
              if (note.midi === null) return null;
              const left = note.startSlot * SLOT_WIDTH;
              const width = Math.max(
                MIN_NOTE_WIDTH,
                (note.endSlot - note.startSlot + 1) * SLOT_WIDTH - 2,
              );
              return (
                <span
                  key={`${bar.key}:${note.startSlot}:${noteIndex}:${note.pitch}`}
                  className="bg-steel/70 text-app absolute flex items-center justify-center rounded-sm px-0.5 font-mono text-[9px] leading-none"
                  style={{
                    left,
                    width,
                    // Centred on its pitch, and clamped so a note at the very
                    // top or bottom of the range is still fully drawn.
                    top: Math.max(0, Math.min(height - 10, yOf(note.midi) - 5)),
                    height: 10,
                  }}
                >
                  {width >= 22 ? note.pitch : ""}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

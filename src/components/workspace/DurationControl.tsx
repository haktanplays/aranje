"use client";

import { useRef } from "react";

import { ticksLabel } from "@/lib/song/duration-drag";
import { pointerOwner, stopsPageScroll } from "@/lib/tab/pointer-ownership";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";

/**
 * Setting a note's length (2T-B §6).
 *
 * ## What the founder found, and what each part of this answers
 *
 * - *"Extending a note deletes the next one."* It cannot: the length lives on
 *   the note, and the core reads and writes exactly one note. What used to
 *   happen was the tie run being rewritten over the slot after it.
 * - *"One grid step extends to the end of the bar."* It does not: the drag is
 *   whole grid steps measured from where the gesture began, so one step is
 *   one step, and a finger that wanders out and back lands where it started.
 * - *"The handle loses the gesture to page scroll."* It cannot: the press is
 *   captured on the grip, and scrolling is stopped for exactly as long as
 *   this gesture owns the pointer. Nothing global is touched, so every other
 *   gesture on the page — including this sheet's own scroll — still works.
 * - *"It cuts at the next note."* That is the sounding model's business now,
 *   and it only cuts where the same string is taken again.
 *
 * ## Why it lives here rather than on the staff
 *
 * Because this is where the selected note is. Choosing a cell opens this
 * sheet, so a grip drawn on the staff would sit behind it and never be
 * reachable by a finger. What *is* on the staff is the preview: while this
 * drag runs, the note behind grows and shrinks with it.
 *
 * ## Ownership, decided in one place
 *
 * `pointerOwner` is the single function that says whose gesture a press is,
 * and it is asked here rather than a timer being raced.
 *
 * ## Nothing is written until the finger comes up
 *
 * Moving only changes a number the preview reads. Release applies once, as
 * one command and one step of history. Cancel — a lost pointer, a cancelled
 * touch — throws that number away, and the song is byte-identical because it
 * was never touched.
 */

/** Pixels of travel that mean one grid step. Wide enough not to fire on a tap. */
export const DRAG_STEP_PX = 28;

export function DurationControl({
  writtenTicks,
  noteIndex,
  previewTicks,
  label,
  active,
  onGrab,
  onMove,
  onRelease,
  onCancel,
}: {
  /** What the note is written at now, for the resting label. */
  writtenTicks: number;
  noteIndex: number;
  previewTicks: number | null;
  label: string | null;
  active: boolean;
  onGrab: (noteIndex: number) => void;
  onMove: (deltaPx: number, slotWidthPx: number) => void;
  onRelease: () => void;
  onCancel: () => void;
}) {
  const origin = useRef<number | null>(null);
  const owner = pointerOwner({
    onDurationHandle: true,
    penArmed: false,
    selectionAvailable: false,
  });
  const owns = owner === "duration";
  const shown = active && previewTicks !== null ? previewTicks : writtenTicks;

  const step = (steps: number) => {
    /* The buttons are the same gesture, done exactly: grab, move one whole
       step, release. One command and one step of history, like a drag. */
    onGrab(noteIndex);
    onMove(steps * DRAG_STEP_PX, DRAG_STEP_PX);
    onRelease();
  };

  return (
    <div className="border-line flex items-center gap-2 border-t pt-3" data-duration-row>
      <span className="text-muted shrink-0 text-sm">Süre</span>

      <button
        type="button"
        data-testid="duration-shorter"
        aria-label="Süreyi bir adım kısalt"
        className="border-line shrink-0 rounded-lg border text-sm"
        style={{ width: MIN_TOUCH_TARGET_PX, height: MIN_TOUCH_TARGET_PX }}
        onClick={() => step(-1)}
      >
        −
      </button>

      <button
        type="button"
        data-testid="duration-handle"
        data-active={active ? "true" : "false"}
        data-ticks={shown}
        aria-label={label ?? `Nota süresi: ${ticksLabel(shown)}. Sürükleyerek değiştirin.`}
        className={`border-line grow rounded-lg border text-sm ${
          active ? "bg-accent/15 border-accent/60" : ""
        }`}
        style={{
          height: MIN_TOUCH_TARGET_PX,
          /* Only this element, and only because it owns the gesture. The
             sheet keeps scrolling everywhere else. */
          touchAction: owns && stopsPageScroll(owner) ? "none" : undefined,
        }}
        onPointerDown={(event) => {
          if (!owns) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          origin.current = event.clientX;
          onGrab(noteIndex);
        }}
        onPointerMove={(event) => {
          if (origin.current === null) return;
          onMove(event.clientX - origin.current, DRAG_STEP_PX);
        }}
        onPointerUp={() => {
          if (origin.current === null) return;
          origin.current = null;
          onRelease();
        }}
        onPointerCancel={() => {
          origin.current = null;
          onCancel();
        }}
        onLostPointerCapture={() => {
          /* Taken away rather than finished. Nothing was written, so there is
             nothing to roll back. */
          if (origin.current === null) return;
          origin.current = null;
          onCancel();
        }}
      >
        {ticksLabel(shown)}
      </button>

      <button
        type="button"
        data-testid="duration-longer"
        aria-label="Süreyi bir adım uzat"
        className="border-line shrink-0 rounded-lg border text-sm"
        style={{ width: MIN_TOUCH_TARGET_PX, height: MIN_TOUCH_TARGET_PX }}
        onClick={() => step(1)}
      >
        +
      </button>
    </div>
  );
}

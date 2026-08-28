/**
 * A finger on a note's length (2T-B §6).
 *
 * The pure half of the duration handle: where a drag of so many pixels lands,
 * what the note would become, and what to say about it while the finger is
 * still down. No DOM, no React, no commit — the slot width comes in as a
 * number and the answer goes out as ticks.
 *
 * ## Why the gesture has its own state at all
 *
 * Because a preview that writes is not a preview. The founder's finding was
 * that extending a note deleted the next one, and the fix for that is only
 * half the story: the other half is that nothing at all is written until the
 * finger comes up. A cancelled drag has to leave the song byte-identical, and
 * the cheapest way to guarantee that is never to have touched it.
 *
 * So the drag carries where the note *was*, and the only thing that changes
 * while it runs is a number in this object. `commitDurationDrag` is the one
 * call that produces a new song, and it is called once, on release.
 */
import {
  noteValueOf,
  splitIntoValues,
  valueLabel,
} from "@/lib/music/note-value";
import {
  currentDurationTicks,
  durationFromDrag,
  maxDurationTicks,
  setNoteDuration,
  slotTicksAt,
  type DurationResult,
  type DurationTarget,
} from "@/lib/song/note-duration";
import type { Song } from "@/lib/song/schema";

export type DurationDrag = {
  readonly target: DurationTarget;
  /** What the note was before the finger touched it. The rollback value. */
  readonly startTicks: number;
  /** Whole grid steps the finger has moved, positive to the right. */
  readonly steps: number;
  /** Where it would land, already clamped to what the music has room for. */
  readonly ticks: number;
};

/** Start a drag on a note, or nothing if there is no note to drag. */
export function beginDurationDrag(
  song: Song,
  target: DurationTarget,
): DurationDrag | null {
  const oneSlot = slotTicksAt(song, target);
  if (oneSlot <= 0) return null;
  const startTicks = currentDurationTicks(song, target);
  if (startTicks <= 0) return null;
  return { target, startTicks, steps: 0, ticks: startTicks };
}

/**
 * Where the drag is now, measured from where it began.
 *
 * Steps are counted from the gesture's origin rather than accumulated from
 * the last move, so a finger that wanders out and back lands exactly where it
 * started — accumulating would drift, and drift in a length is a wrong note.
 */
export function moveDurationDrag(
  song: Song,
  drag: DurationDrag,
  deltaPx: number,
  slotWidthPx: number,
): DurationDrag {
  if (slotWidthPx <= 0) return drag;
  const steps = Math.round(deltaPx / slotWidthPx);
  return { ...drag, steps, ticks: durationFromDrag(song, drag.target, steps) };
}

/** True when the finger has actually asked for a different length. */
export function dragChanged(drag: DurationDrag): boolean {
  return drag.ticks !== drag.startTicks;
}

/** True when the drag is already as long or as short as the music allows. */
export function dragAtLimit(song: Song, drag: DurationDrag): boolean {
  const oneSlot = slotTicksAt(song, drag.target);
  return drag.ticks <= oneSlot || drag.ticks >= maxDurationTicks(song, drag.target);
}

/** The note value a length would be written as, in words. */
export function ticksLabel(ticks: number): string {
  const exact = noteValueOf(ticks);
  if (exact !== null) return valueLabel(exact);
  const parts = splitIntoValues(ticks);
  if (parts.length === 0) return "yazılamayan süre";
  return `${parts.map(valueLabel).join(" + ")} (bağlı)`;
}

/**
 * What the reader is told while the finger is down.
 *
 * The value first, because that is the answer to "what am I writing"; the
 * number of steps second, because that is the answer to "did it move".
 */
export function durationDragLabel(drag: DurationDrag): string {
  const value = ticksLabel(drag.ticks);
  if (!dragChanged(drag)) return `${value} · değişmedi`;
  const steps = Math.abs(drag.steps);
  return `${value} · ${steps} adım ${drag.steps > 0 ? "uzun" : "kısa"}`;
}

/**
 * The one call that writes. Everything before it was a number in an object.
 *
 * A drag that did not change anything is refused rather than committed, so a
 * tap on the handle cannot put an empty step into the history.
 */
export function commitDurationDrag(
  song: Song,
  drag: DurationDrag,
): DurationResult {
  if (!dragChanged(drag)) return { ok: false, reason: "duration_out_of_range" };
  return setNoteDuration(song, drag.target, drag.ticks);
}

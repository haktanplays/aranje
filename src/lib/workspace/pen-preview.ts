/**
 * The armed pen's preview, resolved for the surface that draws it (K-59 §6).
 *
 * `previewPen` runs the real command and hands back the Song it produced;
 * `penGhost` turns one slot of that Song into strings and frets. This is the
 * two-line join between them, and it lives here rather than in a component so
 * the surface can ask one question and get one answer.
 *
 * The target is the cell the reader has selected. That is the beat the pen
 * would write to, it is a real (bar, slot, string) the reader chose, and it
 * survives arming the pen — so picking up "Power chord · 3 ses" shows the
 * three voices on the beat under the finger before anything is written.
 */
import { penGhost, type PenGhost } from "@/lib/tab/pen-ghost";
import type { EditedCell } from "@/lib/workspace/use-note-editing";
import type { IntentComposer } from "@/lib/workspace/use-intent-composer";
import type { Song } from "@/lib/song/schema";

export function armedPenGhost(input: {
  readonly composer: Pick<IntentComposer, "penArmed" | "previewPen">;
  readonly cell: EditedCell | null;
  readonly song: Song;
  readonly trackId: string | undefined;
}): PenGhost | null {
  const { composer, cell, trackId } = input;
  if (!composer.penArmed || !cell || !trackId) return null;
  return penGhost({
    preview: composer.previewPen(cell),
    current: input.song,
    trackId,
    barKey: cell.barKey,
    slotIndex: cell.slotIndex,
  });
}

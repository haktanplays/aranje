/**
 * What a note is already doing (2V-C.2 §13).
 *
 * The panel could add a gesture and never show one. That is only half a
 * behaviour: a reader who touches a note that already bends has no way to see
 * what it does, change it, or take it off — and "write a different one over
 * it" is refused, correctly, as two answers on one axis. So the shelf needs
 * to be able to read the note, and reading a note out of a Song is a question
 * about the Song rather than about the shelf.
 *
 * It answers per axis, because the two axes are removed separately: taking
 * the bend off a note that is also slid into must leave the slide alone.
 */
import { resolveExpression } from "@/lib/music/expression-resolver";
import { pitchReading, connectionReading } from "@/lib/music/gesture-language";
import { findSection, sectionSlotStream } from "@/lib/song/onset-block";
import type { NoteEvent, Song } from "@/lib/song/schema";

export type GestureInspection = {
  readonly note: NoteEvent;
  /** True when this note carries a pitch gesture of its own. */
  readonly hasPitchGesture: boolean;
  /** True when it is joined to the note before it. */
  readonly hasConnection: boolean;
  /** What the pitch does, in the words the tab uses. Empty when nothing. */
  readonly pitchSpoken: string;
  /** How it joins, in the same words. Empty when nothing. */
  readonly connectionSpoken: string;
  /**
   * What taking the pitch gesture off should be called.
   *
   * "Bükmeyi kaldır" on a note that is slid into, not bent, is the panel
   * telling the reader about a gesture they did not write. Both live on the
   * same axis and are removed the same way, so the verb has to follow what is
   * there rather than the field it is stored in.
   */
  readonly pitchRemoveLabel: string;
};

/** The note the reader is holding, and what it already says. */
export function inspectGesture(
  song: Song,
  where: {
    readonly sectionId: string;
    readonly trackId: string;
    readonly timeTicks: number;
    readonly noteIndex?: number;
  },
): GestureInspection | null {
  const section = findSection(song, where.sectionId);
  if (!section) return null;
  const stream = sectionSlotStream(section, where.trackId);
  const entry = stream.find((slot) => slot.startTicks === where.timeTicks);
  if (!entry || !entry.writable) return null;
  const slot = entry.slot;
  if (slot === undefined || slot === null || slot === "-") return null;
  const note = slot.notes[where.noteIndex ?? 0];
  if (!note) return null;

  const reading = resolveExpression(note);
  const kind = note.pitchGesture?.kind;
  const slides = kind === "slide_in" || kind === "slide_out";
  return {
    note,
    pitchRemoveLabel: slides ? "Kaydırmayı kaldır" : "Bükmeyi kaldır",
    /*
     * Asked of the note's own fields, not of the resolver's answer. A legacy
     * `bend_full` reads as a bend and is worth showing, but it is not a
     * `pitchGesture`, and offering to remove one that is not there would
     * either do nothing or quietly rewrite an old song's articulation.
     */
    hasPitchGesture: note.pitchGesture !== undefined,
    hasConnection: note.connection !== undefined,
    pitchSpoken: pitchReading(reading.pitch).spoken,
    connectionSpoken: connectionReading(reading.connection).spoken,
  };
}

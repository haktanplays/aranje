/**
 * Writing and un-writing a shape slide, all strings or none (2V-C.3 §10, §14).
 *
 * The single-note command already refuses one note at a time. That is not
 * enough here: a shape whose second string is refused and whose first is
 * written is a hand that slid on one string, which is not what the reader
 * asked for and is not something the notation can draw. So every string is
 * validated first, against the Song as it *would* be, and only then is
 * anything written.
 *
 * There is one write, one history step and one undo because there is one call
 * to `settle`. Nothing here loops over `applyGestureWrite`: that would be N
 * writes wearing one button, and the third of them failing would leave two
 * behind.
 */
import { applyGestureWrite } from "@/lib/song/gesture-write";
import {
  shapeSlideAt,
  SHAPE_MESSAGE,
  type ShapeSlideRefusal,
} from "@/lib/song/shape-slide";
import { settle } from "@/lib/song/edit";
import { findSection, sectionSlotStream } from "@/lib/song/onset-block";
import type { MelodicSlot, NoteConnection, NoteEvent, Song } from "@/lib/song/schema";

export type ShapeWriteCommand = {
  readonly sectionId: string;
  readonly trackId: string;
  /** The onset the hand arrives at. */
  readonly targetTicks: number;
  /** What to write on every moving string, or `null` to take the shape off. */
  readonly connection: Extract<
    NoteConnection,
    { kind: "legato_slide" } | { kind: "shift_slide" }
  > | null;
};

export type ShapeWriteResult =
  | { readonly ok: true; readonly song: Song; readonly strings: number }
  | {
      readonly ok: false;
      readonly reason: ShapeSlideRefusal | "no_change";
      readonly message: string;
    };

const refuse = (reason: ShapeSlideRefusal): ShapeWriteResult => ({
  ok: false,
  reason,
  message: SHAPE_MESSAGE[reason],
});

/**
 * Which strings a shape write would touch.
 *
 * For a removal that is the shape that is already written, read back from the
 * notes. For an addition it is every string the two onsets share — the shape
 * does not exist yet, so it cannot be derived from itself.
 */
function movingStrings(
  song: Song,
  command: ShapeWriteCommand,
): { readonly strings: readonly number[]; readonly refusal: ShapeSlideRefusal | null } {
  if (command.connection === null) {
    const found = shapeSlideAt(song, command);
    if (!found.ok) return { strings: [], refusal: found.reason };
    return { strings: found.plan.voices.map((voice) => voice.stringIndex), refusal: null };
  }

  const section = findSection(song, command.sectionId);
  if (!section) return { strings: [], refusal: "no_section" };
  const stream = sectionSlotStream(section, command.trackId);
  const index = stream.findIndex((entry) => entry.startTicks === command.targetTicks);
  if (index < 0) return { strings: [], refusal: "no_target_onset" };
  const slot = stream[index]?.slot;
  if (slot === undefined || slot === null || slot === "-") {
    return { strings: [], refusal: "no_target_onset" };
  }
  const strings = slot.notes
    .map((note: NoteEvent) => note.position?.string)
    .filter((value): value is number => value !== undefined);
  return { strings, refusal: null };
}

/** The voice index of a string at this onset, so the write aims at one note. */
function noteIndexOf(slot: MelodicSlot | undefined, stringIndex: number): number | null {
  if (slot === undefined || slot === null || slot === "-") return null;
  const index = slot.notes.findIndex(
    (note: NoteEvent) => note.position?.string === stringIndex,
  );
  return index < 0 ? null : index;
}

/**
 * Write, or remove, the whole shape.
 *
 * The strategy is deliberately boring: build the candidate Song in memory by
 * editing every note, ask the shape model whether the result is a real shape,
 * and only then settle it. A refusal returns before `settle` is ever called,
 * so the caller's Song is the object it passed in — not a copy that happens
 * to be equal, the same object — and there is nothing to roll back.
 */
export function applyShapeSlide(
  song: Song,
  command: ShapeWriteCommand,
): ShapeWriteResult {
  const { strings, refusal } = movingStrings(song, command);
  if (refusal !== null) return refuse(refusal);
  if (strings.length < 2) return refuse("not_a_shape");

  const section = findSection(song, command.sectionId);
  if (!section) return refuse("no_section");
  const stream = sectionSlotStream(section, command.trackId);
  const target = stream.find((entry) => entry.startTicks === command.targetTicks);
  const targetSlot = target?.slot;

  /*
   * Every string edited on the way to one candidate. `applyGestureWrite` is
   * reused for its refusals — it is the one place that knows what a single
   * connection needs — but its Song is threaded forward rather than
   * committed, so a refusal on the last string discards the first.
   */
  let candidate = song;
  for (const stringIndex of [...strings].sort((a, b) => a - b)) {
    const noteIndex = noteIndexOf(targetSlot, stringIndex);
    if (noteIndex === null) return refuse("string_set_differs");
    const step = applyGestureWrite(candidate, {
      sectionId: command.sectionId,
      trackId: command.trackId,
      timeTicks: command.targetTicks,
      noteIndex,
      connection: command.connection,
    });
    if (!step.ok) {
      /*
       * One string already saying what is being asked is not a refusal of
       * the gesture — the others may still change, and if none of them do
       * the emptiness is caught below and reported as itself. Refusing here
       * would make "add a slide to a shape that has one on one string" fail
       * with a sentence about that string being unplayable, which it is not.
       */
      if (step.error === "no_change") continue;
      return refuse(
        step.error === "not_fretted" ? "not_fretted" : "unplayable_voice",
      );
    }
    candidate = step.song;
  }

  if (candidate === song) {
    return { ok: false, reason: "no_change", message: "Bu notalar zaten böyle." };
  }

  /*
   * The shape has to be a shape *after* the write, not before it. This is
   * what catches the cases the per-note command cannot see: different
   * intervals, different directions, a string that is not there on both
   * sides, an open string in the middle of the grip.
   */
  if (command.connection !== null) {
    const derived = shapeSlideAt(candidate, command);
    if (!derived.ok) return refuse(derived.reason);
  }

  const settled = settle(candidate);
  if (!settled.ok) return refuse("unplayable_voice");
  return { ok: true, song: settled.song, strings: strings.length };
}

/** True when this onset carries a written shape, whatever its kind. */
export function hasShapeSlide(
  song: Song,
  where: {
    readonly sectionId: string;
    readonly trackId: string;
    readonly targetTicks: number;
  },
): boolean {
  return shapeSlideAt(song, where).ok;
}

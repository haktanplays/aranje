/**
 * Writing a bend or a slide onto a note that already exists (2V-C.1 §10, §16).
 *
 * ## One intent, one Song, or nothing
 *
 * The reader picked a note and said what the hand does to it. That is one
 * decision, so this produces one whole Song or a typed refusal and no Song at
 * all. There is no half-written gesture, no partially applied bend, and no
 * second commit path: the caller hands the result to the same `commit` every
 * other edit uses, which is what makes undo one step and redo byte-exact.
 *
 * ## Every refusal is a sentence about the music
 *
 * A slide needs somewhere to come from. A bend needs a string to bend. A
 * gesture that cannot be played is refused *before* anything is written, in
 * words a guitarist can act on — never a code, never a stack, never silence.
 * The Song, the storage and the history are untouched on every one of these
 * paths, which the tests assert byte for byte rather than trusting.
 *
 * ## Direction comes from the sounding pitch
 *
 * Not from the fret number. A capo, a dropped string or a manual tuning can
 * make fret 5 sound higher than fret 7 on the neighbour, and a slide drawn
 * from the fret numbers would then point the wrong way. The pitch is the
 * physical truth, so the pitch decides.
 */
import { pitchToMidi } from "@/lib/music/pitch";
import { resolveExpression } from "@/lib/music/expression-resolver";
import { expressionPresets } from "@/lib/audio/expression";
import { settle } from "@/lib/song/edit";
import { findSection, sectionSlotStream } from "@/lib/song/onset-block";
import type {
  MelodicSlot,
  NoteConnection,
  NoteEvent,
  PitchGesture,
  Song,
} from "@/lib/song/schema";

export type GestureFailure =
  | "no_section"
  | "no_track"
  | "no_note_here"
  /** The moment named is a tie, not an onset: the gesture belongs to the head. */
  | "target_is_tie_continuation"
  /** The instrument has no strings, so there is nothing to bend or slide on. */
  | "not_fretted"
  | "no_previous_note"
  | "previous_note_other_string"
  /** There is real silence between the two notes; a hand cannot bridge it. */
  | "silence_between"
  /** Both notes sound the same pitch, so the slide has no direction. */
  | "no_direction"
  | "interval_too_wide"
  /** The notes are so close together the travel would not be heard. */
  | "no_room_to_glide"
  /** The note already answers this axis another way. */
  | "conflicting_gesture"
  | "no_change";

export const GESTURE_MESSAGE: Readonly<Record<GestureFailure, string>> = {
  no_section: "Bu bölüm bulunamadı.",
  no_track: "Bu enstrüman bulunamadı.",
  no_note_here: "Burada bir nota yok. Önce notayı yaz.",
  target_is_tie_continuation:
    "Burası önceki notanın devamı. Hareketi notanın başladığı yere yaz.",
  not_fretted: "Bu enstrümanda tel yok, bu yüzden bükme ve kaydırma yapılamıyor.",
  no_previous_note: "Kayacak bir önceki nota yok.",
  previous_note_other_string:
    "Önceki nota başka bir telde. Kaydırma tek telde olur.",
  silence_between: "İki notanın arasında sus var; el kayarak geçemez.",
  no_direction: "İki nota da aynı sesi veriyor, kayacak bir yer yok.",
  interval_too_wide: "Bu mesafe kaydırmak için fazla uzak.",
  no_room_to_glide: "Notalar birbirine çok yakın; kayma duyulmaz.",
  conflicting_gesture:
    "Bu notada zaten başka bir hareket var. Önce onu kaldır.",
  no_change: "Bu nota zaten böyle.",
};

export type GestureWriteCommand = {
  readonly sectionId: string;
  readonly trackId: string;
  /** Ticks from the start of the section. The moment, not a slot index. */
  readonly timeTicks: number;
  /** Which voice of the onset. A chord's notes each answer for themselves. */
  readonly noteIndex?: number;
  /** What the pitch should do. `null` removes whatever was there. */
  readonly pitchGesture?: PitchGesture | null;
  /** How the note joins the one before it. `null` removes it. */
  readonly connection?: NoteConnection | null;
};

export type GestureWriteResult =
  | { readonly ok: true; readonly song: Song }
  | {
      readonly ok: false;
      readonly error: GestureFailure;
      readonly message: string;
    };

const fail = (error: GestureFailure): GestureWriteResult => ({
  ok: false,
  error,
  message: GESTURE_MESSAGE[error],
});

/**
 * The note sounding on this string immediately before `index`, if any.
 *
 * "Immediately" is the whole question: a rest between the two is silence, and
 * a hand cannot slide across silence. So the walk stops at the first slot
 * that is written and empty rather than skipping over it.
 */
function previousOnSameString(
  stream: readonly { readonly slot: MelodicSlot | undefined; readonly writable: boolean }[],
  index: number,
  stringIndex: number,
): { readonly note: NoteEvent } | "silence" | "other_string" | null {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const entry = stream[cursor];
    if (!entry) return null;
    if (!entry.writable) return "silence";
    const slot = entry.slot;
    if (slot === undefined || slot === null) return "silence";
    if (slot === "-") continue;
    const note = slot.notes.find(
      (candidate) => candidate.position?.string === stringIndex,
    );
    /*
     * Something was sounding, and it was not on this string. That is a
     * different problem from silence and gets a different sentence: the
     * reader can move a note, and cannot un-rest a rest.
     */
    return note ? { note } : "other_string";
  }
  return null;
}

/** Does this connection travel along the string rather than hammer onto it? */
const travels = (connection: NoteConnection): boolean =>
  connection.kind === "legato_slide" || connection.kind === "shift_slide";

export function applyGestureWrite(
  song: Song,
  command: GestureWriteCommand,
): GestureWriteResult {
  const section = findSection(song, command.sectionId);
  if (!section) return fail("no_section");
  const track = song.tracks.find((entry) => entry.id === command.trackId);
  if (!track) return fail("no_track");
  if (!track.fretboard) return fail("not_fretted");

  const stream = sectionSlotStream(section, command.trackId);
  const index = stream.findIndex((entry) => entry.startTicks === command.timeTicks);
  if (index < 0) return fail("no_note_here");
  const target = stream[index]!;
  if (!target.writable || target.slot === undefined || target.slot === null) {
    return fail("no_note_here");
  }
  if (target.slot === "-") return fail("target_is_tie_continuation");

  const noteIndex = command.noteIndex ?? 0;
  const note = target.slot.notes[noteIndex];
  if (!note) return fail("no_note_here");
  if (note.position === undefined) return fail("not_fretted");

  /*
   * A note may not answer one axis twice. Asked of what the note would
   * *become*, so replacing a legacy `slide` with an explicit connection is
   * allowed while adding one beside it is not.
   */
  const next: NoteEvent = { ...note };
  if (command.pitchGesture !== undefined) {
    if (command.pitchGesture === null) delete (next as { pitchGesture?: unknown }).pitchGesture;
    else next.pitchGesture = command.pitchGesture;
  }
  if (command.connection !== undefined) {
    if (command.connection === null) delete (next as { connection?: unknown }).connection;
    else next.connection = command.connection;
  }
  if (resolveExpression(next).conflict !== null) return fail("conflicting_gesture");

  /* ------------------------------------------- what the music has to allow */

  const connection = next.connection;
  if (connection && travels(connection)) {
    const previous = previousOnSameString(stream, index, note.position.string);
    if (previous === null) return fail("no_previous_note");
    if (previous === "other_string") return fail("previous_note_other_string");
    if (previous === "silence") return fail("silence_between");

    const from = pitchToMidi(previous.note.pitch);
    const to = pitchToMidi(note.pitch);
    if (from === null || to === null) return fail("no_previous_note");
    /*
     * Direction from the sounding pitch, never from the fret (§8). A capo or
     * a dropped string can make the larger fret the lower note, and a slide
     * drawn from fret numbers would then point the wrong way.
     */
    const interval = to - from;
    if (interval === 0) return fail("no_direction");
    if (Math.abs(interval) > expressionPresets.slide.maxIntervalSemitones) {
      return fail("interval_too_wide");
    }
  }

  if (connection && !travels(connection)) {
    const previous = previousOnSameString(stream, index, note.position.string);
    if (previous === null) return fail("no_previous_note");
    if (previous === "other_string") return fail("previous_note_other_string");
    if (previous === "silence") return fail("silence_between");
    const from = pitchToMidi(previous.note.pitch);
    const to = pitchToMidi(note.pitch);
    if (from === null || to === null) return fail("no_previous_note");
    if (from === to) return fail("no_direction");
  }

  /* ------------------------------------------------------------- the write */

  const sectionIndex = song.sections.findIndex((entry) => entry.id === command.sectionId);
  const nextSong: Song = {
    ...song,
    sections: song.sections.map((entry, entryIndex) =>
      entryIndex === sectionIndex
        ? {
            ...entry,
            bars: entry.bars.map((bar, barIndex) =>
              barIndex === target.barIndex
                ? {
                    ...bar,
                    slots: {
                      ...bar.slots,
                      [command.trackId]: (bar.slots[command.trackId] as MelodicSlot[]).map(
                        (slot, slotIndex) =>
                          slotIndex === target.slotIndex && slot !== null && slot !== "-"
                            ? {
                                notes: slot.notes.map((voice, voiceIndex) =>
                                  voiceIndex === noteIndex ? next : voice,
                                ),
                              }
                            : slot,
                      ),
                    },
                  }
                : bar,
            ),
          }
        : entry,
    ),
  };

  if (JSON.stringify(nextSong) === JSON.stringify(song)) return fail("no_change");

  const settled = settle(nextSong);
  if (!settled.ok) return fail("conflicting_gesture");
  return { ok: true, song: settled.song };
}

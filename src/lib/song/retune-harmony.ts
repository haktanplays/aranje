/**
 * "Keep the rhythm, change the chord" (2T §11).
 *
 * This is the first arrangement primitive, and it is the one that makes the
 * claim about being more than a tab editor concrete. A tab editor lets you
 * write a figure. An arranger lets you say *what the figure is* and then ask
 * for it again over different harmony — same groove, same picking hand, new
 * chord.
 *
 * ## What is kept, and why that is the whole point
 *
 * Everything that makes the figure the figure:
 *
 * - **when** each note happens, exactly, to the tick;
 * - **how long** each note is, including a ringing pedal voice;
 * - **which articulation** it carries — a palm mute stays a palm mute;
 * - **which voice of the chord** it was, so a bass-note-then-treble pattern
 *   stays a bass-note-then-treble pattern;
 * - **let-ring and strum intent**, because those are the picking hand.
 *
 * Only the pitches move, and they move by the interval between the two
 * chords' roots, snapped into the new chord's own notes. A figure over E minor
 * asked for over A minor comes back as the same rhythm with A minor's notes
 * in it.
 *
 * ## Local, deterministic, and refusing rather than guessing
 *
 * No provider is involved and no model is asked. The same figure and the same
 * target produce the same answer every time. Where a note cannot be resolved
 * onto the instrument — off the end of the fretboard, or not in the tuning —
 * the whole transform is refused with a typed reason. Half a transposed riff
 * is worse than none, because the reader would have to find the half that
 * moved.
 */
import { midiToPitch, pitchClass, pitchToMidi } from "@/lib/music/pitch";
import {
  isMelodicSlotArray,
  songSchema,
  type MelodicSlot,
  type NoteEvent,
  type Song,
} from "@/lib/song/schema";

/** A chord named by its root and the notes it actually contains. */
export type Harmony = {
  /** "E", "A#", "Bb" — the root's pitch class name. */
  readonly root: string;
  /**
   * Semitones above the root that belong to this chord.
   *
   * A power chord is [0, 7]; a minor triad [0, 3, 7]; a major [0, 4, 7]. The
   * caller says what the chord is rather than the module inferring it from a
   * name, because "Am7add11" is a parsing problem and this is not a parser.
   */
  readonly intervals: readonly number[];
};

export type RetuneTarget = {
  readonly sectionId: string;
  readonly barIndex: number;
  readonly trackId: string;
  readonly fromSlot: number;
  /** Exclusive. The run of slots the figure occupies. */
  readonly toSlot: number;
};

export type RetuneFailure =
  | "target_not_found"
  | "not_a_melodic_track"
  | "empty_selection"
  | "unknown_root"
  | "unreachable_pitch";

export type RetuneResult =
  | {
      readonly ok: true;
      readonly song: Song;
      /** What moved where, for a preview to show before anything is applied. */
      readonly moves: readonly { readonly from: string; readonly to: string }[];
    }
  | { readonly ok: false; readonly reason: RetuneFailure; readonly detail?: string };

const PITCH_CLASSES: Readonly<Record<string, number>> = {
  C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5,
  "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11,
};

/**
 * Move one pitch from one chord to another, keeping its shape in the figure.
 *
 * The note's interval above the source root is measured, mapped onto the
 * nearest interval the target chord actually has, and rebuilt over the target
 * root in the same octave region. So the root of a figure stays its root, the
 * fifth stays a fifth, and a passing note lands on the closest chord tone
 * rather than on a semitone the chord does not contain.
 */
export function retunePitch(
  pitch: string,
  from: Harmony,
  to: Harmony,
): string | null {
  const midi = pitchToMidi(pitch);
  const fromRoot = PITCH_CLASSES[from.root];
  const toRoot = PITCH_CLASSES[to.root];
  if (midi === null || fromRoot === undefined || toRoot === undefined) return null;

  const cls = pitchClass(pitch);
  if (cls === null) return null;

  const degree = (cls - fromRoot + 12) % 12;
  /*
   * Nearest by interval distance, ties going to the lower — so a note halfway
   * between two chord tones lands consistently rather than on whichever the
   * array happened to list first.
   */
  const nearest = [...to.intervals].sort((a, b) => {
    const da = Math.min(Math.abs(a - degree), 12 - Math.abs(a - degree));
    const db = Math.min(Math.abs(b - degree), 12 - Math.abs(b - degree));
    return da === db ? a - b : da - db;
  })[0];
  if (nearest === undefined) return null;

  /* Keep the octave the original sat in, measured from its own root. */
  const octaveBase = midi - degree;
  const shifted = octaveBase + (toRoot - fromRoot) + nearest;
  if (shifted < 0 || shifted > 127) return null;
  return midiToPitch(shifted);
}

/**
 * Apply a new harmony to a run of slots, keeping everything but the pitches.
 *
 * Positions are dropped rather than recomputed: a fret is a claim about where
 * a pitch sits on this instrument, and the placement engine owns that claim.
 * Keeping a stale fret beside a new pitch would be the one thing worse than
 * dropping it — a tab that shows a number which does not produce the note
 * beside it.
 */
export function retuneHarmony(
  song: Song,
  target: RetuneTarget,
  from: Harmony,
  to: Harmony,
): RetuneResult {
  if (PITCH_CLASSES[from.root] === undefined || PITCH_CLASSES[to.root] === undefined) {
    return { ok: false, reason: "unknown_root" };
  }
  const sectionIndex = song.sections.findIndex((entry) => entry.id === target.sectionId);
  if (sectionIndex < 0) return { ok: false, reason: "target_not_found" };
  const bar = song.sections[sectionIndex]!.bars[target.barIndex];
  if (!bar) return { ok: false, reason: "target_not_found" };
  const slots = bar.slots[target.trackId];
  if (!slots) return { ok: false, reason: "target_not_found" };
  if (!isMelodicSlotArray(slots)) return { ok: false, reason: "not_a_melodic_track" };

  const moves: { from: string; to: string }[] = [];
  const next: MelodicSlot[] = [...slots];
  let touched = 0;

  for (let slotIndex = target.fromSlot; slotIndex < target.toSlot; slotIndex += 1) {
    const slot = slots[slotIndex];
    if (slot === undefined) continue;
    if (slot === null || slot === "-") continue;

    const notes: NoteEvent[] = [];
    for (const note of slot.notes) {
      const moved = retunePitch(note.pitch, from, to);
      if (moved === null) {
        return {
          ok: false,
          reason: "unreachable_pitch",
          detail: `${note.pitch} bu armonide karşılanamadı.`,
        };
      }
      const rebuilt: NoteEvent = { ...note, pitch: moved };
      /* The placement engine owns where a pitch sits; a stale fret is a lie. */
      delete rebuilt.position;
      notes.push(rebuilt);
      moves.push({ from: note.pitch, to: moved });
    }
    next[slotIndex] = { notes };
    touched += 1;
  }

  if (touched === 0) return { ok: false, reason: "empty_selection" };

  const candidate: Song = {
    ...song,
    sections: song.sections.map((section, index) =>
      index !== sectionIndex
        ? section
        : {
            ...section,
            bars: section.bars.map((entry, barIndex) =>
              barIndex !== target.barIndex
                ? entry
                : { ...entry, slots: { ...entry.slots, [target.trackId]: next } },
            ),
          },
    ),
  };

  const parsed = songSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, reason: "unreachable_pitch", detail: "Sonuç şemaya uymadı." };
  }
  return { ok: true, song: parsed.data, moves };
}

/**
 * Writing a chord into a song (spec 13.22 §12, §13, §14, 2O-B).
 *
 * One pure function, one atomic result. It takes the song, a musical moment in
 * **ticks**, and a chosen voicing, and answers with the whole song as it would
 * be — or with a typed refusal and nothing else. There is no half-written
 * chord and no second commit path: the caller hands the result to the same
 * `commit` every other edit uses.
 *
 * ## Ticks, not slot indices
 *
 * Bars no longer share a grid (K-34), so "slot 4" means different moments in
 * different bars. The command is given a moment and finds the slot that starts
 * exactly there. If no slot starts exactly there — a moment on a 1/16 grid
 * aimed at a 1/12 bar — it refuses. Nothing is rounded to the nearest slot,
 * because a chord that lands a thirty-second early is not the chord that was
 * asked for.
 *
 * ## What it refuses, and why each refusal exists
 *
 * A chord replaces a whole onset or nothing. Writing over one string of an
 * existing chord would leave a reader with music they never played, and
 * silently thinning a tie chain would change notes they cannot see from here.
 * So an occupied target has to be named as a replacement by the caller, a tie
 * continuation is never a place to start a chord, and an onset that another
 * note is bonded to is refused outright — the reader detaches it with the
 * tools that already exist for that, where they can see what they are cutting.
 */
import { chordFail, type ChordFailure } from "@/lib/chords/chord-errors";
import { voicingToNotes, type ChordVoicing } from "@/lib/chords/chord-voicing";
import { isDrumInstrument } from "@/lib/instruments/registry";
import { isChainArticulation } from "@/lib/song/articulation-roles";
import { withEmptyLaneInBar } from "@/lib/song/track-lanes";
import {
  findSection,
  sectionSlotStream,
  type SlotPosition,
} from "@/lib/song/onset-block";
import { settle } from "@/lib/song/edit";
import { sameSong } from "@/lib/song/edit-history";
import {
  isDrumSlotArray,
  type Articulation,
  type MelodicSlot,
  type NoteEvent,
  type Song,
} from "@/lib/song/schema";
import type { ValidationIssue } from "@/lib/validators";

/** The five articulations a whole chord may be given (spec 13.22 §15). */
export const CHORD_ARTICULATIONS = [
  "normal",
  "accent",
  "palm_mute",
  "sustain",
  "staccato",
] as const;

export type ChordArticulation = (typeof CHORD_ARTICULATIONS)[number];

export function isChordArticulation(value: string): value is ChordArticulation {
  return (CHORD_ARTICULATIONS as readonly string[]).includes(value);
}

export type ChordWriteCommand = {
  readonly sectionId: string;
  readonly trackId: string;
  /** Ticks from the start of the section. The moment, not a slot number. */
  readonly timeTicks: number;
  /** How long the chord sounds, in ticks. Ties carry it (spec 5.4). */
  readonly durationTicks: number;
  readonly voicing: ChordVoicing;
  readonly velocity: number;
  readonly articulation?: ChordArticulation;
  /**
   * `insert` needs an empty target; `replace_onset` says out loud that the
   * notes already there are going. There is no mode that decides for itself.
   */
  readonly mode: "insert" | "replace_onset";
};

export type ChordWriteResult =
  | {
      readonly ok: true;
      readonly song: Song;
      readonly warnings: readonly ValidationIssue[];
      /** Every slot the chord touched, for a preview to draw. */
      readonly written: readonly { readonly barIndex: number; readonly slotIndex: number }[];
    }
  | { readonly ok: false; readonly error: ChordFailure };

/* -------------------------------------------------------------- inspection */

const isOnset = (entry: SlotPosition | undefined): boolean =>
  entry !== undefined && entry.writable && entry.slot !== null && entry.slot !== "-";

const notesOf = (entry: SlotPosition | undefined): readonly NoteEvent[] =>
  entry && entry.writable && entry.slot !== null && entry.slot !== undefined && entry.slot !== "-"
    ? entry.slot.notes
    : [];

/** True when the notes in this slot are bonded to a neighbouring one. */
function carriesChainArticulation(entry: SlotPosition | undefined): boolean {
  return notesOf(entry).some((note) => isChainArticulation(note.articulation));
}

/**
 * The slots one onset occupies: the struck slot and the ties that continue it.
 */
function onsetSpan(stream: readonly SlotPosition[], index: number): number[] {
  const span = [index];
  for (let cursor = index + 1; cursor < stream.length; cursor += 1) {
    const entry = stream[cursor];
    if (!entry || !entry.writable || entry.slot !== "-") break;
    span.push(cursor);
  }
  return span;
}

/** One value shared by every note, or null when they disagree. */
function agreedVelocity(notes: readonly NoteEvent[]): number | null | "mixed" {
  if (notes.length === 0) return null;
  const first = notes[0]?.velocity ?? null;
  return notes.every((note) => (note.velocity ?? null) === first) ? first : "mixed";
}

function agreedArticulation(
  notes: readonly NoteEvent[],
): Articulation | null | "mixed" {
  if (notes.length === 0) return null;
  const first = notes[0]?.articulation ?? null;
  return notes.every((note) => (note.articulation ?? null) === first) ? first : "mixed";
}

/* ------------------------------------------------------------------ writing */

function cloneSong(song: Song): Song {
  return structuredClone(song);
}

function writeSlot(
  song: Song,
  sectionIndex: number,
  trackId: string,
  entry: SlotPosition,
  value: MelodicSlot,
): void {
  const slots = song.sections[sectionIndex]?.bars[entry.barIndex]?.slots[trackId];
  if (!Array.isArray(slots) || isDrumSlotArray(slots)) return;
  (slots as MelodicSlot[])[entry.slotIndex] = value;
}

export function applyChordWrite(
  song: Song,
  command: ChordWriteCommand,
): ChordWriteResult {
  const sectionIndex = song.sections.findIndex(
    (section) => section.id === command.sectionId,
  );
  const section = findSection(song, command.sectionId);
  if (!section) return chordFail("target_grid_incompatible");

  const track = song.tracks.find((entry) => entry.id === command.trackId);
  if (!track) return chordFail("target_grid_incompatible");

  /*
   * A melodic track that has no lane in a bar is not written there yet, which
   * is a place a chord can go once the lane is laid — and the lane is laid
   * inside this command's own candidate, never as a separate write (K-55).
   * A drum lane is a different shape and is never one of these places.
   */
  const melodic = !isDrumInstrument(track.instrumentId);
  const canWrite = (entry: SlotPosition | undefined): boolean =>
    entry !== undefined && (entry.writable || (melodic && entry.slot === undefined));

  const stream = sectionSlotStream(section, command.trackId);
  const startIndex = stream.findIndex(
    (entry) => entry.startTicks === command.timeTicks,
  );
  /*
   * No slot begins at that moment. This is the mixed-grid refusal: the caller
   * is told the grid cannot represent it, and nothing is rounded to fit.
   */
  if (startIndex < 0) return chordFail("target_grid_incompatible");

  const start = stream[startIndex]!;
  if (!canWrite(start)) return chordFail("target_grid_incompatible");

  // A tie is somebody else's note still sounding; a chord cannot begin inside
  // one, whichever mode was asked for.
  if (start.slot === "-") return chordFail("target_is_tie_continuation");

  const occupied = isOnset(start);
  if (command.mode === "insert" && occupied) return chordFail("target_occupied");

  /* ---------------------------------------------------- the existing onset */

  let replacedSpan: number[] = [];
  if (occupied) {
    const existing = notesOf(start);
    if (carriesChainArticulation(start)) return chordFail("chord_target_linked");

    // A bond reaching *into* this onset from the slot before it counts too:
    // cutting it from this side is the same cut.
    if (carriesChainArticulation(stream[startIndex - 1])) {
      return chordFail("chord_target_linked");
    }

    if (agreedVelocity(existing) === "mixed") return chordFail("mixed_onset_velocity");
    if (agreedArticulation(existing) === "mixed") {
      return chordFail("mixed_onset_expression");
    }
    replacedSpan = onsetSpan(stream, startIndex);
  }

  /* ------------------------------------------------------- the new duration */

  if (command.durationTicks <= 0) return chordFail("duration_not_representable");

  const span: number[] = [];
  let covered = 0;
  for (let cursor = startIndex; cursor < stream.length; cursor += 1) {
    if (covered >= command.durationTicks) break;
    const entry = stream[cursor];
    if (!entry || !canWrite(entry)) break;
    span.push(cursor);
    covered += entry.durationTicks;
  }
  /*
   * The duration has to land on a slot boundary exactly. A chord that would
   * end halfway through a slot cannot be written down, and shortening it to
   * fit would be the app deciding how long the reader's chord is.
   */
  if (covered !== command.durationTicks) {
    return chordFail("duration_not_representable");
  }

  // Nothing beyond the first slot may already be sounding something else.
  for (const cursor of span.slice(1)) {
    if (replacedSpan.includes(cursor)) continue;
    const entry = stream[cursor];
    if (!entry) return chordFail("duration_not_representable");
    if (entry.slot !== null && entry.slot !== undefined) {
      return chordFail("target_occupied");
    }
  }

  /* ------------------------------------------------------------- the write */

  const notes = voicingToNotes(command.voicing, {
    velocity: command.velocity,
    ...(command.articulation === undefined ? {} : { articulation: command.articulation }),
  });
  if (notes.length === 0) return chordFail("no_playable_voicing");

  /*
   * The lanes this write needs, laid inside the candidate and nowhere else.
   * Only the bars the chord actually reaches: a command that wrote rests
   * across bars it never touched would be a bigger change than the reader
   * asked for, and it would show up in the fingerprint as one.
   */
  let prepared = song;
  for (const barIndex of new Set(span.map((cursor) => stream[cursor]!.barIndex))) {
    prepared = withEmptyLaneInBar(prepared, track, command.sectionId, barIndex);
  }
  const next = cloneSong(prepared);

  // Anything the replaced onset was still sounding past the new chord becomes
  // silence: it belonged to notes that are no longer there.
  for (const cursor of replacedSpan) {
    if (span.includes(cursor)) continue;
    const entry = stream[cursor];
    if (entry) writeSlot(next, sectionIndex, command.trackId, entry, null);
  }

  span.forEach((cursor, offset) => {
    const entry = stream[cursor];
    if (!entry) return;
    writeSlot(
      next,
      sectionIndex,
      command.trackId,
      entry,
      offset === 0 ? { notes } : "-",
    );
  });

  if (sameSong(next, prepared)) return chordFail("chord_no_change");

  const settled = settle(next);
  if (!settled.ok) return chordFail("chord_validation_failed");

  return {
    ok: true,
    song: settled.song,
    warnings: settled.warnings,
    written: span.map((cursor) => ({
      barIndex: stream[cursor]!.barIndex,
      slotIndex: stream[cursor]!.slotIndex,
    })),
  };
}

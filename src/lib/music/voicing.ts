/**
 * Every way one onset could be played (spec 9.2, K-19).
 *
 * This is the search space the placement engine chooses from. It answers one
 * question and no other: given a chord and a fretboard, what are all the
 * physically possible ways to hold it?
 *
 * Three rules shape it, and each is a rule about honesty rather than about
 * fingering:
 *
 * - **A written position is never touched.** It keeps its string and fret and
 *   reserves that string; the rest of the chord is placed around it. If it is
 *   internally wrong, that is `fretboardIntegrity`'s to report, not this
 *   module's to quietly fix. Two written positions on one string stay on one
 *   string, so `stringCollision` can see them.
 * - **Nothing is invented.** If no complete voicing exists, that is reported
 *   as such. A partial placement dressed up as a whole one would make
 *   `unplaceable` unable to see the problem.
 * - **Nothing is silently dropped.** Enumeration is exhaustive within Core
 *   Lite. Where a cap could ever bite it is recorded, not hidden.
 */
import {
  maxCapoRelativeFret,
  physicalFret,
  type Fretboard,
  type Position,
} from "@/lib/music/fretboard";
import {
  anchorOf,
  chordSpan,
  stringCenter,
  type HandNote,
} from "@/lib/music/hand-position";
import { pitchToMidi } from "@/lib/music/pitch";
import type { NoteEvent } from "@/lib/song/schema";

/** Strings the pilot's Core Lite catalogue actually has (spec 7.1, 19.1). */
export const CORE_LITE_MAX_STRINGS = 6;

/**
 * A ceiling on how many complete voicings one onset may enumerate.
 *
 * Within Core Lite it can never bite: six strings and six notes give at most
 * 720 assignments before de-duplication. It exists so an instrument outside
 * the pilot cannot make the search unbounded, and when it does bite it is
 * reported in the diagnostics rather than passed off as a full search.
 */
export const MAX_VOICINGS_PER_ONSET = 2048;

export type PlacedNote = {
  /** Index in the onset's own note list, so doubling stays two notes. */
  noteIndex: number;
  pitch: string;
  stringIndex: number;
  /** Capo-relative: 0 is the sound behind the capo (spec 9.1). */
  fret: number;
  physicalFret: number;
  source: "explicit" | "computed";
};

export type Voicing = {
  /** In note order, so the caller can map straight back to its notes. */
  notes: readonly PlacedNote[];
  anchor: number;
  span: number;
  center: number;
  maxPhysicalFret: number;
  totalPhysicalFret: number;
  /**
   * The placement as a set of string/fret pairs, independent of which note
   * got which. Two assignments that differ only in swapping identical pitches
   * are the same way of holding the chord, and share a signature.
   */
  signature: string;
};

export type VoicingResult =
  /** Every note of the onset has a position. */
  | { kind: "placed"; voicings: readonly Voicing[]; truncated: boolean }
  /**
   * The written positions stand, but the notes around them do not fit.
   *
   * A written position is never given up because a sibling could not be
   * placed: spec 9.2 keeps it exactly as written whatever else happens. The
   * notes that found no string are named instead, and `unplaceable` reports
   * them (spec 10.3).
   */
  | {
      kind: "partial";
      voicings: readonly Voicing[];
      unresolved: readonly number[];
      truncated: boolean;
    }
  /** Nothing could be placed at all; `unplaceable` owns this (spec 10.3). */
  | { kind: "unplaceable" }
  /** Nothing to place: the onset has no notes. */
  | { kind: "empty" };

/** Every string that can sound this pitch, lowest string first. */
export function candidatePositions(
  fretboard: Fretboard,
  pitch: string,
): Position[] {
  const target = pitchToMidi(pitch);
  if (target === null) return [];

  const positions: Position[] = [];
  const maxFret = maxCapoRelativeFret(fretboard.capo);

  for (let string = 0; string < fretboard.tuning.length; string += 1) {
    const openString = fretboard.tuning[string];
    if (openString === undefined) continue;
    const openMidi = pitchToMidi(openString);
    if (openMidi === null) continue;

    const fret = target - openMidi - fretboard.capo;
    if (fret < 0 || fret > maxFret) continue;
    positions.push({ string, fret });
  }

  return positions;
}

function toPlaced(
  noteIndex: number,
  note: NoteEvent,
  position: Position,
  capo: number,
  source: PlacedNote["source"],
): PlacedNote {
  return {
    noteIndex,
    pitch: note.pitch,
    stringIndex: position.string,
    fret: position.fret,
    physicalFret: physicalFret(capo, position.fret),
    source,
  };
}

function signatureOf(notes: readonly PlacedNote[]): string {
  return [...notes]
    .map((note) => `${note.stringIndex}:${note.fret}`)
    .sort()
    .join("|");
}

function measure(notes: readonly PlacedNote[]): Voicing {
  const hand: HandNote[] = notes.map((note) => ({
    stringIndex: note.stringIndex,
    physicalFret: note.physicalFret,
  }));
  const frets = notes.map((note) => note.physicalFret);

  return {
    notes: [...notes].sort((a, b) => a.noteIndex - b.noteIndex),
    anchor: anchorOf(hand),
    span: chordSpan(hand),
    center: stringCenter(hand),
    maxPhysicalFret: frets.length === 0 ? 0 : Math.max(...frets),
    totalPhysicalFret: frets.reduce((sum, fret) => sum + fret, 0),
    signature: signatureOf(notes),
  };
}

/**
 * Canonical order: the way a memoryless reader would rank them — nearest the
 * nut, then least total stretch, then narrowest, then lowest strings, then the
 * signature. It is what the engine falls back to at the first onset, and what
 * makes ties reproducible everywhere else.
 */
export function compareVoicings(a: Voicing, b: Voicing): number {
  if (a.maxPhysicalFret !== b.maxPhysicalFret) {
    return a.maxPhysicalFret - b.maxPhysicalFret;
  }
  if (a.totalPhysicalFret !== b.totalPhysicalFret) {
    return a.totalPhysicalFret - b.totalPhysicalFret;
  }
  if (a.span !== b.span) return a.span - b.span;
  if (a.center !== b.center) return a.center - b.center;
  return a.signature < b.signature ? -1 : a.signature > b.signature ? 1 : 0;
}

/**
 * All the ways this onset can be held, in canonical order and de-duplicated.
 *
 * The input is never touched; the notes come back as new objects.
 */
export function candidateVoicings(
  fretboard: Fretboard,
  notes: readonly NoteEvent[],
): VoicingResult {
  if (notes.length === 0) return { kind: "empty" };

  const capo = fretboard.capo;
  const explicit: PlacedNote[] = [];
  const reserved = new Set<number>();
  const pending: { noteIndex: number; options: Position[] }[] = [];

  notes.forEach((note, noteIndex) => {
    if (note.position) {
      // Kept exactly as written, wrong or not, and its string is taken.
      explicit.push(toPlaced(noteIndex, note, note.position, capo, "explicit"));
      reserved.add(note.position.string);
      return;
    }
    pending.push({
      noteIndex,
      options: candidatePositions(fretboard, note.pitch),
    });
  });

  if (explicit.length === 0 && pending.length === 0) return { kind: "empty" };

  /** Written positions alone, with the rest of the onset left unplaced. */
  const explicitOnly = (): VoicingResult => {
    const unresolved = pending.map((entry) => entry.noteIndex).sort((a, b) => a - b);
    if (explicit.length === 0) return { kind: "unplaceable" };
    return {
      kind: "partial",
      voicings: [measure(explicit)],
      unresolved,
      truncated: false,
    };
  };

  // A note the fretboard cannot reach at all cannot be placed; `range` names
  // the pitch, `unplaceable` names the chord it could not join.
  if (pending.some((entry) => entry.options.length === 0)) {
    return explicitOnly();
  }

  if (pending.length === 0) {
    return { kind: "placed", voicings: [measure(explicit)], truncated: false };
  }

  // Fewest options first: an impossible branch dies as early as possible, and
  // the order is a property of the input rather than of object iteration.
  const ordered = [...pending].sort(
    (a, b) => a.options.length - b.options.length || a.noteIndex - b.noteIndex,
  );

  const seen = new Set<string>();
  const voicings: Voicing[] = [];
  const chosen: PlacedNote[] = [];
  const used = new Set<number>(reserved);
  let truncated = false;

  const search = (depth: number): void => {
    if (truncated) return;
    if (depth === ordered.length) {
      const complete = [...explicit, ...chosen];
      const signature = signatureOf(complete);
      if (seen.has(signature)) return;
      seen.add(signature);
      if (voicings.length >= MAX_VOICINGS_PER_ONSET) {
        truncated = true;
        return;
      }
      voicings.push(measure(complete));
      return;
    }

    const entry = ordered[depth];
    if (!entry) return;
    const note = notes[entry.noteIndex];
    if (!note) return;

    for (const option of entry.options) {
      if (used.has(option.string)) continue;
      used.add(option.string);
      chosen.push(toPlaced(entry.noteIndex, note, option, capo, "computed"));
      search(depth + 1);
      chosen.pop();
      used.delete(option.string);
      if (truncated) return;
    }
  };

  search(0);

  // The positionless notes are placed together or not at all, the same
  // all-or-nothing the chord itself is: half a chord is not a voicing.
  if (voicings.length === 0) return explicitOnly();

  return {
    kind: "placed",
    voicings: voicings.sort(compareVoicings),
    truncated,
  };
}

/** True when this fretboard is outside what the pilot catalogue covers. */
export function isBeyondCoreLite(fretboard: Fretboard): boolean {
  return fretboard.tuning.length > CORE_LITE_MAX_STRINGS;
}

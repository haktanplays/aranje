/**
 * Measuring one placement against another (spec 9.2, K-19).
 *
 * Test-only. This is how the phase 2D quality claim is made in numbers rather
 * than by looking at a screenshot: the same song is placed by the memoryless
 * baseline and by the ergonomic engine, and the same six measurements are
 * taken of both.
 *
 * The measurements are deliberately the ones the engine optimises plus the one
 * it does not control (unresolved onsets), so a trade can be seen rather than
 * hidden.
 */
import {
  anchorOf,
  chordSpan,
  maxShiftFor,
  type HandNote,
} from "@/lib/music/hand-position";
import { placeTrack } from "@/lib/music/placement";
import { trackPlacementInput } from "@/lib/tab/placement-input";
import { physicalFret, type Fretboard } from "@/lib/music/fretboard";
import type { Song, Track } from "@/lib/song/schema";
import { resolveSlotPositions } from "@/test/legacy-greedy";

export type PlacementMetrics = {
  onsets: number;
  /** Shifts larger than the family threshold (spec 10.3). */
  largeJumps: number;
  /** Sum of every anchor move, in physical frets. */
  anchorTravel: number;
  /** The single worst move. */
  worstJump: number;
  /** Sum of every chord's stretch. */
  totalSpan: number;
  unresolvedOnsets: number;
  /** Only meaningful for the ergonomic engine. */
  candidateVoicings?: number;
  maxBeamStates?: number;
  resets?: number;
};

type Onset = { barNumber: number; notes: HandNote[]; unresolved: boolean };

function measure(sequence: readonly Onset[], maxShift: number): PlacementMetrics {
  let largeJumps = 0;
  let anchorTravel = 0;
  let worstJump = 0;
  let totalSpan = 0;
  let unresolved = 0;
  let previous: number | null = null;

  for (const onset of sequence) {
    if (onset.unresolved) unresolved += 1;
    if (onset.notes.length === 0) continue;

    const anchor = anchorOf(onset.notes);
    totalSpan += chordSpan(onset.notes);

    if (previous !== null) {
      const move = Math.abs(anchor - previous);
      anchorTravel += move;
      worstJump = Math.max(worstJump, move);
      if (move > maxShift) largeJumps += 1;
    }
    previous = anchor;
  }

  return {
    onsets: sequence.length,
    largeJumps,
    anchorTravel,
    worstJump,
    totalSpan,
    unresolvedOnsets: unresolved,
  };
}

/** What the memoryless rule would have done, for comparison only. */
export function baselineMetrics(song: Song, track: Track): PlacementMetrics | null {
  const fretboard: Fretboard | undefined = track.fretboard;
  const maxShift = maxShiftFor(track.instrumentId);
  if (!fretboard || maxShift === null) return null;

  const { onsets } = trackPlacementInput(song, track.id);
  const sequence: Onset[] = onsets.map((onset) => {
    const resolved = resolveSlotPositions(fretboard, onset.notes);
    const notes: HandNote[] = [];
    let unresolved = false;
    for (const entry of resolved) {
      if (!entry.position) {
        unresolved = true;
        continue;
      }
      notes.push({
        stringIndex: entry.position.string,
        physicalFret: physicalFret(fretboard.capo, entry.position.fret),
      });
    }
    return { barNumber: onset.barNumber, notes, unresolved };
  });

  return measure(sequence, maxShift);
}

/** What the ergonomic engine does, measured the same way. */
export function ergonomicMetrics(song: Song, track: Track): PlacementMetrics | null {
  const fretboard: Fretboard | undefined = track.fretboard;
  const maxShift = maxShiftFor(track.instrumentId);
  if (!fretboard || maxShift === null) return null;

  const { onsets, bars } = trackPlacementInput(song, track.id);
  const result = placeTrack({ fretboard, onsets, bars, maxShift });

  const sequence: Onset[] = onsets.map((onset) => {
    const outcome = result.byOnset.get(onset.key);
    if (!outcome || outcome.kind === "unresolved") {
      return { barNumber: onset.barNumber, notes: [], unresolved: true };
    }
    return {
      barNumber: onset.barNumber,
      notes: outcome.voicing.notes.map((note) => ({
        stringIndex: note.stringIndex,
        physicalFret: note.physicalFret,
      })),
      unresolved: outcome.kind === "partial",
    };
  });

  return {
    ...measure(sequence, maxShift),
    candidateVoicings: result.diagnostics.totalCandidateVoicings,
    maxBeamStates: result.diagnostics.maxBeamStates,
    resets: result.diagnostics.resets,
  };
}

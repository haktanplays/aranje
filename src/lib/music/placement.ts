/**
 * Ergonomic Placement v2 (spec 9.2, decision K-19).
 *
 * The old rule placed each chord on its own merits and never looked at the one
 * before it, so it could hand a player a fourteen-fret leap between two eighth
 * notes without noticing (K-4). This walks the track in time and keeps the
 * hand in mind.
 *
 * It is a *limited and explainable* heuristic, not a model of a hand. It
 * knows about where the hand sits, how far it has to jump, how wide the chord
 * is and which part of the neck is in use. It knows nothing about fingers,
 * barres, picking or legato, and it does not pretend to.
 *
 * Two design choices are worth stating outright:
 *
 * - **The cost is a tuple compared left to right, not a weighted score.** A
 *   weighted score would make "why did it choose that?" unanswerable, and
 *   every tuning of the weights a guess. A lexicographic order says exactly
 *   what matters more than what, and can be read back off a failing test.
 * - **Nothing is random and nothing depends on object iteration order.** The
 *   same song places the same way on every machine and every run, which is
 *   what lets a placement be a fixture at all.
 */
import { placementLimits } from "@/lib/limits";
import {
  isLargeShift,
  shiftExcess,
  type HandNote,
} from "@/lib/music/hand-position";
import type { Fretboard } from "@/lib/music/fretboard";
import {
  candidateVoicings,
  compareVoicings,
  isBeyondCoreLite,
  type PlacedNote,
  type Voicing,
} from "@/lib/music/voicing";
import type { NoteEvent } from "@/lib/song/schema";

/** One struck chord, in playing order, with where it sits in the song. */
export type PlacementOnset = {
  /** Stable identity: section index, bar index inside it, slot index. */
  key: string;
  sectionIndex: number;
  barIndex: number;
  slotIndex: number;
  /** Position of the bar in the flattened bar stream, for the reset rule. */
  barNumber: number;
  notes: readonly NoteEvent[];
};

/**
 * "These two notes must end up on the same string" (spec 9.2, 8.5, K-27).
 *
 * A slide, a hammer-on and a pull-off are all one finger moving along one
 * string. The model may not write positions — placement belongs to the
 * engine (spec 11.1) — so before this existed the model could write a
 * pull-off and the search, knowing nothing about it, could put the two notes
 * on different strings and make it unplayable. Nobody could fix that: not the
 * model, which has no lever, and not a correction round, which can only
 * change pitches.
 *
 * So the relationship travels into the search as an edge and is decided
 * *with* the placement rather than checked after it.
 *
 * Which onsets may be joined is the Faz 0 contiguity reading, and it is made
 * where that reading already lives (`placement-input.ts`), not here.
 */
export type SlurEdge = {
  /** Index into `PlacementInput.onsets` of the note carrying the slur. */
  targetOnset: number;
  /** The onset it must share a string with: the one still sounding before it. */
  sourceOnset: number;
  /** Which note of each onset, so a chord with one slurred voice works. */
  targetNoteIndex: number;
  sourceNoteIndex: number;
};

/** What the caller must tell the engine about silence, in bar order. */
export type PlacementBar = {
  barNumber: number;
  /**
   * True when nothing is struck and nothing is still sounding through this
   * bar. A bar filled by a tie is not silent; a bar the track is not written
   * in is (spec 5.5).
   */
  silent: boolean;
};

export type PlacementOutcome =
  /** Every note of the onset has a position. */
  | { kind: "placed"; voicing: Voicing }
  /**
   * The written positions stand; the notes named in `unresolved` found no
   * string. A written position is never surrendered to make room (spec 9.2).
   */
  | { kind: "partial"; voicing: Voicing; unresolved: readonly number[] }
  /** Nothing could be placed; `unplaceable` owns it (spec 10.3). */
  | { kind: "unresolved" };

export type PlacementDiagnostics = {
  onsets: number;
  totalCandidateVoicings: number;
  maxCandidateVoicings: number;
  /**
   * The widest the search ever got **before** pruning: how many successor
   * states one onset produced from the whole surviving beam. This is a measure
   * of the work done, and it is bounded by `beamWidth * candidates`, not by
   * `beamWidth`.
   */
  maxExpandedStates: number;
  /**
   * The most states ever **carried forward** after pruning. This is the beam
   * itself, and it can never exceed `placementLimits.beamWidth`.
   */
  maxRetainedBeamStates: number;
  resets: number;
  unresolvedOnsets: number;
  /** Slur edges the caller declared (spec 8.5, 9.2, K-27). */
  slurEdges: number;
  /**
   * Slurs the chosen path could not keep on one string.
   *
   * Never silently zero: when the fretboard genuinely has no way to hold both
   * notes on one string, this is what says so, and the validator's warning
   * and the playback fallback follow from the same fact.
   */
  brokenSlurs: number;
  /** True when any onset hit the enumeration cap. */
  truncated: boolean;
  /** Set when the fretboard is outside the pilot catalogue (spec 19.1). */
  deferredReason?: string;
};

export type PlacementResult = {
  /** Keyed by onset key, so a caller maps straight back to its slots. */
  byOnset: ReadonlyMap<string, PlacementOutcome>;
  diagnostics: PlacementDiagnostics;
};

/**
 * The cost of a path, compared left to right (spec 9.2, K-19).
 *
 * Read down the list: fewer big jumps beats everything; then fewer written
 * slurs made unplayable; then less overshoot past the threshold; then less
 * hand travel; then a narrower chord; then less wandering across the strings;
 * then a lower position on the neck; then less total fretting; and finally the
 * canonical signature, so a tie is broken by the music rather than by
 * whichever branch the loop happened to reach first.
 *
 * Slurs sit *below* large shifts on purpose. Keeping a hammer-on on one
 * string is worth reaching for, but not worth a jump the hand cannot make:
 * a slur that costs a twelve-fret leap has been bought at the price of the
 * passage around it. Above everything else, though, a written articulation
 * should survive placement rather than be silently discarded.
 */
export type PathCost = readonly [
  largeShifts: number,
  brokenSlurs: number,
  shiftExcess: number,
  anchorTravel: number,
  totalSpan: number,
  centerTravel: number,
  totalMaxFret: number,
  totalFretLoad: number,
  signature: string,
];

/** How many numeric terms the cost has before its tie-breaking signature. */
const NUMERIC_TERMS = 8;

export function compareCost(a: PathCost, b: PathCost): number {
  for (let index = 0; index < NUMERIC_TERMS; index += 1) {
    const left = a[index] as number;
    const right = b[index] as number;
    if (left !== right) return left - right;
  }
  const left = a[NUMERIC_TERMS];
  const right = b[NUMERIC_TERMS];
  return left < right ? -1 : left > right ? 1 : 0;
}

type BeamState = {
  cost: PathCost;
  /** Hand position after the last onset, or null at a reset. */
  anchor: number | null;
  center: number | null;
  /** One chosen voicing per onset so far, in onset order. */
  chosen: readonly (Voicing | null)[];
};

function extendSignature(previous: string, voicing: Voicing | null): string {
  return `${previous}/${voicing?.signature ?? "-"}`;
}

/** The string a named note of a voicing ended up on, if it is in there. */
function stringOf(voicing: Voicing | null | undefined, noteIndex: number): number | null {
  const note = voicing?.notes.find((entry) => entry.noteIndex === noteIndex);
  return note?.stringIndex ?? null;
}

/**
 * How many of this onset's slurs this voicing would break.
 *
 * Counted while the path is being built, so the search can weigh a whole
 * chain rather than discovering afterwards that it made one unplayable.
 * A source that could not be placed at all is not counted as broken here —
 * `unplaceable` owns that, and charging twice for it would push the search
 * toward hiding it.
 */
function brokenSlurs(
  state: BeamState,
  voicing: Voicing,
  edges: readonly SlurEdge[],
): number {
  let broken = 0;
  for (const edge of edges) {
    const source = state.chosen[edge.sourceOnset];
    if (!source) continue;
    const from = stringOf(source, edge.sourceNoteIndex);
    const to = stringOf(voicing, edge.targetNoteIndex);
    if (from === null || to === null) continue;
    if (from !== to) broken += 1;
  }
  return broken;
}

function extend(
  state: BeamState,
  voicing: Voicing,
  maxShift: number,
  resetBefore: boolean,
  edges: readonly SlurEdge[],
): BeamState {
  const previousAnchor = resetBefore ? null : state.anchor;
  const previousCenter = resetBefore ? null : state.center;

  // The first onset after a reset has nothing to have moved from, so it costs
  // no travel. What decides it there is the canonical order in `voicing.ts`,
  // which keeps the spirit of the old low-position preference.
  const jumped =
    previousAnchor !== null &&
    isLargeShift(previousAnchor, voicing.anchor, maxShift);
  const excess =
    previousAnchor === null
      ? 0
      : shiftExcess(previousAnchor, voicing.anchor, maxShift);
  const travel =
    previousAnchor === null ? 0 : Math.abs(voicing.anchor - previousAnchor);
  const centerMove =
    previousCenter === null ? 0 : Math.abs(voicing.center - previousCenter);

  return {
    cost: [
      state.cost[0] + (jumped ? 1 : 0),
      state.cost[1] + brokenSlurs(state, voicing, edges),
      state.cost[2] + excess,
      state.cost[3] + travel,
      state.cost[4] + voicing.span,
      state.cost[5] + centerMove,
      state.cost[6] + voicing.maxPhysicalFret,
      state.cost[7] + voicing.totalPhysicalFret,
      extendSignature(state.cost[8], voicing),
    ],
    anchor: voicing.anchor,
    center: voicing.center,
    chosen: [...state.chosen, voicing],
  };
}

/** An onset with no voicing: the path carries on, the hand does not move. */
function skip(state: BeamState, resetBefore: boolean): BeamState {
  return {
    cost: [
      state.cost[0],
      state.cost[1],
      state.cost[2],
      state.cost[3],
      state.cost[4],
      state.cost[5],
      state.cost[6],
      state.cost[7],
      extendSignature(state.cost[8], null),
    ],
    anchor: resetBefore ? null : state.anchor,
    center: resetBefore ? null : state.center,
    chosen: [...state.chosen, null],
  };
}

const EMPTY_STATE: BeamState = {
  cost: [0, 0, 0, 0, 0, 0, 0, 0, ""],
  anchor: null,
  center: null,
  chosen: [],
};

export type PlacementInput = {
  fretboard: Fretboard;
  onsets: readonly PlacementOnset[];
  /** Bars in order, so the engine can see a whole silent bar (spec 9.2). */
  bars: readonly PlacementBar[];
  /** From the instrument family; null means the family has no threshold. */
  maxShift: number;
  /**
   * Notes that must share a string, because one is slurred off the other
   * (spec 8.5, 9.2, K-27). Omitted means the caller has none to declare.
   */
  slurs?: readonly SlurEdge[];
  beamWidth?: number;
};

/**
 * Does the hand get a whole bar to itself between these two onsets?
 *
 * Only a bar with nothing struck **and** nothing sounding counts. A bar filled
 * by a held note is not free — the hand is still on it — and a few slots of
 * rest are not a bar. Section boundaries are not resets on their own: a riff
 * that carries straight over one is still one riff.
 */
function resetBetween(
  bars: readonly PlacementBar[],
  fromBarNumber: number,
  toBarNumber: number,
): boolean {
  for (const bar of bars) {
    if (bar.barNumber <= fromBarNumber) continue;
    if (bar.barNumber >= toBarNumber) break;
    if (bar.silent) return true;
  }
  return false;
}

export function placeTrack(input: PlacementInput): PlacementResult {
  const beamWidth = input.beamWidth ?? placementLimits.beamWidth;

  const diagnostics: PlacementDiagnostics = {
    onsets: input.onsets.length,
    totalCandidateVoicings: 0,
    maxCandidateVoicings: 0,
    maxExpandedStates: 0,
    maxRetainedBeamStates: 0,
    resets: 0,
    unresolvedOnsets: 0,
    slurEdges: 0,
    brokenSlurs: 0,
    truncated: false,
    ...(isBeyondCoreLite(input.fretboard)
      ? {
          deferredReason:
            `${input.fretboard.tuning.length} telli akort pilot kataloğunun ` +
            `dışında; yerleşim aramasında üst sınır uygulanabilir (spec 19.1).`,
        }
      : {}),
  };

  const byOnset = new Map<string, PlacementOutcome>();
  // A backwards edge would mean asking about a voicing that has not been
  // chosen yet, so it could never be honoured; dropping it here keeps the
  // search's one pass honest.
  const slurs = (input.slurs ?? []).filter(
    (edge) => edge.sourceOnset < edge.targetOnset,
  );
  if (input.onsets.length === 0) return { byOnset, diagnostics };

  // Enumerate first, so the search works on a fixed, canonical space.
  const perOnset = input.onsets.map((onset) => {
    const result = candidateVoicings(input.fretboard, onset.notes);
    if (result.kind === "placed" || result.kind === "partial") {
      diagnostics.totalCandidateVoicings += result.voicings.length;
      diagnostics.maxCandidateVoicings = Math.max(
        diagnostics.maxCandidateVoicings,
        result.voicings.length,
      );
      if (result.truncated) diagnostics.truncated = true;
      if (result.kind === "partial") {
        diagnostics.unresolvedOnsets += 1;
        return {
          voicings: result.voicings,
          unresolved: result.unresolved,
        };
      }
      return { voicings: result.voicings, unresolved: [] as readonly number[] };
    }
    if (result.kind === "unplaceable") diagnostics.unresolvedOnsets += 1;
    return { voicings: [] as readonly Voicing[], unresolved: [] as readonly number[] };
  });

  let beam: BeamState[] = [EMPTY_STATE];
  let previousBarNumber: number | null = null;

  input.onsets.forEach((onset, index) => {
    const resetBefore =
      previousBarNumber === null ||
      resetBetween(input.bars, previousBarNumber, onset.barNumber);
    if (resetBefore && previousBarNumber !== null) diagnostics.resets += 1;

    const voicings = perOnset[index]?.voicings ?? [];
    // Only the edges landing on this onset; their sources are already chosen.
    const edgesHere = slurs.filter((edge) => edge.targetOnset === index);
    const next: BeamState[] = [];

    for (const state of beam) {
      if (voicings.length === 0) {
        next.push(skip(state, resetBefore));
        continue;
      }
      for (const voicing of voicings) {
        next.push(extend(state, voicing, input.maxShift, resetBefore, edgesHere));
      }
    }

    // Stable and canonical: equal costs never fall back on insertion order,
    // because the eighth element of the cost is the path's own signature.
    next.sort((a, b) => compareCost(a.cost, b.cost));
    diagnostics.maxExpandedStates = Math.max(
      diagnostics.maxExpandedStates,
      next.length,
    );
    beam = next.slice(0, beamWidth);
    diagnostics.maxRetainedBeamStates = Math.max(
      diagnostics.maxRetainedBeamStates,
      beam.length,
    );
    previousBarNumber = onset.barNumber;
  });

  const best = beam[0];
  if (!best) return { byOnset, diagnostics };

  diagnostics.slurEdges = slurs.length;
  diagnostics.brokenSlurs = best.cost[1];

  input.onsets.forEach((onset, index) => {
    const voicing = best.chosen[index];
    const unresolved = perOnset[index]?.unresolved ?? [];
    if (!voicing) {
      byOnset.set(onset.key, { kind: "unresolved" });
      return;
    }
    byOnset.set(
      onset.key,
      unresolved.length > 0
        ? { kind: "partial", voicing, unresolved }
        : { kind: "placed", voicing },
    );
  });

  return { byOnset, diagnostics };
}

/** The hand notes of a chosen voicing, for anything that measures a hand. */
export function handNotesOf(voicing: Voicing): HandNote[] {
  return voicing.notes.map((note: PlacedNote) => ({
    stringIndex: note.stringIndex,
    physicalFret: note.physicalFret,
  }));
}

export { compareVoicings };

/**
 * The memoryless greedy engine, kept **only as a test baseline** (spec 9.2,
 * K-19).
 *
 * This is what production used before Ergonomic Placement v2. It is no longer
 * reachable from `src/lib` or `src/components` and is not a selectable second
 * behaviour: it lives under `src/test` so the quality comparison has something
 * honest to measure against, and a test asserts that nothing outside the test
 * tree imports it.
 *
 * Original documentation follows.
 *
 * Deterministic greedy position engine.
 *
 * Rules, in order:
 *   1. Consider positions inside the valid capo-relative fret range.
 *   2. A chord uses each string at most once.
 *   3. Choose the lowest maximum physical fret.
 *   4. On a tie, choose the lowest total physical fret.
 *   5. On a tie, decide by the lowest string numbers.
 *
 * Known limit (spec 9.2, K-4): the rule is memoryless. It does not look at the
 * previous note, so it does not minimise string changes or fret jumps. The
 * hand-movement engine is post-pilot.
 *
 * A position the user or the model wrote out always wins over the computed one.
 */
import {
  physicalFret,
  soundingMidi,
  type Fretboard,
  type Position,
} from "@/lib/music/fretboard";
import { candidatePositions } from "@/lib/music/voicing";
import type { NoteEvent } from "@/lib/song/schema";

export { candidatePositions };

export type ResolvedPosition = {
  note: NoteEvent;
  position: Position | null;
  /** Where the position came from; "none" means no playable placement exists. */
  source: "explicit" | "computed" | "none";
};

type Candidate = { index: number; options: Position[] };

/** Rules 3, 4 and 5 as an ordered comparison. Lower is better. */
function compareAssignments(
  a: readonly Position[],
  b: readonly Position[],
  capo: number,
): number {
  const physical = (positions: readonly Position[]) =>
    positions.map((position) => physicalFret(capo, position.fret));

  const aFrets = physical(a);
  const bFrets = physical(b);

  const aMax = Math.max(...aFrets);
  const bMax = Math.max(...bFrets);
  if (aMax !== bMax) return aMax - bMax;

  const aTotal = aFrets.reduce((sum, fret) => sum + fret, 0);
  const bTotal = bFrets.reduce((sum, fret) => sum + fret, 0);
  if (aTotal !== bTotal) return aTotal - bTotal;

  const aStrings = a.map((position) => position.string).sort((x, y) => x - y);
  const bStrings = b.map((position) => position.string).sort((x, y) => x - y);
  for (let index = 0; index < aStrings.length; index += 1) {
    const left = aStrings[index] ?? 0;
    const right = bStrings[index] ?? 0;
    if (left !== right) return left - right;
  }
  return 0;
}

/**
 * Place the notes of one slot on the fretboard.
 *
 * Notes carrying an explicit position keep it and reserve their string; the
 * rest are placed around them. Returns one entry per note, in input order.
 */
export function resolveSlotPositions(
  fretboard: Fretboard,
  notes: readonly NoteEvent[],
): ResolvedPosition[] {
  const resolved: ResolvedPosition[] = notes.map((note) => ({
    note,
    position: note.position ?? null,
    source: note.position ? "explicit" : "none",
  }));

  const reserved = new Set<number>();
  for (const entry of resolved) {
    if (entry.source === "explicit" && entry.position) {
      reserved.add(entry.position.string);
    }
  }

  const pending: Candidate[] = [];
  resolved.forEach((entry, index) => {
    if (entry.source === "explicit") return;
    const options = candidatePositions(fretboard, entry.note.pitch).filter(
      (position) => !reserved.has(position.string),
    );
    pending.push({ index, options });
  });

  if (pending.length === 0) return resolved;

  // Notes with the fewest options first, so impossible branches die early.
  pending.sort((a, b) => a.options.length - b.options.length);

  let best: Position[] | null = null;
  let bestOrder: number[] = [];
  const chosen: Position[] = [];
  const used = new Set<number>(reserved);

  const search = (depth: number) => {
    if (depth === pending.length) {
      if (
        best === null ||
        compareAssignments(chosen, best, fretboard.capo) < 0
      ) {
        best = [...chosen];
        bestOrder = pending.map((candidate) => candidate.index);
      }
      return;
    }
    const candidate = pending[depth];
    if (!candidate) return;
    for (const option of candidate.options) {
      if (used.has(option.string)) continue;
      used.add(option.string);
      chosen.push(option);
      search(depth + 1);
      chosen.pop();
      used.delete(option.string);
    }
  };

  search(0);

  if (best === null) return resolved; // no complete placement exists

  const placement: Position[] = best;
  bestOrder.forEach((noteIndex, slot) => {
    const entry = resolved[noteIndex];
    const position = placement[slot];
    if (!entry || !position) return;
    entry.position = position;
    entry.source = "computed";
  });

  return resolved;
}

/** Convenience wrapper for a single note. */
export function resolveNotePosition(
  fretboard: Fretboard,
  note: NoteEvent,
): ResolvedPosition {
  const [entry] = resolveSlotPositions(fretboard, [note]);
  return entry ?? { note, position: null, source: "none" };
}

/** Sanity helper: what a resolved position actually sounds. */
export function resolvedSoundsAs(
  fretboard: Fretboard,
  resolved: ResolvedPosition,
): number | null {
  return resolved.position ? soundingMidi(fretboard, resolved.position) : null;
}

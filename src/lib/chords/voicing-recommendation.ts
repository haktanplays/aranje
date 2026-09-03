/**
 * Which of the offered shapes to put on the grid first (2W §11).
 *
 * ## The gap this closes, and the one it does not
 *
 * `chordVoicings` already answers "what can be played here" — the fretboard
 * walk, the playability limits and the regional variety selection are all
 * done, and none of it is repeated here. What it does not do is *choose*. It
 * hands back up to four shapes in canonical order and leaves the caller to
 * pick, which is why the chord panel could show a root and a quality with
 * nothing on the grid: nobody had decided.
 *
 * So this module decides, and it is deliberately small. It ranks shapes that
 * are already known to be playable, using facts those shapes already carry.
 * It is **not** the Pro voicing engine: there is no voice leading, no style,
 * no genre, no history of what the reader chose last time, and nothing here
 * knows what key the song is in.
 *
 * ## The four names
 *
 * A reader who does not like the first shape needs a reason to try another
 * one, and "voicing 2 of 4" is not a reason. Each alternative is named for
 * the way it differs — nearest to the hand, easiest to hold, more open
 * strings, deeper bass — and a name is only offered when a shape genuinely
 * earns it. Two names never point at the same shape, and a name with no
 * candidate is simply absent rather than aimed at a duplicate.
 */
import type { ChordVoicing } from "@/lib/chords/chord-voicing";
import type { FrettedVoicing } from "@/lib/chords/fretted-voicing";

export type VoicingAngle = "closest" | "easiest" | "opener" | "deeper";

export const VOICING_ANGLE_LABEL: Readonly<Record<VoicingAngle, string>> = {
  closest: "En yakın",
  easiest: "En kolay",
  opener: "Daha açık",
  deeper: "Daha kalın",
};

export type VoicingChoice = {
  readonly angle: VoicingAngle;
  readonly voicing: ChordVoicing;
};

export type VoicingRecommendation = {
  /** The one already on the grid when the panel opens. */
  readonly recommended: ChordVoicing;
  /** Other shapes worth a tap, each named for how it differs. Never the recommended one. */
  readonly alternatives: readonly VoicingChoice[];
};

const shapeOf = (voicing: ChordVoicing): FrettedVoicing | null =>
  voicing.kind === "fretted" ? voicing.shape : null;

/** How far this shape sits from where the hand already is. */
function distance(voicing: ChordVoicing, anchorFret: number | undefined): number {
  const shape = shapeOf(voicing);
  if (shape === null || anchorFret === undefined) return 0;
  return Math.abs(shape.anchor - anchorFret);
}

/**
 * How much work the hand does: fingers down first, then stretch.
 *
 * Open strings are free, which is why `frettedCount` leads rather than
 * `noteCount` — a six-string chord with two fingers is easier than a
 * three-string chord with three, and a beginner feels that immediately.
 */
function effort(voicing: ChordVoicing): number {
  const shape = shapeOf(voicing);
  if (shape === null) return 0;
  return shape.frettedCount * 10 + shape.span;
}

function openness(voicing: ChordVoicing): number {
  const shape = shapeOf(voicing);
  if (shape === null) return 0;
  return shape.strings.filter(
    (string) => string.kind === "played" && string.fret === 0,
  ).length;
}

function bassMidi(voicing: ChordVoicing): number {
  const shape = shapeOf(voicing);
  if (shape === null) return 0;
  for (const string of shape.strings) {
    if (string.kind === "played") return string.midi;
  }
  return 0;
}

/**
 * Rank the offered shapes and name the useful differences.
 *
 * The recommendation is the shape nearest the hand, and ties go to the
 * easier one — in that order rather than the reverse, because a reader who
 * has just tapped a position is looking at that position, and a shape that
 * appears eight frets away reads as the app ignoring them.
 *
 * `voicings` must already be playable; this never invents or filters a shape.
 */
export function recommendVoicings(
  voicings: readonly ChordVoicing[],
  options: { readonly anchorFret?: number } = {},
): VoicingRecommendation | null {
  if (voicings.length === 0) return null;

  const ranked = [...voicings].sort((left, right) => {
    const near = distance(left, options.anchorFret) - distance(right, options.anchorFret);
    if (near !== 0) return near;
    const work = effort(left) - effort(right);
    if (work !== 0) return work;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  const recommended = ranked[0]!;
  const rest = ranked.slice(1);

  const best = (
    angle: VoicingAngle,
    score: (voicing: ChordVoicing) => number,
    better: (candidate: number, current: number) => boolean,
  ): VoicingChoice | null => {
    let pick: ChordVoicing | null = null;
    for (const voicing of rest) {
      if (pick === null || better(score(voicing), score(pick))) pick = voicing;
    }
    /* An alternative has to be an actual alternative: a shape that scores no
       better than the recommended one is not a different thing to reach for,
       and offering it would be four buttons that do the same. */
    if (pick === null || !better(score(pick), score(recommended))) return null;
    return { angle, voicing: pick };
  };

  const lower = (candidate: number, current: number) => candidate < current;
  const higher = (candidate: number, current: number) => candidate > current;

  const candidates = [
    best("closest", (voicing) => distance(voicing, options.anchorFret), lower),
    best("easiest", effort, lower),
    best("opener", openness, higher),
    best("deeper", (voicing) => -bassMidi(voicing), lower),
  ];

  /* One shape, one name. When two angles land on the same alternative the
     first one wins, so "En kolay" and "Daha açık" never sit side by side
     pointing at the same buttons. */
  const seen = new Set<string>();
  const alternatives: VoicingChoice[] = [];
  for (const choice of candidates) {
    if (choice === null) continue;
    if (seen.has(choice.voicing.id)) continue;
    seen.add(choice.voicing.id);
    alternatives.push(choice);
  }

  return { recommended, alternatives };
}

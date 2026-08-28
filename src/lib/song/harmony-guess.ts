/**
 * What chord a passage is already over (2T-C §7).
 *
 * ## Why guess at all
 *
 * "Keep the rhythm, change the chord" needs to know both chords, and asking a
 * reader to name the one already on the screen is asking them to do the app's
 * homework. So the source is proposed and stays editable: a guess that is
 * usually right and always correctable beats a blank field, and beats a guess
 * that cannot be argued with.
 *
 * ## How the guess is made, and what it will not do
 *
 * Every root and every quality the chord builder knows is scored by how much
 * of the passage it explains: how many of the notes are chord tones, with the
 * bass note breaking ties because a figure over a chord usually starts on it.
 * Nothing is inferred from key signature, section name or what came before —
 * this looks at the notes in front of it and nothing else, so the same
 * passage always produces the same proposal.
 *
 * A passage with no notes gets no guess. Silence is not a chord.
 */
import { CHORD_FORMULAS, CHORD_QUALITY_IDS, ROOT_SHORT_LABELS } from "@/lib/chords/chord-formula";
import type { ChordQualityId } from "@/lib/chords/chord-formula";
import { pitchClass, pitchToMidi } from "@/lib/music/pitch";
import { ticksPerSlot } from "@/lib/music/timing";
import { isMelodicSlotArray, type Song } from "@/lib/song/schema";
import type { Harmony } from "@/lib/song/retune-harmony";

export type HarmonyChoice = {
  /** 0 = C, 1 = C#, … — the chord builder's own numbering. */
  readonly rootPitchClass: number;
  readonly quality: ChordQualityId;
};

export type GuessTarget = {
  readonly sectionId: string;
  readonly barIndex: number;
  readonly trackId: string;
  readonly fromSlot: number;
  /** Exclusive. */
  readonly toSlot: number;
};

/**
 * How much each note counts as evidence.
 *
 * Not every note in a passage is equally a statement about the harmony. A
 * long note on a strong beat is; a sixteenth passing between two of them is
 * decoration, and counting it the same way is how a figure in E minor gets
 * read as C major seventh because it happened to touch a C.
 *
 * So a note's weight is how long it sounds, doubled when it lands on a beat.
 * Both halves are facts already in the score, and neither needs a theory of
 * what a passing note is — which is the theory that would have to be right
 * for a cleverer rule to beat this one.
 */
const ON_BEAT_WEIGHT = 2;

/**
 * What a chord tone has to be worth to be worth claiming.
 *
 * Coverage on its own can never choose the smaller chord: C major seventh
 * explains every note of an E minor figure that touches a C once, because
 * E, G and B are all its tones too. So every tone a chord claims costs it an
 * eighth of the passage, and a tone that carries less than that is not
 * earning its place — it is decoration the chord is taking credit for.
 *
 * An eighth is not arbitrary. Below about a ninth, the extra tone of a
 * seventh chord stops paying for itself and a triad wins; above about a
 * quarter, a real seventh chord starts losing to its own triad. An eighth
 * sits in the middle of that window, and both ends of it are tested.
 */
const TONE_COST = 1 / 8;

type Evidence = { readonly pitch: string; readonly weight: number };

function evidenceIn(song: Song, target: GuessTarget): readonly Evidence[] {
  const bar = song.sections
    .find((entry) => entry.id === target.sectionId)
    ?.bars[target.barIndex];
  const slots = bar?.slots[target.trackId];
  if (!bar || !slots || !isMelodicSlotArray(slots)) return [];

  const step = ticksPerSlot(bar.resolution);
  const beat = ticksPerSlot(4);
  const found: Evidence[] = [];
  for (let index = target.fromSlot; index < target.toSlot; index += 1) {
    const slot = slots[index];
    if (slot === null || slot === undefined || slot === "-") continue;
    const onBeat = (index * step) % beat === 0;
    for (const note of slot.notes) {
      const heard = note.durationTicks ?? step;
      found.push({ pitch: note.pitch, weight: heard * (onBeat ? ON_BEAT_WEIGHT : 1) });
    }
  }
  return found;
}

/** Turn a choice into the harmony the transform speaks. */
export function harmonyOf(choice: HarmonyChoice): Harmony {
  return {
    root: ROOT_SHORT_LABELS[choice.rootPitchClass] ?? "C",
    intervals: CHORD_FORMULAS[choice.quality].intervals,
  };
}

/**
 * The chord that explains the most of this passage, or nothing for silence.
 *
 * Ties go to the chord whose root is the passage's lowest note, then to the
 * simpler quality — a run that a triad and a seventh chord explain equally
 * well is the triad, because the seventh is a claim the notes did not make.
 */
export function guessHarmony(song: Song, target: GuessTarget): HarmonyChoice | null {
  const evidence = evidenceIn(song, target);
  if (evidence.length === 0) return null;

  const weighted = evidence
    .map((entry) => ({ cls: pitchClass(entry.pitch), weight: entry.weight }))
    .filter((entry): entry is { cls: number; weight: number } => entry.cls !== null);
  if (weighted.length === 0) return null;
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);

  const bass = evidence.reduce((lowest, entry) => {
    const a = pitchToMidi(entry.pitch);
    const b = pitchToMidi(lowest.pitch);
    return a !== null && b !== null && a < b ? entry : lowest;
  }, evidence[0]!);
  const bassClass = pitchClass(bass.pitch);

  let best: HarmonyChoice | null = null;
  let bestScore = -1;

  for (let root = 0; root < 12; root += 1) {
    for (const quality of CHORD_QUALITY_IDS) {
      const degrees = new Set(
        CHORD_FORMULAS[quality].intervals.map((interval) => ((interval % 12) + 12) % 12),
      );
      const explained = weighted
        .filter((entry) => degrees.has((entry.cls - root + 12) % 12))
        .reduce((sum, entry) => sum + entry.weight, 0);
      /*
       * How much of the passage this chord accounts for, as a fraction; then
       * the bass, which is where a figure over a chord usually starts; then
       * the smaller chord, because every extra tone is a claim the notes did
       * not make. Each term is scaled so it can only settle what the one
       * before it left tied.
       */
      /*
       * How much of the passage this chord accounts for, less what its tones
       * cost it; then the bass, which is where a figure over a chord usually
       * starts. The bass can only settle what the notes left tied.
       */
      const score =
        (explained / total - degrees.size * TONE_COST) * 10_000 +
        (bassClass === root ? 1 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = { rootPitchClass: root, quality };
      }
    }
  }

  return best;
}

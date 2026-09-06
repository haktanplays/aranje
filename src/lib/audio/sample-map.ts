/**
 * Which recorded sample plays which note, and how fast (spec 8.5).
 *
 * A pack holds a handful of real recordings; everything between them is that
 * recording played faster or slower. This is the arithmetic for that, kept
 * pure so the choice of sample and the pitch it lands on can be checked
 * without an audio context — and so the expressive voice and the sampler agree
 * about which recording a note comes from.
 */
import { CENTS_PER_SEMITONE } from "@/lib/audio/expression";
import { pitchToMidi } from "@/lib/music/pitch";

export type SampleEntry = { note: string; midi: number };

/** The pack's notes, as midi numbers, lowest first. Unreadable names drop out. */
export function sampleEntries(noteNames: readonly string[]): SampleEntry[] {
  return noteNames
    .map((note) => ({ note, midi: pitchToMidi(note) }))
    .filter((entry): entry is SampleEntry => entry.midi !== null)
    .sort((a, b) => a.midi - b.midi);
}

/**
 * The recording a note sounds from — the shared sampler's choice, reported.
 *
 * ## Why the tie goes up
 *
 * This is not a free decision. A note without an articulation is played by
 * the track's shared `Tone.Sampler`, which picks its own recording and cannot
 * be told which one to use; a note that carries one is played by an
 * expressive voice, which reads this function. So whatever this returns for a
 * pitch **must** be what the sampler would have played for it, or the same
 * written note comes from a different recording — a different attack, a
 * different stretch and a different timbre — depending on whether it happens
 * to carry an accent.
 *
 * The sampler searches outwards from the wanted pitch and looks *above* it
 * first, so on a tie it plays the higher recording slowed down. This does the
 * same. The earlier rule here preferred the lower one — a defensible
 * preference in isolation, and one that made the two paths disagree on every
 * pitch exactly between two recordings. On this app's guitar pack that is D3
 * and D4, and D3 is the pitch the L31 listening card was written on
 * (2V-D.2 gain parity §4).
 *
 * The sampler is the authority rather than the other way round because the
 * plain path is the one the founder has already passed by ear (L1), and a
 * fix that moved *it* would be re-levelling audio that has a recorded
 * verdict.
 */
export function nearestSample(
  entries: readonly SampleEntry[],
  midi: number,
): SampleEntry | null {
  let best: SampleEntry | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const entry of entries) {
    const distance = Math.abs(entry.midi - midi);
    // Stated rather than left to the order the entries arrive in: an equally
    // close recording only wins if it is the higher one.
    const closer = distance < bestDistance;
    const higherOnATie = distance === bestDistance && entry.midi > (best?.midi ?? -Infinity);
    if (closer || higherOnATie) {
      best = entry;
      bestDistance = distance;
    }
  }

  return best;
}

/**
 * How fast to play a recording so it sounds at the wanted pitch, with an
 * optional deviation in cents on top.
 *
 * This is the only place pitch becomes speed. The deviation is what bend,
 * slide and vibrato move; the written pitch itself never changes.
 */
export function playbackRateFor(
  sampleMidi: number,
  targetMidi: number,
  cents = 0,
): number {
  const semitones = targetMidi - sampleMidi + cents / CENTS_PER_SEMITONE;
  return Math.pow(2, semitones / 12);
}

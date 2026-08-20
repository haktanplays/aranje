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
 * The closest recording to a wanted pitch.
 *
 * A tie goes to the **lower** sample, so a note between two recordings is
 * played up rather than down: stretching a sample upwards keeps more of its
 * attack than slowing it down does.
 */
export function nearestSample(
  entries: readonly SampleEntry[],
  midi: number,
): SampleEntry | null {
  let best: SampleEntry | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const entry of entries) {
    const distance = Math.abs(entry.midi - midi);
    if (distance < bestDistance) {
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

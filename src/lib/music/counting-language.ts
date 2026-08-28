/**
 * Three different questions, said as three different sentences (2T-C §2).
 *
 * The founder read "4/4", "132" and "1/16" off one screen and could not tell
 * what any of them was for — and that is the app's fault, not theirs. They
 * answer three unrelated questions:
 *
 * - **Ölçü** is the bar's shape: how many beats it holds and what a beat is.
 * - **Tempo** is how fast those beats go past.
 * - **Izgara** is how finely one beat is divided for writing.
 *
 * Changing any one of them leaves the other two alone, and this module exists
 * so the words on screen say so. Each line is a full sentence with its own
 * label; a bare number never appears without one.
 *
 * The technical name is kept — a reader who already knows "1/16" should not
 * have to relearn it, and a reader looking it up needs something to look up —
 * but it is the accessible description, not the headline.
 */
import { readGrid } from "@/lib/music/rhythm-language";
import {
  formatTimeSignature,
  resolutionLabel,
  type Resolution,
  type TimeSignature,
} from "@/lib/music/timing";

export type CountingLine = {
  /** "Izgara: 16'lık" — what is drawn. */
  readonly text: string;
  /** "Her vuruşta 4 adım" — the sentence under it, or null. */
  readonly helper: string | null;
  /** "1/16" — kept for the accessible description, never shown alone. */
  readonly technical: string;
};

/** "Ölçü: 4/4" — the bar's shape. */
export function meterLine(timeSignature: TimeSignature): CountingLine {
  const [count, unit] = timeSignature;
  const beat =
    unit === 4 ? "dörtlük" : unit === 8 ? "sekizlik" : unit === 2 ? "ikilik" : `1/${unit}`;
  return {
    text: `Ölçü: ${formatTimeSignature(timeSignature)}`,
    helper: `Her ölçüde ${count} ${beat}`,
    technical: formatTimeSignature(timeSignature),
  };
}

/** "Tempo: 132 BPM" — how fast the beat goes. */
export function tempoLine(bpm: number): CountingLine {
  return {
    text: `Tempo: ${bpm} BPM`,
    helper: "Dakikadaki vuruş sayısı",
    technical: `${bpm} BPM`,
  };
}

/**
 * "Izgara: 16'lık" with "Her vuruşta 4 adım" under it.
 *
 * A triplet grid says how many *equal* steps, because "3 adım" next to
 * "4 adım" would read as the same kind of division and it is not.
 */
export function gridLine(
  timeSignature: TimeSignature,
  resolution: Resolution,
): CountingLine {
  const reading = readGrid(timeSignature, resolution);
  const triplet = resolution === 12 || resolution === 24;
  /* After a label it is the start of a name, so it starts like one. The
     shared vocabulary stays lowercase for the places it sits mid-sentence. */
  const name = reading.name.charAt(0).toLocaleUpperCase("tr") + reading.name.slice(1);
  return {
    text: `Izgara: ${name}`,
    helper: triplet
      ? `Her vuruşta ${reading.stepsPerBeat} eşit adım`
      : `Her vuruşta ${reading.stepsPerBeat} adım`,
    technical: resolutionLabel(resolution),
  };
}

/** All three, for one accessible description that says everything once. */
export function countingDescription(
  timeSignature: TimeSignature,
  bpm: number,
  resolution: Resolution,
): string {
  const lines = [meterLine(timeSignature), tempoLine(bpm), gridLine(timeSignature, resolution)];
  return lines
    .map((line) => `${line.text}${line.helper === null ? "" : ` — ${line.helper}`}`)
    .join(". ");
}

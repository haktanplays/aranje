/**
 * Staff geometry for fretted tracks.
 *
 * The Song Contract stores strings thickest first, so `stringIndex` 0 is the
 * thickest string (spec 9.1). Standard tablature draws the opposite way round:
 * the thinnest string sits on the top line. That is a render concern only, so
 * the mapping lives here and the data model, the tuning array, the string
 * indices and the capo-relative semantics all stay as they are.
 */
import { pitchToMidi } from "@/lib/music/pitch";

/** Screen row for a string index, counted from the top line down. */
export function visualRow(stringCount: number, stringIndex: number): number {
  return stringCount - 1 - stringIndex;
}

/** Vertical offset of a string's row, in pixels from the top of the staff. */
export function rowOffset(
  stringCount: number,
  stringIndex: number,
  rowHeight: number,
): number {
  return visualRow(stringCount, stringIndex) * rowHeight;
}

/**
 * String labels in the order they appear on screen, top line first.
 *
 * A letter that occurs on more than one string is written lowercase on the
 * higher-sounding ones, which is how tab tells the two E strings of a guitar
 * apart. A bass, whose four strings all differ, stays uppercase.
 */
export function frettedRowLabels(tuning: readonly string[]): string[] {
  const midi = tuning.map((pitch) => pitchToMidi(pitch));
  const letters = tuning.map((pitch) => pitch.charAt(0));

  const labels = tuning.map((_, index) => {
    const letter = letters[index] ?? "";
    const own = midi[index];
    const sharesLetterWithLower = tuning.some((__, other) => {
      if (other === index) return false;
      if (letters[other] !== letter) return false;
      const theirs = midi[other];
      if (own === null || own === undefined) return false;
      if (theirs === null || theirs === undefined) return false;
      return theirs < own;
    });
    return sharesLetterWithLower ? letter.toLowerCase() : letter.toUpperCase();
  });

  // Thinnest string first, matching the top line of the staff.
  return labels.reverse();
}

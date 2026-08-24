/**
 * What a shape is called on screen (spec 13.22 §9, §18, 2O-B).
 *
 * Every label here describes **where a shape sits** or **which note is
 * underneath it**. None of them says how good, how easy or how suitable it is,
 * and there is deliberately no vocabulary in this file for doing so: no
 * "recommended", no "beginner", no star, no order-of-preference wording. The
 * app offers possibilities; the musician chooses.
 */
import {
  CHORD_FORMULAS,
  chordPitchClasses,
  normalizePitchClass,
  type ChordQualityId,
} from "@/lib/chords/chord-formula";
import type { ChordVoicing } from "@/lib/chords/chord-voicing";
import type { FrettedVoicing } from "@/lib/chords/fretted-voicing";

/** Where on the neck a shape sits. */
export function positionLabel(shape: FrettedVoicing): string {
  if (shape.hasOpenString && shape.anchor <= 2) return "Açık konum";
  if (shape.anchor === 0) return "Açık konum";
  return `${shape.anchor}. perde çevresi`;
}

/**
 * Which tone of the chord is lowest, named as a musician would say it.
 *
 * The interval decides the word, so a sus4 says "4. basta" rather than
 * borrowing the third it does not have.
 */
export function bassLabel(
  shape: FrettedVoicing,
  rootPitchClass: number,
  quality: ChordQualityId,
): string {
  const root = normalizePitchClass(rootPitchClass);
  const interval = normalizePitchClass(shape.bassPitchClass - root);
  switch (interval) {
    case 0:
      return "kök basta";
    case 2:
      return "2. basta";
    case 3:
    case 4:
      return "3. basta";
    case 5:
      return "4. basta";
    case 6:
    case 7:
    case 8:
      return "5. basta";
    case 10:
    case 11:
      return "7. basta";
    default: {
      // A tone the formula does not name: say nothing rather than invent one.
      void chordPitchClasses(root, quality);
      return "";
    }
  }
}

/** "Açık konum · kök basta" — position first, then what is underneath. */
export function frettedLabel(
  shape: FrettedVoicing,
  rootPitchClass: number,
  quality: ChordQualityId,
): string {
  const bass = bassLabel(shape, rootPitchClass, quality);
  return bass === "" ? positionLabel(shape) : `${positionLabel(shape)} · ${bass}`;
}

/** "Kök pozisyonu", "1. çevrim" — the plain names for a stack of pitches. */
export function inversionLabel(inversion: number): string {
  return inversion === 0 ? "Kök pozisyonu" : `${inversion}. çevrim`;
}

/** The one description a voicing card shows, whichever kind it is. */
export function voicingLabel(
  voicing: ChordVoicing,
  rootPitchClass: number,
  quality: ChordQualityId,
): string {
  return voicing.kind === "fretted"
    ? frettedLabel(voicing.shape, rootPitchClass, quality)
    : inversionLabel(voicing.stack.inversion);
}

/**
 * The shape as a musician writes it down: one entry per string, thickest
 * first, "x" for a string that does not sound.
 *
 * The numbers are capo-relative, exactly what goes into the Song, so what the
 * card shows and what is written cannot disagree.
 */
export function shapeDigits(shape: FrettedVoicing): string[] {
  return shape.strings.map((entry) =>
    entry.kind === "muted" ? "x" : String(entry.fret),
  );
}

/** "Capo 2 · yazılan perdeler capoya göre", or nothing when there is no capo. */
export function capoNote(capo: number): string | null {
  return capo > 0 ? `Capo ${capo} · yazılan perdeler capoya göre` : null;
}

/** "C4 · E4 · G4 · B4" — what a keyboard card shows instead of frets. */
export function stackNote(voicing: ChordVoicing): string {
  return voicing.kind === "keyboard" ? voicing.stack.pitches.join(" · ") : "";
}

/** The reader-facing name of a quality, from the one table. */
export function qualityLabel(quality: ChordQualityId): string {
  return CHORD_FORMULAS[quality].label;
}

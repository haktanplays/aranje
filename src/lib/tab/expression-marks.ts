/**
 * One page for five axes (2V-D.1-C §11).
 *
 * A note can now say four independent things about how it is played — the
 * legacy `articulation`, an `attack`, a `picking` direction, and whatever
 * technique span lies over it — and until this module they reached the page
 * by four different routes. The legacy enum was printed, the new `attack`
 * was not printed at all, a span-held palm mute drew no rail because the
 * rail read the enum, and picking had nowhere to appear. A reader who wrote
 * an accent the new way saw nothing on the page and heard it in the speakers,
 * which is the same defect as writing it down and hearing nothing.
 *
 * So the whole vocabulary is named here, once, and every surface asks this
 * rather than the raw fields. What a mark *means* still comes from
 * `expression-resolver`; this decides only how it is written down.
 *
 * ## Where each mark goes, and why it is not a free choice
 *
 * - **On the digit.** A ghost note is its fret in round brackets, a dead note
 *   is `x`, a natural harmonic is its fret in angle brackets. Tablature has
 *   written them that way for decades; inventing a private mark would make
 *   this app's tab unreadable to anyone who learned from anyone else's.
 * - **Beside the digit.** Accent, tapping and pinch harmonic, and the two
 *   picking strokes. Characters rather than colours, so a photocopy still
 *   carries them.
 * - **On a rail above the string.** Palm mute and let ring, because both are
 *   a hand position held over a *range* rather than a property of one note.
 *   Writing `PM` over every note of a muted passage is what the rail replaced.
 *
 * ## Picking is drawn and disclosed, not played
 *
 * The sample bank holds one recording per pitch, so a down-stroke and an
 * up-stroke reach the speakers identically. The mark is honest notation for
 * something the reader can act on with their own hand; nothing here claims
 * it changes the sound, and `AXIS_CAPABILITY` says so in the model.
 */
import type { NoteAttack, PickingDirection } from "@/lib/song/schema";

/** Where a mark is written. */
export type MarkPlace = "on_digit" | "beside" | "rail";

export type ExpressionMark = {
  readonly id: string;
  /** The character on the page. Empty for marks drawn as geometry. */
  readonly glyph: string;
  /** What a screen reader says, in Turkish. Never an identifier. */
  readonly spoken: string;
  readonly place: MarkPlace;
};

/**
 * Every mark the tab can write for the attack, picking and technique axes.
 *
 * A list rather than a set of scattered conditionals, so "which of these is
 * drawn" is a question with one answer and a test can walk all of them.
 */
export const EXPRESSION_MARKS: readonly ExpressionMark[] = [
  { id: "accent", glyph: ">", spoken: "vurgulu", place: "beside" },
  { id: "ghost", glyph: "( )", spoken: "hayalet nota", place: "on_digit" },
  { id: "dead", glyph: "x", spoken: "ölü nota", place: "on_digit" },
  { id: "tapping", glyph: "T", spoken: "tapping", place: "beside" },
  { id: "natural_harmonic", glyph: "< >", spoken: "doğal armonik", place: "on_digit" },
  { id: "pinch_harmonic", glyph: "PH", spoken: "çimdik armonik", place: "beside" },
  { id: "picking_down", glyph: "⊓", spoken: "aşağı vuruş", place: "beside" },
  { id: "picking_up", glyph: "V", spoken: "yukarı vuruş", place: "beside" },
  { id: "palm_mute", glyph: "PM", spoken: "avuç susturma", place: "rail" },
  { id: "let_ring", glyph: "L.R.", spoken: "çınlamaya bırak", place: "rail" },
];

const BY_ID = new Map(EXPRESSION_MARKS.map((mark) => [mark.id, mark]));

/** The mark with this id, or null. */
export function markById(id: string): ExpressionMark | null {
  return BY_ID.get(id) ?? null;
}

/**
 * The three attacks that change the printed number rather than sit beside it.
 *
 * Kept as a set so `printedFret` and the beside-mark table cannot disagree
 * about which is which — a note printed `(5)` *and* marked with a bracket
 * beside it would be the same fact written twice.
 */
const ON_DIGIT: ReadonlySet<NoteAttack> = new Set<NoteAttack>([
  "ghost",
  "dead",
  "natural_harmonic",
]);

/**
 * What is printed for a fret under this attack.
 *
 * `null` fret is a note with no playable placement and stays `?`; a dead note
 * has no pitch worth printing at all.
 */
export function printedFret(fret: number | null, attack?: NoteAttack | null): string {
  if (attack === "dead") return "x";
  if (fret === null) return "?";
  if (attack === "ghost") return `(${fret})`;
  if (attack === "natural_harmonic") return `<${fret}>`;
  return String(fret);
}

/** The mark beside the digit for this attack, or null when it is on the digit. */
export function attackMark(attack?: NoteAttack | null): ExpressionMark | null {
  if (!attack || ON_DIGIT.has(attack)) return null;
  return markById(attack);
}

export function pickingMark(direction?: PickingDirection | null): ExpressionMark | null {
  if (!direction) return null;
  return markById(`picking_${direction}`);
}

/** The rail mark for a technique held over a range. */
export function techniqueMark(kind: "palm_mute" | "let_ring"): ExpressionMark {
  return markById(kind)!;
}

export type MarkedNote = {
  /** What replaces the plain fret number. */
  readonly printed: string;
  /** In writing order, left to right, after the digit. */
  readonly beside: readonly ExpressionMark[];
  /** Rails this note sits under, in a stable order. */
  readonly rails: readonly ("palm_mute" | "let_ring")[];
};

/**
 * Everything the page writes about one note's attack, picking and techniques.
 *
 * Takes the *resolved* values rather than a note: the resolver is the single
 * authority on what a note's axes say, and a drawing that read the raw fields
 * would be a second opinion about music the speakers had already refused.
 */
export function markedNote(input: {
  readonly fret: number | null;
  readonly attack?: NoteAttack | null;
  readonly picking?: PickingDirection | null;
  readonly techniques?: readonly ("palm_mute" | "let_ring")[];
}): MarkedNote {
  const beside: ExpressionMark[] = [];
  const struck = attackMark(input.attack);
  if (struck) beside.push(struck);
  const picked = pickingMark(input.picking);
  if (picked) beside.push(picked);

  /* Sorted rather than taken in the order the resolver happened to find
     them, so the same music draws the same page twice. */
  const rails = [...new Set(input.techniques ?? [])].sort();

  return { printed: printedFret(input.fret, input.attack), beside, rails };
}

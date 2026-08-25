/**
 * What a fret number on the tab *is*, before anything draws it (2S-A §4).
 *
 * The tab's numbers had come to read as cards: each digit sat on a filled
 * rectangle of the page colour with three pixels of padding either side, so
 * the string line stopped at the edge of a box rather than at the number
 * (measured: `13,23 × 12 px`, background `rgb(16, 17, 20)` —
 * `eval/intent-composer/FINDINGS.md` §B). A tab is not a grid of chips; it is
 * six lines with numbers written *on* them, and the line should be interrupted
 * by the number itself.
 *
 * So the interruption is modelled here, separately from the digit:
 *
 * - the **digit** has no padding, no border, no radius and no shadow;
 * - the **gap** in the string is its own measurement, a little wider than the
 *   digit, so the line stops just short of the number on both sides;
 * - the gap grows with the number of digits, because `12` needs more room than
 *   `7` and a fixed gap is what made a one-digit fret look boxed.
 *
 * Nothing here knows about React or about pixels the view owns; it takes the
 * font's own advance width and gives back numbers.
 */
import type { Articulation } from "@/lib/song/schema";

/**
 * How the reader is meant to understand this number right now (2S-A §4).
 *
 * Seven states, and each one is told by **shape** as well as by colour: an
 * underline, a dotted outline, a caret. A selection that is only a hue is
 * invisible to a reader who cannot separate those two hues, and it is
 * invisible to anybody at all in bright sunlight.
 */
export type GlyphState =
  /** Written, and nothing is happening to it. */
  | "normal"
  /** Part of the current selection. */
  | "selected"
  /** A preview of what a command *would* write. Not in the song yet. */
  | "ghost"
  /** The onset the playhead is on. */
  | "playing"
  /** A continuation of the note before it, not a new attack. */
  | "tie"
  /** An endpoint of a hammer-on or a pull-off. */
  | "legato"
  /** A staged operation that was refused; the song is unchanged. */
  | "rejected";

/**
 * The mark that carries the state without relying on colour.
 *
 * `none` is the ordinary number. Everything else is a shape the eye can find
 * in a photocopy.
 */
export type GlyphMarker =
  | "none"
  /** A solid rule under the digit. */
  | "underline"
  /** A dotted outline around the digit's own box. */
  | "dotted"
  /** A small filled triangle above the digit. */
  | "caret"
  /** A short horizontal tie mark before the digit. */
  | "tie"
  /** A struck-through digit: the operation was refused. */
  | "struck";

export type FretGlyph = {
  /** What is printed. `0` is an open string; `?` is a note with no placement. */
  readonly text: string;
  readonly digits: number;
  readonly state: GlyphState;
  readonly marker: GlyphMarker;
  /** How wide the string line is interrupted, in px. */
  readonly maskWidth: number;
  /** The digit's own width at this font, in px. No padding is included. */
  readonly textWidth: number;
  /** Reads as music, in Turkish. Never an identifier, a tick or a slot. */
  readonly label: string;
  /** True when the state is carried by more than a colour. */
  readonly hasShapeCue: boolean;
};

/**
 * The advance width of one monospaced digit at the tab's own size.
 *
 * Measured from the shipped stack (`ui-monospace` at `12px`) rather than
 * guessed, and kept here so the mask and the view cannot drift apart.
 */
export const DIGIT_ADVANCE_PX = 7.23;

/** How far past the digits the string stops, on each side. */
export const MASK_BLEED_PX = 2;

/** The smallest gap worth cutting: below this the line reads as unbroken. */
export const MIN_MASK_PX = 8;

const MARKERS: Readonly<Record<GlyphState, GlyphMarker>> = {
  normal: "none",
  selected: "underline",
  ghost: "dotted",
  playing: "caret",
  tie: "tie",
  legato: "underline",
  rejected: "struck",
};

/** What is printed for a fret, including the note that has no placement. */
export function glyphText(fret: number | null): string {
  if (fret === null) return "?";
  return String(fret);
}

/**
 * The gap the string leaves for this number.
 *
 * Two digits get a wider gap than one, which is the whole reason this is a
 * function: a fixed three pixels either side is what made `7` look like a
 * chip and `12` look cramped.
 */
export function maskWidthFor(text: string, advance = DIGIT_ADVANCE_PX): number {
  const width = text.length * advance;
  return Math.max(MIN_MASK_PX, width + MASK_BLEED_PX * 2);
}

/**
 * How a fret is said out loud, in Turkish, as music (2S-A §4).
 *
 * `hammer_on` and `pull_off` are identifiers and never reach a reader; what
 * reaches them is what a guitarist would say. A note with no playable
 * placement says so rather than reading "soru işareti".
 */
export function fretLabel(fret: number | null): string {
  if (fret === null) return "Bu nota bu akortta çalınamıyor";
  if (fret === 0) return "Boş tel";
  return `${fret}. perde`;
}

/** "8. perdeden 7. perdeye pull-off" — the movement, not the enum. */
export function legatoLabel(
  from: number | null,
  to: number | null,
  kind: "hammer_on" | "pull_off",
): string {
  const move = kind === "hammer_on" ? "çekiç" : "koparma";
  if (from === null || to === null) return move === "çekiç" ? "Çekiç" : "Koparma";
  return `${from}. perdeden ${to}. perdeye ${move}`;
}

export type GlyphRequest = {
  readonly fret: number | null;
  readonly state: GlyphState;
  readonly articulation?: Articulation;
  /** The fret this note is slurred from, when it is a legato endpoint. */
  readonly slurredFrom?: number | null;
  readonly advance?: number;
};

/**
 * The whole of what a view needs to draw one fret number.
 *
 * A component that has this does not decide anything: it places the digit, it
 * places the mask, it draws the marker the state asked for, and it hands the
 * label to the accessibility tree.
 */
export function buildFretGlyph(request: GlyphRequest): FretGlyph {
  const text = glyphText(request.fret);
  const advance = request.advance ?? DIGIT_ADVANCE_PX;
  const marker = MARKERS[request.state];
  const base = fretLabel(request.fret);
  const label =
    (request.articulation === "hammer_on" || request.articulation === "pull_off") &&
    request.slurredFrom !== undefined
      ? `${base}, ${legatoLabel(request.slurredFrom, request.fret, request.articulation)}`
      : base;

  return {
    text,
    digits: text.length,
    state: request.state,
    marker,
    maskWidth: maskWidthFor(text, advance),
    textWidth: text.length * advance,
    label,
    hasShapeCue: marker !== "none",
  };
}

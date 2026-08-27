/**
 * What a fret number's state is *after* the technique layer has drawn (K-59).
 *
 * Two things had come to say the same sentence. The technique layer draws an
 * uninterrupted hammer-on/pull-off run as one arc with an `H` or a `P` at each
 * transition; the glyph model, since 2S-A §4, also put an underline under every
 * note of that run. Four underlines in a row under a slur read closer to a
 * selection than to a legato phrase — the underline is the *selected* state's
 * shape too — and the reader was being told twice.
 *
 * So the underline becomes the fallback rather than a second notation. A note
 * the geometry really drew an arc over needs no other cue; a note whose
 * articulation could not be honoured — a hammer-on with nothing before it on
 * the string, a pair whose sounding pitch moves the wrong way — keeps both its
 * underline and the small character beside the number, because a written
 * articulation the tab cannot draw must never become an invisible one.
 *
 * Nothing here reads or writes the Song. `underArc` is a fact about what was
 * drawn, and the caller gets it from the primitives the technique layer was
 * handed — so the suppression cannot drift away from the drawing.
 */
import type { GlyphState } from "@/lib/tab/glyph-model";
import {
  techniqueNoteKey,
  type TechniquePrimitives,
} from "@/lib/tab/technique-geometry";
import type { Articulation } from "@/lib/song/schema";

/**
 * `string:slot` for every onset a **legato arc** really covers.
 *
 * Narrower than `annotated` on purpose: a slide, a bend, a vibrato and a palm
 * mute are annotated too, and a rule about slurs may not reach any of them.
 */
export function legatoNotes(
  primitives: TechniquePrimitives,
): ReadonlySet<string> {
  const notes = new Set<string>();
  for (const phrase of primitives.legato) {
    for (const slot of phrase.slots) {
      notes.add(techniqueNoteKey(phrase.stringIndex, slot));
    }
  }
  return notes;
}

export type GlyphStateRequest = {
  readonly articulation?: Articulation;
  /** Part of the current selection, which outranks every other state. */
  readonly selected: boolean;
  /** True when a drawn legato arc already covers this onset. */
  readonly underArc: boolean;
};

/**
 * The state one fret number is drawn in.
 *
 * `playing`, `ghost`, `tie` and `rejected` are not decided here: they belong
 * to the transport, to a staged command and to the timeline, none of which is
 * a question about technique notation.
 */
export function glyphStateFor(request: GlyphStateRequest): GlyphState {
  if (request.selected) return "selected";
  const slurred =
    request.articulation === "hammer_on" || request.articulation === "pull_off";
  if (slurred && !request.underArc) return "legato";
  return "normal";
}

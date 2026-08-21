/**
 * When two bars are the same bar (spec 13.10, K-40).
 *
 * The arrangement can tell a reader "this bar is the one you already read",
 * and that sentence has to be true in the strong sense: the two bars produce
 * *identical music*. Nothing here guesses, resembles, or scores. There is no
 * motif matching, no interval analysis, no "this riff is a variation of that
 * one" — those are claims about musical meaning, and a structural overview is
 * not the place to make them (and this pilot has no basis for them at all).
 *
 * ## What counts
 *
 * Everything that reaches the ear or the hand:
 *
 * - the grid and the meter the bar is written on
 * - the onset / rest / tie structure, slot by slot
 * - the pitches, or the drum pieces
 * - velocity and articulation
 * - the explicit fret position, when the song wrote one
 *
 * ## What does not
 *
 * Anything about *where* the bar is or *what it is called*: section id,
 * section name, bar index, bar number, track id. A chorus repeated verbatim in
 * two different sections is a repeat; the same bar renamed is not a different
 * bar. Letting identity in would make the answer depend on the question.
 *
 * ## Two deliberate normalisations
 *
 * **Notes in a slot are sorted.** Every note in one slot starts together, so
 * the order they happen to be written in changes nothing anyone can hear.
 * Sorting is canonicalisation, not approximation: it does not make two
 * *different* bars equal, it stops one bar from being unequal to itself
 * rewritten.
 *
 * **An absent field is not a default.** `velocity: undefined` digests as
 * `null`, never as the number the player would fall back to. The two are
 * different writings, and this file's job is to compare writings; guessing
 * that they would sound alike is exactly the kind of inference it refuses to
 * make elsewhere.
 *
 * ## Not a fingerprint
 *
 * This is unrelated to the Copilot request fingerprint and to the idempotency
 * key. Those identify a *request* and must change when anything about the ask
 * changes; this identifies the *content of one bar on one track*. They are
 * never interchangeable and neither may be computed from the other.
 */
import {
  isDrumSlotArray,
  type Bar,
  type DrumSlot,
  type MelodicSlot,
} from "@/lib/song/schema";

/** A stable, order-free rendering of one slot's melodic content. */
function melodicSlotDigest(slot: MelodicSlot): string {
  if (slot === null) return "r";
  if (slot === "-") return "t";

  const notes = slot.notes
    .map((note) => {
      const position = note.position
        ? `${note.position.string}/${note.position.fret}`
        : "-";
      return [
        note.pitch,
        note.velocity ?? "null",
        note.articulation ?? "null",
        position,
      ].join(",");
    })
    .sort();
  return `n(${notes.join("|")})`;
}

/** The same, for a drum slot. An empty array is a rest. */
function drumSlotDigest(slot: DrumSlot): string {
  if (slot.length === 0) return "r";
  const hits = slot
    .map((hit) =>
      [hit.piece, hit.velocity ?? "null", hit.articulation ?? "null"].join(","),
    )
    .sort();
  return `d(${hits.join("|")})`;
}

/** True when this bar writes no sound at all for this track. */
export function isSilentCell(bar: Bar, trackId: string): boolean {
  const slots = bar.slots[trackId];
  // A missing key is silence, not an empty bar someone forgot to fill in
  // (spec 5.5). The two are the same thing to a listener and to this file.
  if (slots === undefined) return true;
  if (slots.length === 0) return true;

  if (isDrumSlotArray(slots)) {
    return slots.every((slot) => slot.length === 0);
  }
  /*
   * A bar of nothing but ties is *not* silent — it is the tail of a note
   * struck earlier, and marking it silent would erase a sound the reader can
   * hear. It has no onset of its own, which is a different statement and one
   * the cell summary makes separately.
   */
  return slots.every((slot) => slot === null);
}

/**
 * A string that is equal for two bars exactly when they are the same music.
 *
 * `null` for a silent cell. Silence is not a repeat of silence: telling a
 * reader that bar 12's emptiness is "the same as bar 4" says nothing and
 * clutters every quiet stretch of the song, so a silent cell is left to say
 * "Sessiz" and nothing more.
 */
export function barDigest(bar: Bar, trackId: string): string | null {
  if (isSilentCell(bar, trackId)) return null;

  const slots = bar.slots[trackId];
  if (slots === undefined) return null;

  const body = isDrumSlotArray(slots)
    ? slots.map(drumSlotDigest)
    : slots.map(melodicSlotDigest);

  return [
    `${bar.timeSignature[0]}/${bar.timeSignature[1]}`,
    `1/${bar.resolution}`,
    body.join(";"),
  ].join(" ");
}

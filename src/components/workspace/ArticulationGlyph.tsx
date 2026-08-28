import { articulationLabel } from "@/lib/validators";
import type { Articulation } from "@/lib/song/schema";

/**
 * The small mark beside a fret number (spec 13.9).
 *
 * It sits to the right of the digits, on the same row as the string it belongs
 * to, so a chord with two different articulations reads correctly line by
 * line. It never covers the number and never sits on the string line where a
 * tie is drawn.
 *
 * The mark is a **character**, not a colour: someone who cannot tell the
 * bronze from the grey still sees `~` or `b1`. Screen readers get the full
 * name rather than the symbol.
 */
const MARKS: Readonly<Record<string, string>> = {
  accent: ">",
  palm_mute: "PM",
  vibrato: "~",
  bend_half: "b½",
  bend_full: "b1",
  hammer_on: "h",
  pull_off: "p",
  /*
   * 2T-C §9. Four more marks beside the digit.
   *
   * `tapping` and `pinch_harmonic` are the two new techniques a tab writes
   * beside the number; the other three added with them — ghost, dead and
   * natural harmonic — are written *on* the number instead, the way
   * tablature writes them, so they are absent here on purpose.
   *
   * `staccato` and `sustain` are older than all of them and had no mark at
   * all: a reader who shortened a note saw the length change when it played
   * and nothing at all on the page. The dot and the tenuto bar are the marks
   * notation already uses for exactly these two, so nothing new is invented.
   */
  tapping: "T",
  pinch_harmonic: "PH",
  staccato: ".",
  sustain: "–",
};

/** Slide leans the way the music goes; everything else has one shape. */
export function articulationMark(
  articulation: Articulation,
  rising?: boolean,
): string | null {
  if (articulation === "slide") return rising === false ? "\\" : "/";
  return MARKS[articulation] ?? null;
}

export function ArticulationGlyph({
  articulation,
  rising,
}: {
  articulation: Articulation;
  rising?: boolean;
}) {
  const mark = articulationMark(articulation, rising);
  if (!mark) return null;

  return (
    <span className="text-bronze ml-px font-mono text-[9px] leading-none">
      <span aria-hidden>{mark}</span>
      <span className="sr-only"> {articulationLabel(articulation)}</span>
    </span>
  );
}

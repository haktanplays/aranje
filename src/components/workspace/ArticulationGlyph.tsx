import { articulationLabel } from "@/lib/validators";
import { resolveExpression } from "@/lib/music/expression-resolver";
import {
  connectionReading,
  pitchReading,
} from "@/lib/music/gesture-language";
import { attackMark, pickingMark } from "@/lib/tab/expression-marks";
import type {
  Articulation,
  NoteAttack,
  NoteConnection,
  PickingDirection,
  PitchGesture,
} from "@/lib/song/schema";

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
  attack,
  picking,
  pitchGesture,
  connection,
  rising,
}: {
  articulation?: Articulation;
  /**
   * The two axes 2V-D.1 added, drawn the same way as the three before them.
   *
   * `picking` is notation and nothing else: the sample bank holds one
   * recording per pitch, so a down-stroke and an up-stroke sound identical.
   * The mark is here because a guitarist can act on it with their own hand,
   * not because the app can.
   */
  attack?: NoteAttack;
  picking?: PickingDirection;
  /**
   * The two explicit axes (2V-C.1 §11).
   *
   * Passed rather than read from a song here: this draws, it does not decide.
   * What they mean comes from `gesture-language`, which is also what the
   * screen reader is given, so the character and the sentence cannot drift.
   */
  pitchGesture?: PitchGesture;
  connection?: NoteConnection;
  rising?: boolean;
}) {
  const reading = resolveExpression({
    ...(articulation === undefined ? {} : { articulation }),
    ...(attack === undefined ? {} : { attack }),
    ...(picking === undefined ? {} : { picking }),
    ...(pitchGesture === undefined ? {} : { pitchGesture }),
    ...(connection === undefined ? {} : { connection }),
  });

  /*
   * A note that answers one axis twice is not drawn as either of them.
   * Playback refuses it too, and the page saying "b1" over a note the
   * speakers refuse would be the page and the ear disagreeing.
   */
  if (reading.conflict !== null) return null;

  const joined = connectionReading(reading.connection, rising);
  const moved = pitchReading(reading.pitch);
  /* The attack axis keeps its old table: `>`, `PM`, `.` and the rest are
     marks about the strike, which neither of the two new fields touches. */
  const struck =
    reading.attack === undefined ? null : articulationMark(reading.attack, rising);
  /* The explicit axis has its own table; a note answers one of the two, never
     both, so these can never print twice. */
  const explicit = attackMark(
    reading.attackAxis?.source === "attack" ? reading.attackAxis.attack : null,
  );
  const picked = pickingMark(reading.picking);

  const mark = [
    joined.mark,
    struck ?? explicit?.glyph ?? "",
    picked?.glyph ?? "",
    moved.mark,
  ].join("");
  if (mark.length === 0) return null;

  const spoken = [
    joined.spoken,
    reading.attack === undefined ? (explicit?.spoken ?? "") : articulationLabel(reading.attack),
    picked?.spoken ?? "",
    moved.spoken,
  ]
    .filter((part) => part.length > 0)
    .join(", ");

  return (
    <span className="text-bronze ml-px font-mono text-[9px] leading-none">
      <span aria-hidden>{mark}</span>
      <span className="sr-only"> {spoken}</span>
    </span>
  );
}

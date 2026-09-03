import { RHYTHM_TAIL_HEIGHT, SLOT_WIDTH } from "@/components/workspace/geometry";
import { valueLabel } from "@/lib/music/note-value";
import { beamRunLabel, type RhythmTail, type TailNote } from "@/lib/tab/rhythm-tail";

/**
 * The written rhythm under the staff (2T-B §4).
 *
 * Tab says where the fingers go and almost nothing about when. This row is
 * the "when": a stem for every note, beams across the notes read together, a
 * dot where the value is dotted, a bracket over a triplet, a rest where the
 * bar is actually silent, and a tie mark where a duration needed two values
 * to write.
 *
 * ## What it may not do
 *
 * It lives in its own row below the staff, so it cannot cover a fret number,
 * an articulation glyph, the playhead or the selection band — not by z-order
 * but because it is somewhere else on the page. It takes no pointer events at
 * all: everything here is a reading, and every reading has an editable source
 * higher up. And it carries no colour of its own beyond the ordinary text
 * colour, because what a beam says is said by where it is and how many lines
 * it has, which still reads in sun, in dark mode, and to someone who cannot
 * separate two hues.
 */

/** The tail's own vertical layout, inside the row it was given. */
const STEM_TOP = 0;
const STEM_HEIGHT = 6;
const BEAM_TOP = STEM_TOP + STEM_HEIGHT;
const BEAM_PITCH = 2;
const HOOK_WIDTH = Math.round(SLOT_WIDTH * 0.35);
const TIE_TOP = BEAM_TOP + 3 * BEAM_PITCH + 1;
const BRACKET_TOP = TIE_TOP + 2;

const centreOf = (slot: number, column: number) => slot * column + column / 2;

/** What a screen reader is told about one entry (spec 13.20 §7). */
export function tailNoteLabel(note: TailNote): string {
  const value = note.value === null ? "yazılamayan süre" : valueLabel(note.value);
  const kind = note.kind === "rest" ? "Es" : "Nota";
  const tie = note.tiedTo ? ", bağ devam ediyor" : "";
  const mixed = note.mixed ? ", yığında farklı süreler var" : "";
  return `${kind}: ${value}${tie}${mixed}`;
}

/** A rest: a block on the beat, with one hook per beam its value carries. */
function Rest({ note, column }: { note: TailNote; column: number }) {
  return (
    <span
      className="absolute"
      style={{ left: centreOf(note.slotIndex, column) - 5, top: BEAM_TOP - 4 }}
      role="img"
      aria-label={tailNoteLabel(note)}
    >
      <span aria-hidden className="bg-muted/70 absolute block h-[3px] w-[10px]" />
      {Array.from({ length: note.flags }, (_, index) => (
        <span
          key={index}
          aria-hidden
          className="bg-muted/70 absolute block h-px w-[6px]"
          style={{ top: 5 + index * BEAM_PITCH, left: 2 }}
        />
      ))}
    </span>
  );
}

/** A note: a stem, its dot, its own flags if no beam took it in, its tie. */
function Note({ note, column }: { note: TailNote; column: number }) {
  const left = centreOf(note.slotIndex, column);
  return (
    <span
      className="absolute"
      style={{ left, top: STEM_TOP }}
      role="img"
      aria-label={tailNoteLabel(note)}
    >
      {note.stem ? (
        <span
          aria-hidden
          className="bg-muted/70 absolute block w-px"
          style={{ height: STEM_HEIGHT }}
        />
      ) : (
        /* A whole note has no stem, so the row would otherwise show nothing
           where a note certainly is. A small head says it is here. */
        <span
          aria-hidden
          className="bg-muted/70 absolute block h-[3px] w-[5px] rounded-full"
          style={{ top: STEM_HEIGHT - 3 }}
        />
      )}

      {note.dots > 0 ? (
        <span
          aria-hidden
          className="bg-muted/70 absolute block h-[2px] w-[2px] rounded-full"
          style={{ top: 1, left: 3 }}
        />
      ) : null}

      {Array.from({ length: note.flags }, (_, index) => (
        <span
          key={index}
          aria-hidden
          className="bg-muted/70 absolute block h-px"
          style={{ top: BEAM_TOP + index * BEAM_PITCH, left: 0, width: HOOK_WIDTH }}
        />
      ))}

      {note.tiedTo ? (
        <span
          aria-hidden
          className="bg-muted/50 absolute block h-px"
          style={{ top: TIE_TOP, left: 1, width: column / 2 }}
        />
      ) : null}

      {note.mixed ? (
        /* The voices under this stem do not share a length. Saying so is
           cheaper than drawing one of them and hoping nobody notices. */
        <span
          aria-hidden
          className="bg-muted/70 absolute block h-[3px] w-px"
          style={{ top: STEM_TOP, left: 2 }}
        />
      ) : null}
    </span>
  );
}

export function RhythmTailLayer({
  tail,
  column = SLOT_WIDTH,
}: {
  tail: RhythmTail;
  /** One stored column's width; narrower in a bar raised to a lattice (§7). */
  column?: number;
}) {
  if (tail.notes.length === 0) return null;

  return (
    <div
      className="pointer-events-none relative"
      style={{ height: RHYTHM_TAIL_HEIGHT }}
    >
      {tail.notes.map((note) =>
        note.kind === "rest" ? (
          <Rest key={`r${note.slotIndex}`} note={note} column={column} />
        ) : (
          <Note key={`n${note.slotIndex}`} note={note} column={column} />
        ),
      )}

      {tail.beams.map((beam) => {
        const from = centreOf(beam.fromSlot, column);
        const to = centreOf(beam.toSlot, column);
        const width =
          beam.hook === null ? Math.max(to - from, 1) : HOOK_WIDTH;
        const left = beam.hook === "left" ? from - HOOK_WIDTH : from;
        const tuplet = tail.tuplets.some(
          (bracket) =>
            bracket.fromSlot <= beam.fromSlot && bracket.toSlot >= beam.toSlot,
        );
        return (
          <span
            key={`${beam.level}-${beam.fromSlot}-${beam.toSlot}-${beam.hook ?? ""}`}
            role="img"
            aria-label={beamRunLabel(beam, tuplet)}
            className="bg-muted/70 absolute block h-px"
            style={{ top: BEAM_TOP + (beam.level - 1) * BEAM_PITCH, left, width }}
          />
        );
      })}

      {tail.tuplets.map((bracket) => {
        const from = centreOf(bracket.fromSlot, column);
        const width = Math.max(centreOf(bracket.toSlot, column) - from, 1);
        return (
          <span
            key={`t${bracket.fromSlot}`}
            role="img"
            aria-label={`${bracket.count}'lü grup`}
            className="absolute"
            style={{ left: from, top: BRACKET_TOP, width }}
          >
            <span aria-hidden className="bg-muted/60 absolute block h-px w-full" />
            <span
              aria-hidden
              className="text-muted/80 absolute text-[7px] leading-none"
              style={{ top: 1, left: Math.max(0, width / 2 - 2) }}
            >
              {bracket.count}
            </span>
          </span>
        );
      })}
    </div>
  );
}

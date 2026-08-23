/**
 * What one finger means (spec 13.20 §1, 2N-A).
 *
 * A long press picks up **one onset group**: the chord struck at the moment
 * the finger landed, every string of it, and the ties that keep it sounding.
 * Nothing else. It does not reach backwards to the note this one was hammered
 * onto, and it does not reach forwards to the note hammered onto it.
 *
 * That was not true before this checkpoint. A press was handed straight to the
 * transform core, which grew it to cover the whole legato chain before
 * anything else happened, so touching the middle shape of a three-chord run
 * selected six notes across two bars and announced it as "zincir tamamlandı".
 * The reproduction in `eval/tab/DEFECTS.json` measured exactly that: two notes
 * under the finger, six in the band.
 *
 * The chain still matters — moving one shape out of a run really does break
 * something — but that is a question about a *command*, answered by the
 * preflight before the command runs, not a question about what the reader is
 * holding. Selecting is not editing, and a selection that quietly grows is a
 * selection the reader cannot trust.
 *
 * ## What counts as one onset
 *
 * - **A chord is one onset.** Every note struck at the same tick belongs to
 *   it, whichever string it is on. There is no chord object in the Song and
 *   none is invented here: "a chord" is simply more than one `NoteEvent` in
 *   one slot, which is what the contract already says.
 * - **A tie is not a new onset.** Pressing anywhere along a held note picks up
 *   the note that is being held, and the selection covers the sound it makes —
 *   strike and ties together, across a bar line if that is where it goes.
 * - **A rest is nothing.** Pressing one selects the slot that was pressed and
 *   says the selection is empty, rather than reaching for the nearest note.
 *
 * Pure, and no second traversal: the onset blocks come from
 * `sectionOnsetBlocks`, which is the model the group move and the tab already
 * read (spec 5.4).
 */
import {
  blockContaining,
  sectionOnsetBlocks,
  sectionSlotStream,
  type SlotPosition,
} from "@/lib/song/onset-block";
import type { NoteEvent, Section } from "@/lib/song/schema";
import type { TimeSelection } from "@/lib/song/time-selection";

export type OnsetPick = {
  /** Exactly the onset group, in ticks from the start of the section. */
  readonly selection: TimeSelection;
  /** The notes struck at the start of it. Empty when a rest was pressed. */
  readonly notes: readonly NoteEvent[];
  /** True when the press landed on a tie rather than on the strike itself. */
  readonly fromTie: boolean;
};

const notesOf = (entry: SlotPosition | undefined): readonly NoteEvent[] =>
  entry?.slot && entry.slot !== "-" ? entry.slot.notes : [];

/**
 * The onset group under a moment in time, or null when that moment is not in
 * this section at all.
 *
 * `ticks` is a position, not a slot index: bars stopped sharing a grid in 2H-A
 * (spec 5.5, K-34), so a press has to be resolved against the bar it landed
 * in rather than against a slot number that means different things in
 * different bars.
 */
export function pickOnsetAt(
  section: Section,
  trackId: string,
  ticks: number,
): OnsetPick | null {
  const stream = sectionSlotStream(section, trackId);
  const index = stream.findIndex(
    (entry) => ticks >= entry.startTicks && ticks < entry.startTicks + entry.durationTicks,
  );
  const entry = index >= 0 ? stream[index] : undefined;
  if (!entry) return null;

  const base = { sectionId: section.id, trackId };
  const blocks = sectionOnsetBlocks(section, trackId);
  const block = blockContaining(blocks, {
    barIndex: entry.barIndex,
    slotIndex: entry.slotIndex,
  });

  if (!block) {
    // A rest, or a bar this track is not written in. The press still names a
    // moment — the reader may be about to paste there — but it holds nothing.
    return {
      selection: {
        ...base,
        startTicks: entry.startTicks,
        endTicks: entry.startTicks + entry.durationTicks,
      },
      notes: [],
      fromTie: false,
    };
  }

  /*
   * A block occupies consecutive stream entries by construction — the tie run
   * is built by walking forwards from the strike — so its last slot is found
   * by counting rather than by searching for it again.
   */
  const first = stream[block.startIndex];
  const last = stream[block.startIndex + block.length - 1];
  if (!first || !last) return null;

  return {
    selection: {
      ...base,
      startTicks: first.startTicks,
      endTicks: last.startTicks + last.durationTicks,
    },
    notes: notesOf(first),
    fromTie: entry.startTicks !== first.startTicks,
  };
}

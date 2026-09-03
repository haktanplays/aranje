/**
 * What a proposed edit is, before anyone agrees to it (2V-B.4 §7).
 *
 * ## Two songs, and only one of them is real
 *
 * A reader building a fast run or a chord wants to hear it before it is
 * theirs. The obvious implementation — write it, play it, undo it if they say
 * no — is wrong three times over: it puts music in the canonical Song that
 * nobody agreed to, it writes a transaction to the ledger and to the device
 * store, and a cancel then has to *reverse* something rather than simply not
 * having done it.
 *
 * So a preview is a **second Song held in memory**. The canonical one is not
 * touched, the ledger is not written, the project store is not written, and
 * cancelling is the cheapest operation there is: dropping a reference.
 *
 * ## What the grid draws
 *
 * The draft's own notes are ghosts — amber, clearly not committed — over the
 * committed music, so the reader sees both at once and can compare. That is
 * why the draft carries the ticks it wrote as well as the Song: the renderer
 * needs to know which events are the proposal.
 *
 * This module is the vocabulary only. Holding one is `use-edit-intent`.
 */
import type { Song } from "@/lib/song/schema";

/** Where a draft's proposed events are, so the grid can draw them as ghosts. */
export type DraftGhost = {
  readonly sectionId: string;
  readonly trackId: string;
  /** Ticks from the start of the section. */
  readonly fromTicks: number;
  readonly toTicks: number;
  /** One per proposed onset, for the renderer to mark. */
  readonly onsetTicks: readonly number[];
};

export type EditDraft = {
  /** The song as it would be. Never the canonical one. */
  readonly song: Song;
  readonly ghost: DraftGhost;
  /** What the reader is being asked to confirm, in one line. */
  readonly summary: string;
  /** History label for the transaction, when it is applied. */
  readonly label: string;
};

/** Is this tick inside the proposal? For the renderer's ghost test. */
export function ghostCovers(ghost: DraftGhost, sectionId: string, ticks: number): boolean {
  return (
    ghost.sectionId === sectionId && ticks >= ghost.fromTicks && ticks < ghost.toTicks
  );
}

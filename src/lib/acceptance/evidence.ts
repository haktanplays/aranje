/**
 * Did the ghost write anything? (K-59.1 §6)
 *
 * The live run produced two lines that cannot both be true:
 *
 *     Power ghost: ISSUE (otomatik: 0/3 ses, yazma VAR)
 *     Storage/history mutation: none
 *
 * The first came from counting fret numbers on screen and calling any
 * increase a write. That is not a write; it is a *drawing*. A selection
 * highlight, a ghost the pen is previewing, a bar scrolling into the window —
 * each of them changes what is on screen and none of them changes the song.
 *
 * So the question is asked of the things a write actually moves, and the
 * answer is the disagreement between them rather than any one of them:
 *
 * - the song's own canonical bytes, before and after;
 * - how many times storage was written;
 * - how long the history is;
 * - whether undo is offered;
 * - how many real note events the song carries.
 *
 * Two failures are then distinguishable, which is the whole point:
 *
 * - **Nothing wrote.** Every source agrees. That is the pen behaving.
 * - **Something wrote.** The song changed, and storage and history agree it
 *   did. That is an ordinary bug in the pen.
 * - **They disagree.** The song changed but storage and history did not, or
 *   the reverse. That is an atomicity fault (spec 13.13, K-44) and is worse
 *   than either, because it means the one gate is not the only gate.
 */
export type WriteEvidence = {
  /** Canonical bytes of the song, taken the same way both times. */
  readonly songBefore: string;
  readonly songAfter: string;
  /** How many note events the song carries, counted the same way both times. */
  readonly notesBefore: number;
  readonly notesAfter: number;
  readonly storageWrites: number;
  readonly historyDepthBefore: number;
  readonly historyDepthAfter: number;
  readonly undoOfferedAfter: boolean;
};

export type WriteVerdict =
  | { readonly kind: "nothing_written" }
  | { readonly kind: "written"; readonly notesAdded: number }
  | { readonly kind: "inconsistent"; readonly detail: string };

export function judgeWrite(evidence: WriteEvidence): WriteVerdict {
  const songChanged = evidence.songBefore !== evidence.songAfter;
  const notesAdded = evidence.notesAfter - evidence.notesBefore;
  const historyGrew = evidence.historyDepthAfter > evidence.historyDepthBefore;
  const stored = evidence.storageWrites > 0;

  if (!songChanged && !historyGrew && !stored && !evidence.undoOfferedAfter) {
    return { kind: "nothing_written" };
  }

  /*
   * A song that changed must have been stored and must have left a step. The
   * two directions are reported separately because they mean opposite things:
   * a change nobody saved is data the reader will lose, and a step behind no
   * change is an undo that does nothing.
   */
  if (songChanged && !(historyGrew && stored)) {
    return {
      kind: "inconsistent",
      detail: `song değişti ama history ${
        historyGrew ? "büyüdü" : "büyümedi"
      } / storage write ${evidence.storageWrites}`,
    };
  }
  if (!songChanged && (historyGrew || stored)) {
    return {
      kind: "inconsistent",
      detail: `song aynı ama history ${
        historyGrew ? "büyüdü" : "aynı"
      } / storage write ${evidence.storageWrites}`,
    };
  }
  if (!songChanged && evidence.undoOfferedAfter) {
    return { kind: "inconsistent", detail: "song aynı ama undo açık" };
  }

  return { kind: "written", notesAdded };
}

/** One line for the result block, in the reader's language. */
export function writeLine(verdict: WriteVerdict): string {
  switch (verdict.kind) {
    case "nothing_written":
      return "yazma yok";
    case "written":
      return `yazma VAR (${verdict.notesAdded} nota)`;
    case "inconsistent":
      return `TUTARSIZ: ${verdict.detail}`;
  }
}

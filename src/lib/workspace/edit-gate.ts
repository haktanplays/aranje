/**
 * May this track be edited on this screen, and if not, why (spec 13.14,
 * 2Q-B §5.3).
 *
 * Pure, and out of the composition root since 2L-C: the answer is two
 * reader-facing sentences and a boolean derived from two facts, which is a
 * table rather than glue. Keeping it here also keeps the wording in one
 * place, next to the other one-table-per-decision modules, rather than
 * inside a component where it would be rewritten by whoever touched the
 * layout next.
 *
 * ## What changed at 2Q-B, and why the instrument no longer appears here
 *
 * This gate used to refuse every track that was not a fretted one, and said
 * so: "yalnız akordu olan telli track'ler düzenlenebiliyor". That sentence
 * was true while the fret sheet was the only way to write. It is not true
 * any more — a kit is written on a step grid and a fretless instrument on a
 * note strip — and leaving the refusal in place would have meant shipping
 * both of those surfaces behind a door that never opens.
 *
 * So the instrument is not consulted at all now. Which *surface* answers for
 * a track is the drawing layer's question; whether the reader may write at
 * all is this one's, and the answer no longer depends on what they play.
 */
import type { Track } from "@/lib/song/schema";

export type EditGate = {
  readonly canEdit: boolean;
  /** Null when editing is open, or when there is no track to talk about. */
  readonly editDisabledReason: string | null;
};

export function editGate(input: {
  track: Track | undefined;
  /** A Copilot candidate is on screen, measured against an older song. */
  previewOpen: boolean;
  canPersist: boolean;
}): EditGate {
  const { track, previewOpen, canPersist } = input;

  const canEdit = track !== undefined && !previewOpen && canPersist;

  if (track === undefined || canEdit) {
    return { canEdit, editDisabledReason: null };
  }

  /*
   * Storage first: it is the harder gate and the one whose consequence is
   * losing work, so when both are true it is the one the reader is told
   * about. The banner above the workspace carries the specific reason
   * writing is closed; this sentence only has to say that it is.
   */
  return {
    canEdit,
    editDisabledReason: !canPersist
      ? "Değişiklikler kaydedilemeyeceği için düzenleme kapalı."
      : "Copilot önerisi ekrandayken düzenleme kapalı. Öneriyi uygula ya da kapat.",
  };
}

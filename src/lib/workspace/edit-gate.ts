/**
 * May this track be edited on this screen, and if not, why (spec 13.14).
 *
 * Pure, and out of the composition root since 2L-C: the answer is two
 * reader-facing sentences and a boolean derived from three facts, which is a
 * table rather than glue. Keeping it here also keeps the wording in one
 * place, next to the other one-table-per-decision modules, rather than
 * inside a component where it would be rewritten by whoever touched the
 * layout next.
 */
import { isEditableTrack } from "@/lib/song/edit";
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

  /*
   * Editing and a candidate never share the screen: a candidate was measured
   * against the song as it was when it was asked for. `canPersist` is the
   * harder gate — controls are disabled rather than left to fail at the end.
   */
  const canEdit =
    track !== undefined && isEditableTrack(track) && !previewOpen && canPersist;

  if (track === undefined || canEdit) {
    return { canEdit, editDisabledReason: null };
  }
  return {
    canEdit,
    editDisabledReason: !canPersist
      ? // One sentence for every reason writing is closed — the banner above
        // the workspace carries the specific one.
        "Değişiklikler kaydedilemeyeceği için düzenleme kapalı."
      : `"${track.name}" bu ekrandan düzenlenemiyor. Şimdilik yalnız akordu olan telli track'ler düzenlenebiliyor.`,
  };
}

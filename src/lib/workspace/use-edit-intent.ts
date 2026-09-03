"use client";

/**
 * One intention: propose it, hear it, keep it (2V-B.4 §7).
 *
 * The shelf's panels all work the same way — build the song as it *would* be,
 * play that, and commit it once if the reader says yes — and this is that
 * shape, held once so the four panels share it rather than each wiring their
 * own path to the store.
 *
 * ## Apply is one transaction
 *
 * When the reader says yes, the draft's Song goes to the same `commit` every
 * other edit uses, exactly once. Undo removes the whole proposal because it
 * arrived as one value; redo restores it byte-exact for the same reason.
 *
 * The commit and the preview are passed in. This hook holds the proposal and
 * nothing else: it has no route to storage, no history internals, and no way
 * to write anything the caller did not hand it the means to write.
 */
import { useCallback, useState } from "react";

import type { EditDraft } from "@/lib/workspace/edit-draft";
import type { HistoryAction } from "@/lib/song/edit-history";
import type { Song } from "@/lib/song/schema";

export type EditIntent = {
  readonly draft: EditDraft | null;
  /** Put a proposal on the screen. Replaces any earlier one. */
  propose(next: EditDraft): void;
  /** Throw it away. The canonical Song was never touched, so this is enough. */
  discard(): void;
  /** Hear the candidate through the production engine. Writes nothing. */
  preview(candidate: Song): void;
  apply(proposal: EditDraft): void;
};

export function useEditIntent(input: {
  commit(next: Song, action: HistoryAction): boolean;
  /** The production preview engine, so nothing here builds a second one. */
  previewSong(candidate: Song): void;
}): EditIntent {
  const { commit, previewSong } = input;
  const [draft, setDraft] = useState<EditDraft | null>(null);

  const propose = useCallback((next: EditDraft) => setDraft(next), []);
  const discard = useCallback(() => setDraft(null), []);

  const apply = useCallback(
    (proposal: EditDraft) => {
      /*
       * One transaction, named. The label comes from the panel that made the
       * proposal — "Hızlı dizi", "Akor ekle", "Ton: G minor" — so undo says
       * what it is about to take back rather than "Düzenleme".
       */
      commit(proposal.song, { kind: "editor_intent", label: proposal.label });
      /*
       * Cleared in the same tick as the commit. A draft left on the screen
       * after it has been applied would be drawn as a ghost over the very
       * notes it became, which reads as the edit having happened twice.
       */
      setDraft(null);
    },
    [commit],
  );

  return { draft, propose, discard, preview: previewSong, apply };
}

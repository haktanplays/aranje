"use client";

/**
 * The edit strip, as one area (2S-A §11).
 *
 * The intent doors, the group-selection bar and the edit toolbar always
 * appear together, in this order, and each of them is about the same thing:
 * what the reader can do to the music on screen. They were three blocks in
 * the composition root, and when the doors arrived that was four — so they
 * became an area, the same way the selection actions did.
 *
 * It composes; it decides nothing. Every callback here belongs to a handle
 * that was made somewhere else.
 */
import { useState } from "react";

import { ComposerArea } from "@/components/workspace/ComposerArea";
import { EditToolbar } from "@/components/workspace/EditToolbar";
import { SelectionBar } from "@/components/workspace/SelectionBar";
import { SelectionToolbar } from "@/components/workspace/SelectionToolbar";
import type { SelectionVerbs } from "@/lib/workspace/selection-verbs";
import type { ComposerDoor } from "@/lib/workspace/composer-tool";
import type { IntentComposer } from "@/lib/workspace/use-intent-composer";
import type { NoteEditing } from "@/lib/workspace/use-note-editing";
import type { Song, Track } from "@/lib/song/schema";
import type { TimeSelection } from "@/lib/song/time-selection";

export function EditArea({
  composer,
  noteEditing,
  song,
  track,
  selection,
  selectionActions,
  onOpenChordBuilder,
  onOpenRhythm,
  toolbar,
}: {
  composer: IntentComposer;
  noteEditing: NoteEditing;
  song: Song;
  track: Track | undefined;
  selection: TimeSelection | null;
  /**
   * The verbs a covered run offers, or null when nothing is covered.
   *
   * Null is what makes the doors visible: the two rows are one line of the
   * screen, and which of them is on it is a question about the selection.
   */
  selectionActions: SelectionVerbs | null;
  onOpenChordBuilder: ((power: boolean) => void) | null;
  onOpenRhythm: (() => void) | null;
  /** Everything the toolbar needs, passed through unchanged. */
  toolbar: React.ComponentProps<typeof EditToolbar>;
}) {
  const [door, setDoor] = useState<ComposerDoor | null>(null);

  return (
    <>
      {noteEditing.editing ? (
        <>
          <ComposerArea
            composer={composer}
            song={song}
            track={track}
            selection={selection}
            showDoors={selectionActions === null}
            door={door}
            onDoor={setDoor}
            onOpenChordBuilder={onOpenChordBuilder}
            onOpenRhythm={onOpenRhythm}
          />
          {selectionActions ? (
            <SelectionToolbar
              actions={{
                ...selectionActions,
                // The brush's own door, one tap from a covered run.
                onConnect: () => setDoor("connect"),
              }}
            />
          ) : null}
          <SelectionBar
            count={noteEditing.group.selection?.refs.length ?? 0}
            error={noteEditing.group.moveError}
            onMove={noteEditing.group.move}
            onClear={noteEditing.group.clear}
          />
        </>
      ) : null}
      <EditToolbar {...toolbar} />
    </>
  );
}

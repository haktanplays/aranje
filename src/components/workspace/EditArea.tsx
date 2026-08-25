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
import { ComposerArea } from "@/components/workspace/ComposerArea";
import { EditToolbar } from "@/components/workspace/EditToolbar";
import { SelectionBar } from "@/components/workspace/SelectionBar";
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
  onOpenChordBuilder,
  onOpenRhythm,
  toolbar,
}: {
  composer: IntentComposer;
  noteEditing: NoteEditing;
  song: Song;
  track: Track | undefined;
  selection: TimeSelection | null;
  onOpenChordBuilder: ((power: boolean) => void) | null;
  onOpenRhythm: (() => void) | null;
  /** Everything the toolbar needs, passed through unchanged. */
  toolbar: React.ComponentProps<typeof EditToolbar>;
}) {
  return (
    <>
      {noteEditing.editing ? (
        <>
          <ComposerArea
            composer={composer}
            song={song}
            track={track}
            selection={selection}
            onOpenChordBuilder={onOpenChordBuilder}
            onOpenRhythm={onOpenRhythm}
          />
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

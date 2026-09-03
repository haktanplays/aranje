"use client";

/**
 * The edit strip, as one area (2S-A §11, 2W §8).
 *
 * ## One shell, from two rows that took turns
 *
 * The doors and the selection verbs used to swap places on the same line —
 * `showDoors={selectionActions === null}` — so the row changed identity under
 * the reader's finger: four intent names with nothing held, seven unrelated
 * verbs with something held. Measured at five viewports they never stacked,
 * so this was never a height problem; it was two vocabularies sharing a line.
 *
 * `EditorDock` replaces both. Four constant group names — Ses, Ritim, Çalım,
 * Seçim — and only their contents change with what is held. It sits in the
 * flow, never over the grid.
 *
 * It composes; it decides nothing. Every callback here belongs to a handle
 * that was made somewhere else.
 */
import { useState } from "react";

import { ComposerArea } from "@/components/workspace/ComposerArea";
import { EditToolbar } from "@/components/workspace/EditToolbar";
import { EditorDock } from "@/components/workspace/EditorDock";
import { ViewZoomControls } from "@/components/workspace/ViewZoomControls";
import { SelectionBar } from "@/components/workspace/SelectionBar";
import { SelectionMoreSheet } from "@/components/workspace/SelectionMoreSheet";
import { editorDock } from "@/lib/workspace/editor-dock";
import type { SelectionActions } from "@/lib/workspace/selection-verbs";
import type { SelectionActionId } from "@/lib/song/selection-action-canon";
import type { ComposerDoor } from "@/lib/workspace/composer-tool";
import type { IntentComposer } from "@/lib/workspace/use-intent-composer";
import type { NoteEditing } from "@/lib/workspace/use-note-editing";
import type { ViewZoom } from "@/lib/ui/use-view-zoom";
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
  zoom,
  canZoom,
  canFitSelection,
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
  selectionActions: SelectionActions | null;
  onOpenChordBuilder: ((power: boolean) => void) | null;
  onOpenRhythm: (() => void) | null;
  /** Everything the toolbar needs, passed through unchanged. */
  toolbar: React.ComponentProps<typeof EditToolbar>;
  /**
   * The view magnification (2V-B.3 §10).
   *
   * It lives in the shelf rather than over the staff, and it is here in both
   * layouts for one reason: in landscape the shelf *is* the side inspector,
   * so a control placed here is reachable in portrait and in landscape
   * without being written twice.
   */
  zoom: ViewZoom;
  /** The arrangement has no staff to magnify. */
  canZoom: boolean;
  canFitSelection: boolean;
}) {
  const [door, setDoor] = useState<ComposerDoor | null>(null);
  const [more, setMore] = useState(false);

  /*
   * One shelf, from the two sources that used to draw two rows. `offers` is
   * the capability model's own list — unchanged, including every disabled
   * entry's reason — and the doors come from the intent layer.
   */
  const dock = editorDock({
    offers: selectionActions?.actions ?? [],
    tool: composer.tool,
    hasSelection: selectionActions !== null,
  });

  /** Route a shelf press back to whichever layer owns it. */
  const runDockItem = (itemId: string) => {
    const [kind, id] = itemId.split(":");
    if (kind === "door") {
      setDoor(id as ComposerDoor);
      return;
    }
    if (id === "more") {
      setMore(true);
      return;
    }
    if (id === "connect") {
      /* The brush's own door, one tap from a covered run. */
      setDoor("connect");
      return;
    }
    selectionActions?.run(id as SelectionActionId);
  };

  return (
    <>
      {noteEditing.editing ? (
        <>
          <ComposerArea
            composer={composer}
            song={song}
            track={track}
            selection={selection}
            /* The dock draws the doors now; the sheets behind them stay. */
            showDoors={false}
            door={door}
            onDoor={setDoor}
            onOpenChordBuilder={onOpenChordBuilder}
            onOpenRhythm={onOpenRhythm}
          />
          <EditorDock
            model={dock}
            notice={selectionActions?.notice ?? null}
            error={selectionActions?.error ?? null}
            onRun={runDockItem}
          />
          <SelectionMoreSheet
            open={more}
            actions={(selectionActions?.actions ?? []).filter(
              (entry) => entry.placement === "more_sheet",
            )}
            onRun={(id) => runDockItem(`action:${id}`)}
            onClose={() => setMore(false)}
          />
          <SelectionBar
            count={noteEditing.group.selection?.refs.length ?? 0}
            error={noteEditing.group.moveError}
            onMove={noteEditing.group.move}
            onClear={noteEditing.group.clear}
          />
        </>
      ) : null}
      {canZoom ? (
        <ViewZoomControls
          zoom={zoom}
          /* Named by the surface, which is the only thing that knows how wide
             a measure is here; null after a pinch, and that is honest. */
          activeBars={zoom.presetBars}
          canFitSelection={canFitSelection}
        />
      ) : null}
      <EditToolbar {...toolbar} />
    </>
  );
}

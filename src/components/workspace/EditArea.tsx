"use client";

/**
 * The edit strip, as one area (2S-A §11, 2W §8, 2V-B.4 §4).
 *
 * ## One shell, and now one place where work happens
 *
 * `EditorDock` gave the four groups — Ses, Ritim, Çalım, Seçim — one constant
 * vocabulary. What it did not have was anywhere to *do* anything beyond a row
 * of verbs, so the real work still happened in bottom sheets that covered the
 * grid: measured at `c11a758`, a cell tap put an 85%-tall sheet over the music
 * at all six viewports.
 *
 * The dock now has a panel region in the flow, and the panels live here. A
 * tap on a cell opens Nota; a group's own entry opens Akor, Hızlı dizi, Süre
 * or Taşı. All four are the same shell, all four leave the grid on the screen,
 * and which one is open is one piece of state rather than four.
 *
 * ## It composes; it decides nothing
 *
 * The targets come from `edit-target`, the proposals from the production
 * commands, the preview from the production engine and the commit from the
 * one the rest of the app uses. What this file owns is which panel is open.
 */
import { useState } from "react";

import { ComposerArea } from "@/components/workspace/ComposerArea";
import { EditToolbar } from "@/components/workspace/EditToolbar";
import { EditorDock } from "@/components/workspace/EditorDock";
import { ViewZoomControls } from "@/components/workspace/ViewZoomControls";
import { SelectionBar } from "@/components/workspace/SelectionBar";
import { SelectionMoreSheet } from "@/components/workspace/SelectionMoreSheet";
import { ShelfPanels } from "@/components/workspace/shelf/ShelfPanels";
import { editorDock } from "@/lib/workspace/editor-dock";
import {
  SHELF_PANELS,
  SHELF_PANEL_IDS,
  panelAvailability,
  type ShelfPanelId,
} from "@/lib/workspace/shelf-panel";
import { targetFromCell, targetFromRange } from "@/lib/workspace/edit-target";
import type { EditDraft } from "@/lib/workspace/edit-draft";
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
  draft,
  onPropose,
  onDiscard,
  onPreview,
  onApply,
}: {
  composer: IntentComposer;
  noteEditing: NoteEditing;
  song: Song;
  track: Track | undefined;
  selection: TimeSelection | null;
  selectionActions: SelectionActions | null;
  onOpenChordBuilder: ((power: boolean) => void) | null;
  onOpenRhythm: (() => void) | null;
  toolbar: React.ComponentProps<typeof EditToolbar>;
  zoom: ViewZoom;
  canZoom: boolean;
  canFitSelection: boolean;
  /** The proposal on the screen, drawn as ghosts over the grid (§7). */
  draft: EditDraft | null;
  onPropose: (next: EditDraft) => void;
  onDiscard: () => void;
  onPreview: (candidate: Song) => void;
  onApply: (proposal: EditDraft) => void;
}) {
  const [door, setDoor] = useState<ComposerDoor | null>(null);
  const [more, setMore] = useState(false);
  const [panel, setPanel] = useState<ShelfPanelId | null>(null);

  const dock = editorDock({
    offers: selectionActions?.actions ?? [],
    tool: composer.tool,
    hasSelection: selectionActions !== null,
  });

  /*
   * Where the panels point. The cell wins over the range: a reader who has
   * just tapped one position is asking about that position, even if a range
   * from a moment ago is still held.
   */
  const target =
    track && noteEditing.cell
      ? targetFromCell(song, track.id, noteEditing.cell)
      : track && selection
        ? targetFromRange(song, track.id, {
            sectionId: selection.sectionId,
            startTicks: selection.startTicks,
            endTicks: selection.endTicks,
          })
        : null;

  const availabilityContext = {
    hasCell: noteEditing.cell !== null,
    hasSelection: selection !== null,
    fretted: track?.fretboard !== undefined,
    canEdit: noteEditing.editing,
  };

  const panelEntries = SHELF_PANEL_IDS.map((id) => {
    const meta = SHELF_PANELS[id];
    const state = panelAvailability(id, availabilityContext);
    return {
      id,
      group: meta.group,
      label: meta.label,
      ...(state.state === "disabled" && state.reason ? { reason: state.reason } : {}),
    };
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
      setDoor("connect");
      return;
    }
    selectionActions?.run(id as SelectionActionId);
  };

  const openPanel = (id: string | null) => {
    setPanel(id as ShelfPanelId | null);
    /* Leaving a panel throws away whatever it was proposing: a ghost with no
       panel behind it is an edit the reader can no longer confirm or cancel. */
    if (id === null) onDiscard();
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
            panels={panelEntries}
            panel={
              panel === null ? null : (
                <ShelfPanels
                  panel={panel}
                  song={song}
                  track={track}
                  target={target}
                  selection={selection}
                  noteEditing={noteEditing}
                  draft={draft}
                  onPropose={onPropose}
                  onDiscard={onDiscard}
                  onPreview={onPreview}
                  onApply={onApply}
                  onOpenPanel={setPanel}
                />
              )
            }
            panelTitle={panel === null ? null : SHELF_PANELS[panel].label}
            onPanel={openPanel}
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
          activeBars={zoom.presetBars}
          canFitSelection={canFitSelection}
        />
      ) : null}
      <EditToolbar {...toolbar} />
    </>
  );
}

/**
 * Which panel a cell tap should open.
 *
 * Exported so the composition root can open it without reaching into this
 * component's state: a tap arrives at the surface, not here, and the panel it
 * opens is a fact about the gesture rather than about this file.
 */
export const PANEL_FOR_CELL: ShelfPanelId = "note";

"use client";

/**
 * Everything that is *about* the grid, beside the grid (2V-B.3 §8).
 *
 * ## Why this is one component now
 *
 * The selection actions, the track door and the editor shelf were three
 * siblings of the work surface, stacked under it. In portrait that reads
 * correctly and always has. Measured at 740×360 it did not: the column could
 * not fit, so the app's own action row came down over the staff and the centre
 * of the grid stopped answering its own hit test — the reader's work surface
 * covered by the controls for working on it.
 *
 * Landscape needs them in a second column, and a second column needs a name.
 * This is that name. It carries no decision of its own: which verbs are
 * offered, whether a track door belongs on this surface and what the toolbar
 * may do are all still answered where they were, and arrive here already
 * decided.
 *
 * The layout itself is two CSS classes — `workspace-body` and
 * `workspace-shelf` — because "one column or two" is a question about the
 * viewport and belongs to the stylesheet, not to a hook that would have to
 * measure the screen and re-render on every rotation.
 */
import { EditArea } from "@/components/workspace/EditArea";
import type { EditToolbar } from "@/components/workspace/EditToolbar";
import { SelectionActionArea } from "@/components/workspace/SelectionActionArea";
import { TrackControl } from "@/components/workspace/TrackControl";
import type { WorkspaceView } from "@/components/workspace/ViewSwitch";
import type { ViewZoom } from "@/lib/ui/use-view-zoom";
import type { CoveredRun } from "@/lib/workspace/selection-verbs";
import type { EditIntent } from "@/lib/workspace/use-edit-intent";
import type { IntentComposer } from "@/lib/workspace/use-intent-composer";
import type { NoteEditing } from "@/lib/workspace/use-note-editing";
import type { SelectionSession } from "@/lib/workspace/use-selection-session";
import type { Song, Track } from "@/lib/song/schema";

export function WorkspaceShelf(props: {
  session: SelectionSession;
  song: Song;
  listening: React.ComponentProps<typeof SelectionActionArea>["listening"];
  practice: React.ComponentProps<typeof SelectionActionArea>["practice"];
  /** The run under the selection, or null — the one source for both rows. */
  covered: CoveredRun | null;
  onOpenTiming: React.ComponentProps<typeof SelectionActionArea>["onOpenTiming"];
  view: WorkspaceView;
  zoom: ViewZoom;
  track: Track | undefined;
  onOpenTrack: () => void;
  composer: IntentComposer;
  noteEditing: NoteEditing;
  onOpenChordBuilder: ((power: boolean) => void) | null;
  onOpenRhythm: (() => void) | null;
  toolbar: React.ComponentProps<typeof EditToolbar>;
  /** The staged proposal, shared with the staff that draws its ghosts (§7). */
  intent: EditIntent;
}) {
  const { covered, intent, session, view } = props;
  return (
    <div className="workspace-shelf">
      <SelectionActionArea
        session={session}
        song={props.song}
        listening={props.listening}
        practice={props.practice}
        compact={covered !== null}
        onOpenTiming={props.onOpenTiming}
      />

      {/* Both notation surfaces; the multi view needs this door too (§8). */}
      {view !== "arrange" ? (
        <TrackControl track={props.track} onOpen={props.onOpenTrack} />
      ) : null}

      <EditArea
        composer={props.composer}
        noteEditing={props.noteEditing}
        song={props.song}
        track={props.track}
        selection={session.time.handle.selection}
        selectionActions={covered?.verbs ?? null}
        onOpenChordBuilder={props.onOpenChordBuilder}
        onOpenRhythm={props.onOpenRhythm}
        toolbar={props.toolbar}
        zoom={props.zoom}
        /* The arrangement has no staff, so there is nothing to magnify. */
        canZoom={view === "tab"}
        canFitSelection={session.time.handle.selection !== null}
        draft={intent.draft}
        onPropose={intent.propose}
        onDiscard={intent.discard}
        onPreview={intent.preview}
        onApply={intent.apply}
      />
    </div>
  );
}

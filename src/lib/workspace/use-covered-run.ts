"use client";

/**
 * What a covered run says, offers, and lets the reader hear (K-59 §3, 2V-A §3).
 *
 * One line in the composition root instead of six, and for the reason K-47
 * names rather than for tidiness: the root is where wiring goes to be
 * forgotten, and this wiring now has a lifecycle attached to it. Describing
 * the selection, planning what it would sound like and deciding when a run has
 * to stop are all facts about the session — not about the file that happens to
 * render it.
 */
import { coveredRun, type CoveredRun } from "@/lib/workspace/selection-verbs";
import { useSelectionListening } from "@/lib/workspace/use-selection-listening";
import { describeTimeSelection } from "@/lib/song/selection-descriptor";
import type { PlaybackController } from "@/lib/audio/playback";
import type { SelectionSession } from "@/lib/workspace/use-selection-session";
import type { Song } from "@/lib/song/schema";

export function useCoveredRun(input: {
  readonly song: Song;
  readonly controller: PlaybackController;
  readonly session: SelectionSession;
  readonly editing: boolean;
  /**
   * Whether this screen may audition at all.
   *
   * Not the same question as "is something selected": a reader who has moved
   * to the arrangement, closed the editor or handed the screen to the Copilot
   * still has their selection, and the sound still has to stop (2V-A §5).
   */
  readonly listenable: boolean;
}): CoveredRun | null {
  const { controller, editing, listenable, session, song } = input;
  const selection = session.time.handle.selection;

  const listening = useSelectionListening({
    song,
    controller,
    descriptor: selection ? describeTimeSelection(song, selection) : null,
    enabled: listenable,
  });

  return coveredRun({ editing, time: session.time, song, listening });
}

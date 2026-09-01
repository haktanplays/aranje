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
import {
  describeBarSelection,
  describeTimeSelection,
} from "@/lib/song/selection-descriptor";
import type { PlaybackController } from "@/lib/audio/playback";
import type { SelectionListening } from "@/lib/workspace/use-selection-listening";
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
}): { readonly covered: CoveredRun | null; readonly listening: SelectionListening } {
  const { controller, editing, listenable, session, song } = input;
  const selection = session.time.handle.selection;
  /*
   * Whichever of the two is held (2V-B §6). Taking hold of bars lets the time
   * selection go, so there is never a choice to make — and a run of whole bars
   * is very much a thing to listen to. `describeBarSelection` carries one
   * track id in the "Bu enstrüman" scope and every one in "Tüm enstrümanlar",
   * so the plan honours the scope without this file knowing about scopes.
   */
  const bars = session.bars.handle.selection;
  const descriptor = bars
    ? describeBarSelection(song, bars)
    : selection
      ? describeTimeSelection(song, selection)
      : null;

  const listening = useSelectionListening({
    song,
    controller,
    descriptor,
    enabled: listenable,
  });

  /*
   * Both, because the reading surface needs the listening intents too
   * (2V-B §1). `coveredRun` is still null unless the reader is writing — it is
   * the compact row's own answer — but the sound belongs to the selection, not
   * to the mode, and returning it only alongside a covered run is how the read
   * surface came to have no way to hear anything at all.
   */
  return { covered: coveredRun({ editing, time: session.time, song, listening }), listening };
}

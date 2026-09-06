"use client";

/**
 * Home or the editor, and nothing else (2V-E.1 §3, §8).
 *
 * The app used to have one screen, so it had to open on *something* — which
 * is why a device with nothing on it opened on the demo song. Now it has two,
 * and which one a reader lands on is a fact rather than a fallback: the
 * editor when a project is open, Home when none is.
 *
 * ## Why the editor is keyed by the project
 *
 * Switching project replaces the song, the history baseline and the audio
 * graph. Keeping the same mounted editor across that would leave the
 * selections, clipboards, staged commands and scheduled voices of one song
 * pointing at another. The key makes the change a remount, which puts all of
 * them down at once and is exactly the guarantee §18 asks for — an undo stack
 * cannot cross a project because it does not survive the switch.
 *
 * This file composes; it decides nothing. Which projects exist, what a card
 * says and what one tap creates all belong to `use-home`.
 */
import { HomeScreen } from "@/components/home/HomeScreen";
import { Workspace } from "@/components/workspace/Workspace";
import { useHome } from "@/lib/home/use-home";
import { useSong } from "@/lib/song/use-song";

export function AppShell() {
  const { canPersist } = useSong();
  /*
   * Nothing to put down here: the editor is unmounted on every switch, and a
   * component that is gone has no playback to stop and no selection to clear.
   */
  const home = useHome({ onBeforeSwitch: () => {}, canPersist });

  /* Nothing is known until the browser has been read; see `HomeHandle.ready`. */
  if (!home.ready) return null;

  if (home.route === "home" || home.activeProjectId === null) {
    return <HomeScreen home={home} />;
  }

  return <Workspace key={home.activeProjectId} onHome={home.goHome} />;
}

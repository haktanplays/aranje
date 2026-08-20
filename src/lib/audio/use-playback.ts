"use client";

import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";

import { PlaybackController, type PlaybackState } from "@/lib/audio/playback";
import { DEFAULT_PRACTICE_PERCENT } from "@/lib/audio/practice-rate";
import type { Song } from "@/lib/song/schema";

const SERVER_STATE: PlaybackState = {
  status: "idle",
  songBpm: 0,
  practicePercent: DEFAULT_PRACTICE_PERCENT,
  bpm: 0,
  loopSectionId: null,
  metronome: false,
  progress: null,
  error: null,
};

/**
 * Owns one controller per song. The controller survives play and pause; it is
 * disposed when the song changes or the screen unmounts.
 */
export function usePlayback(
  song: Song,
  /** Only the starting value: a later change is an event, not a re-render. */
  initialPracticePercent: number = DEFAULT_PRACTICE_PERCENT,
): {
  controller: PlaybackController;
  state: PlaybackState;
} {
  const [entry, setEntry] = useState(() => ({
    song,
    controller: new PlaybackController(song, {
      practicePercent: initialPracticePercent,
    }),
  }));

  // A different song means a different graph. Replacing the entry here lets the
  // effect below dispose the one it replaces. The practice speed is a session
  // setting, so it carries across the replacement rather than resetting.
  if (entry.song !== song) {
    setEntry({
      song,
      controller: new PlaybackController(song, {
        practicePercent: entry.controller.getPracticePercent(),
      }),
    });
  }

  useEffect(() => {
    const { controller } = entry;
    return () => controller.dispose();
  }, [entry]);

  const state = useSyncExternalStore(
    entry.controller.subscribe,
    () => entry.controller.getState(),
    () => SERVER_STATE,
  );

  return { controller: entry.controller, state };
}

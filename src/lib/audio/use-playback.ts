"use client";

import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";

import { PlaybackController, type PlaybackState } from "@/lib/audio/playback";
import { isMixOnlyChange } from "@/lib/song/track-mix";
import { DEFAULT_PRACTICE_PERCENT } from "@/lib/audio/practice-rate";
import { NO_LOOP, rangeIsLive } from "@/lib/practice/range";
import type { Song } from "@/lib/song/schema";

const SERVER_STATE: PlaybackState = {
  status: "idle",
  songBpm: 0,
  practicePercent: DEFAULT_PRACTICE_PERCENT,
  bpm: 0,
  activeBpm: 0,
  hasTempoChanges: false,
  loop: NO_LOOP,
  metronome: false,
  progress: null,
  error: null,
  silentTrackNotice: null,
};

/**
 * The controller for a song that is genuinely different music.
 *
 * The position and the practice speed carry across, and so does the loop —
 * but only if its section is still real (spec 13.13, K-44). A loop whose
 * section is gone is turned **off** rather than quietly re-pointed at
 * whichever section now sits at those ticks, because a loop that keeps
 * running over different music is the app playing something nobody asked
 * for. No graph is built here: a seek on an engine-less controller is a
 * remembered tick and nothing else.
 */
function carriedController(
  previous: PlaybackController,
  song: Song,
): PlaybackController {
  const next = new PlaybackController(song, {
    practicePercent: previous.getPracticePercent(),
  });

  const at = previous.getPosition().barKey;
  if (at !== null) next.seekToNearestBar(at);

  /*
   * The loop survives a change to the song only if the music it names does.
   * A section that lost its bars and a practice range whose bars were removed
   * are the same failure: the loop would name a shape the new song does not
   * have, and the transport would be looping something the reader did not
   * choose. Both are checked against the new song, not the old one.
   */
  const loop = previous.getState().loop;
  const survives =
    loop.kind === "none"
      ? false
      : loop.kind === "section"
        ? song.sections.some(
            (section) => section.id === loop.sectionId && section.bars.length > 0,
          )
        : rangeIsLive(song, loop.range);
  if (survives) next.setLoop(loop);

  return next;
}

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

  if (entry.song !== song) {
    /*
     * A different song usually means a different graph, and replacing the
     * entry is what lets the effect below dispose the one it replaces.
     *
     * Unless the only thing that changed is the mix (spec 13.18 §7). A
     * rebuild re-decodes every sample, so doing it for a volume slider would
     * stop the music in order to change how loud it is. The decision is the
     * central `isMixOnlyChange`, never a condition written here: one
     * predicate, held to account by its own tests.
     */
    if (isMixOnlyChange(entry.song, song)) {
      entry.controller.applyMixOnly(song);
      setEntry({ song, controller: entry.controller });
    } else {
      setEntry({ song, controller: carriedController(entry.controller, song) });
    }
  }

  /*
   * Keyed on the controller, not the entry: a mix-only change swaps the
   * remembered song while keeping the controller, and disposing it there
   * would tear down the very graph that path exists to preserve.
   */
  const { controller } = entry;
  useEffect(() => () => controller.dispose(), [controller]);

  const state = useSyncExternalStore(
    entry.controller.subscribe,
    () => entry.controller.getState(),
    () => SERVER_STATE,
  );

  return { controller: entry.controller, state };
}

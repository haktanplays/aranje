"use client";

/**
 * "Seçimi dinle" and "Seçimden döngü", wired to the transport (2V-A §3–§6).
 *
 * A hook rather than lines in the composition root, for the reason K-47
 * names: the root is where behaviour goes to be forgotten, and this
 * behaviour has a lifecycle. It owns three things and nothing else — the two
 * intents, the stop, and every way a run has to end on its own.
 *
 * It produces no command, stages nothing and writes nothing. The Song is read
 * to be planned and scheduled; that is all (§6).
 */
import { useCallback, useEffect, useRef } from "react";

import { shouldStopListening } from "@/lib/playback/listening-session";
import {
  planSelectionPlayback,
  type SelectionPlaybackMode,
} from "@/lib/playback/selection-playback";
import type { PlaybackController } from "@/lib/audio/playback";
import type { SelectionDescriptor } from "@/lib/song/selection-descriptor";
import type { Song } from "@/lib/song/schema";

export type SelectionListening = {
  /** Hear it once. Does nothing at all when there is nothing to hear. */
  audition(): void;
  /** Loop it, or — when it is already looping this selection — stop. */
  toggleLoop(): void;
  /** True while *this* selection is the one looping. */
  readonly looping: boolean;
  /** Stop and clean up, whatever is running. Safe when nothing is. */
  stop(): void;
};

export function useSelectionListening(input: {
  readonly song: Song;
  readonly controller: PlaybackController;
  /** What is held right now, or null. */
  readonly descriptor: SelectionDescriptor | null;
  /**
   * False when the surface has no business auditioning at all — the reader
   * has left the editor, changed view, or the screen belongs to something
   * else. A run in flight is stopped rather than left sounding behind a
   * screen the reader can no longer see it on (§5).
   */
  readonly enabled: boolean;
}): SelectionListening {
  const { controller, descriptor, enabled, song } = input;

  const planFor = useCallback(
    (mode: SelectionPlaybackMode) => {
      const result = planSelectionPlayback(song, descriptor, mode);
      return result.ok ? result.plan : null;
    },
    [descriptor, song],
  );

  const playing = controller.getSelectionPlayback();
  const wanted = planFor("loop");
  const looping = enabled && playing?.mode === "loop" && !shouldStopListening(playing, wanted);

  /*
   * The latest of everything, so the teardown effect below can depend on
   * nothing and still tear down what is actually running. An effect that
   * listed these would run its cleanup on every reach of a selection handle,
   * which is a run that stops itself a frame after starting.
   */
  const latest = useRef({ controller, playing, wanted, enabled });
  useEffect(() => {
    latest.current = { controller, playing, wanted, enabled };
  });

  /*
   * The selection stopped being the selection this run was started for — it
   * was cancelled, redrawn, or its instrument or section changed under it —
   * or the surface stopped being one that may audition at all.
   */
  useEffect(() => {
    if (!playing) return;
    if (enabled && !shouldStopListening(playing, wanted)) return;
    controller.stopSelection();
  }, [controller, enabled, playing, wanted]);

  /* Leaving the screen takes the sound with it, whatever state it was in. */
  useEffect(
    () => () => {
      latest.current.controller.stopSelection();
    },
    [],
  );

  const audition = useCallback(() => {
    const plan = planFor("once");
    if (!plan) return;
    void controller.playSelection(plan);
  }, [controller, planFor]);

  const toggleLoop = useCallback(() => {
    if (looping) {
      controller.stopSelection();
      return;
    }
    const plan = planFor("loop");
    if (!plan) return;
    void controller.playSelection(plan);
  }, [controller, looping, planFor]);

  const stop = useCallback(() => {
    controller.stopSelection();
  }, [controller]);

  return { audition, toggleLoop, looping, stop };
}

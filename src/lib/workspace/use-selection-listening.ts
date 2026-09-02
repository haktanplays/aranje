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
import { useCallback, useEffect, useRef, useState } from "react";

import { shouldStopListening } from "@/lib/playback/listening-session";
import {
  planSelectionPlayback,
  refusalSentence,
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
  /**
   * Why the last press produced no sound, or null (2V-B.2 §4).
   *
   * A press that is refused used to return in silence, which from the
   * reader's side is indistinguishable from a broken button — and on the
   * founder's phone that is exactly what it was taken for. The refusal the
   * planner already produces is kept here so the surface that offered the
   * action can say it. Cleared by the next press that works and by any change
   * of selection, because a sentence about music the reader has moved on from
   * is worse than no sentence.
   */
  readonly refusal: string | null;
  /** Stop and clean up, whatever is running. Safe when nothing is. */
  stop(): void;
};

/**
 * A stable name for "which selection this is".
 *
 * The same four facts `playbackSignature` compares, read off the descriptor
 * instead of a plan so a refused selection — which has no plan — can still be
 * named. Null is a name too: it is the one the sentence about an empty
 * selection would be attached to if there were one.
 */
function descriptorKey(descriptor: SelectionDescriptor | null): string {
  if (!descriptor) return "none";
  return [
    descriptor.sectionId,
    descriptor.startTicks,
    descriptor.endTicks,
    [...descriptor.trackIds].sort().join(","),
  ].join("|");
}

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

  /*
   * A new selection is a new question, so the old answer goes with it. The
   * sentence is stored *with the selection it is about* rather than cleared
   * by an effect: the reader can make it irrelevant by redrawing what they
   * hold, and no press happens then to do the clearing.
   *
   * Keyed by signature rather than by identity, because the descriptor is
   * rebuilt on every render — comparing objects would clear the sentence one
   * frame after it was set, which is the same silence it exists to end.
   */
  const [explained, setExplained] = useState<{
    readonly key: string;
    readonly text: string | null;
  } | null>(null);
  const key = descriptorKey(descriptor);
  const refusal = explained && explained.key === key ? explained.text : null;
  const explain = useCallback(
    (text: string | null) => setExplained({ key, text }),
    [key],
  );

  const planFor = useCallback(
    (mode: SelectionPlaybackMode) => {
      const result = planSelectionPlayback(song, descriptor, mode);
      return result.ok ? result.plan : null;
    },
    [descriptor, song],
  );

  /**
   * Plan it, and remember the sentence when there is not one to play.
   *
   * `no_selection` has no sentence — there is nothing on screen to attach one
   * to — so `refusalSentence` returning null leaves the surface quiet, which
   * is the right amount to say about a press that cannot have happened.
   */
  const planOrExplain = useCallback(
    (mode: SelectionPlaybackMode) => {
      const result = planSelectionPlayback(song, descriptor, mode);
      explain(result.ok ? null : refusalSentence(result.reason));
      return result.ok ? result.plan : null;
    },
    [descriptor, explain, song],
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
    const plan = planOrExplain("once");
    if (!plan) return;
    void controller.playSelection(plan);
  }, [controller, planOrExplain]);

  const toggleLoop = useCallback(() => {
    if (looping) {
      controller.stopSelection();
      return;
    }
    const plan = planOrExplain("loop");
    if (!plan) return;
    void controller.playSelection(plan);
  }, [controller, looping, planOrExplain]);

  const stop = useCallback(() => {
    controller.stopSelection();
  }, [controller]);

  return { audition, toggleLoop, looping, refusal, stop };
}

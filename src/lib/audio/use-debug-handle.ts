"use client";

import { useEffect, useRef } from "react";

import { debugArmed } from "@/lib/audio/debug-arm";
import type { PlaybackController } from "@/lib/audio/playback";

/**
 * Measurement surface for the debug query and the eval routes (spec 8.4/8.5).
 *
 * `debugArmed` owns the decision; see the reason it is not just a query.
 *
 * Reports the transport's own clock so timing can be checked against wall time
 * from outside the app. Reading only; nothing here can drive playback.
 */
export type AranjeDebug = {
  status: () => string;
  ticks: () => number;
  seconds: () => number;
  bpm: () => number;
  /** The tempo sounding at the playhead, section tempos included (K-25). */
  activeBpm: () => number;
  hasTempoChanges: () => boolean;
  position: () => { barKey: string | null; barIndex: number; slotIndex: number };
  loop: () => { on: boolean; startTicks: number; endTicks: number } | null;
  totalTicks: () => number;
  /**
   * The selection being heard, or null (2V-A §10).
   *
   * Reading, like everything else here. A harness cannot ask the screen where
   * an audition started and ended — the drawer closes when it starts, and the
   * band on the staff is where the *selection* is, not where the sound is —
   * so the bounds have to be readable or the acceptance run would be checking
   * that a button was pressed rather than that the right music was played.
   */
  selection: () => {
    startTicks: number;
    endTicks: number;
    trackIds: string[];
    mode: string;
    onsetCount: number;
  } | null;
  /**
   * What the *editor* is holding, which is a different thing from the above
   * (2V-B.2c §4).
   *
   * `selection` is the audition that is sounding; this is the run of music
   * the reader has under their finger, whether or not anything is playing.
   * The acceptance round needs it because eight of its thirteen steps ask the
   * reader to *do* something that writes nothing — draw a selection, reach it
   * forward, open its actions — and the only fact the harness had about those
   * steps was that no write had happened, which is equally true of a step
   * nobody has touched. That is how a fresh session came to report "Editör
   * kanıtı geldi." before the reader had done anything.
   *
   * Reading, like everything else on this surface, and armed by the same
   * `debugArmed` rule. Nothing here can change a selection, and no production
   * component learns that anyone is watching.
   */
  editorSelection: () => {
    sectionId: string;
    startTicks: number;
    endTicks: number;
    trackIds: string[];
    /** How many listening verbs the surface is offering on it right now. */
    listenVerbs: number;
  } | null;
};

declare global {
  interface Window {
    __aranjeDebug?: AranjeDebug;
  }
}

/** What the editor is holding, read from whoever owns the selection session. */
export type EditorSelectionProbe = () => {
  sectionId: string;
  startTicks: number;
  endTicks: number;
  trackIds: string[];
  listenVerbs: number;
} | null;

export function useDebugHandle(
  controller: PlaybackController,
  editorSelection: EditorSelectionProbe = () => null,
): void {
  /*
   * The newest reader, held in a ref so the handle is installed once.
   * Listing the probe as a dependency would tear the handle down and rebuild
   * it on every render of the workspace, and a handle that comes and goes is
   * a handle a harness finds missing exactly when it looks.
   */
  const latest = useRef(editorSelection);
  useEffect(() => {
    latest.current = editorSelection;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!debugArmed(window.location.search, window.location.pathname)) return;

    const handle: AranjeDebug = {
      status: () => controller.getState().status,
      ticks: () => controller.getTransportTicks(),
      seconds: () => controller.getTransportSeconds(),
      bpm: () => controller.getState().bpm,
      activeBpm: () => {
        // Reading the position is what refreshes it, so ask for it first.
        controller.getPosition();
        return controller.getState().activeBpm;
      },
      hasTempoChanges: () => controller.getState().hasTempoChanges,
      position: () => {
        const at = controller.getPosition();
        return {
          barKey: at.barKey,
          barIndex: at.barIndex,
          slotIndex: at.slotIndex,
        };
      },
      loop: () => controller.getLoopBounds(),
      totalTicks: () => controller.getPlan().totalTicks,
      selection: () => {
        const plan = controller.getSelectionPlayback();
        if (!plan) return null;
        return {
          startTicks: plan.startTicks,
          endTicks: plan.endTicks,
          trackIds: [...plan.trackIds],
          mode: plan.mode,
          onsetCount: plan.onsetCount,
        };
      },
      editorSelection: () => latest.current(),
    };

    window.__aranjeDebug = handle;
    return () => {
      if (window.__aranjeDebug === handle) delete window.__aranjeDebug;
    };
  }, [controller]);
}

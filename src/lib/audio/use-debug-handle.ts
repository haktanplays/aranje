"use client";

import { useEffect } from "react";

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
};

declare global {
  interface Window {
    __aranjeDebug?: AranjeDebug;
  }
}

export function useDebugHandle(controller: PlaybackController): void {
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
    };

    window.__aranjeDebug = handle;
    return () => {
      if (window.__aranjeDebug === handle) delete window.__aranjeDebug;
    };
  }, [controller]);
}

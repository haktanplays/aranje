"use client";

import { useEffect } from "react";

import type { PlaybackController } from "@/lib/audio/playback";

/**
 * Measurement surface for `?debug=1` (spec 8.4/8.5).
 *
 * Reports the transport's own clock so timing can be checked against wall time
 * from outside the app. Reading only; nothing here can drive playback.
 */
export type AranjeDebug = {
  status: () => string;
  ticks: () => number;
  seconds: () => number;
  bpm: () => number;
  position: () => { barKey: string | null; barIndex: number; slotIndex: number };
  loop: () => { on: boolean; startTicks: number; endTicks: number } | null;
  totalTicks: () => number;
};

declare global {
  interface Window {
    __aranjeDebug?: AranjeDebug;
  }
}

export function useDebugHandle(controller: PlaybackController): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!new URLSearchParams(window.location.search).has("debug")) return;

    const handle: AranjeDebug = {
      status: () => controller.getState().status,
      ticks: () => controller.getTransportTicks(),
      seconds: () => controller.getTransportSeconds(),
      bpm: () => controller.getState().bpm,
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
    };

    window.__aranjeDebug = handle;
    return () => {
      if (window.__aranjeDebug === handle) delete window.__aranjeDebug;
    };
  }, [controller]);
}

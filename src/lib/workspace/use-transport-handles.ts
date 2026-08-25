"use client";

/**
 * The three things every surface asks of the transport, and the one thing the
 * transport asks of the settings (2Q-B §13.1).
 *
 * Pausing, seeking to a bar and reading the position are plumbing: stable
 * callbacks over a controller the composition root did not build and does not
 * own. Keeping them here means the root composes controllers instead of
 * wrapping an audio object, and it means the practice-rate rule — the setting
 * is the source of truth, the controller is the system it is applied to — has
 * one home rather than living inline beside unrelated wiring.
 *
 * Retuning a running transport is not a re-render: it never rebuilds the
 * engine and never reschedules an event (spec 13.8).
 */
import { useCallback, useEffect } from "react";

import type { PlaybackController } from "@/lib/audio/playback";
import type { PlayPosition } from "@/lib/audio/position";

export type TransportHandles = {
  pause(): void;
  seek(barKey: string): void;
  getPosition(): PlayPosition;
};

export function useTransportHandles(
  controller: PlaybackController,
  practiceRatePercent: number,
): TransportHandles {
  useEffect(() => {
    controller.setPracticePercent(practiceRatePercent);
  }, [controller, practiceRatePercent]);

  const pause = useCallback(() => controller.pause(), [controller]);
  const seek = useCallback(
    (barKey: string) => controller.seekToBar(barKey),
    [controller],
  );
  const getPosition = useCallback(() => controller.getPosition(), [controller]);

  return { pause, seek, getPosition };
}

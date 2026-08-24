"use client";

/**
 * Hearing a chord, and making sure it stops (spec 13.22 §16, 2O-B).
 *
 * A real owner, and what it owns is one thing: the preview engine an audition
 * plays through. That is the same class the Copilot candidate uses, so there
 * is no second audio context, no second scheduler and no second sample bank —
 * and the reason this is a hook at all is the half nobody sees, which is
 * making sure a chord stops sounding when the sheet closes, when the screen
 * goes, and when a different shape is pressed.
 */
import { useCallback, useEffect, useMemo } from "react";

import { PlaybackController } from "@/lib/audio/playback";
import { PreviewEngine } from "@/lib/audio/preview-engine";
import { auditionSong } from "@/lib/chords/chord-audition";
import type { ChordArticulation } from "@/lib/chords/chord-command";
import type { ChordVoicing } from "@/lib/chords/chord-voicing";
import type { Song, Track } from "@/lib/song/schema";

export function useChordAudition(options: {
  song: Song;
  track: Track | undefined;
  /** True while the builder is open; false silences whatever is playing. */
  open: boolean;
  voicings: readonly ChordVoicing[];
  velocity: number;
  articulation: ChordArticulation;
  /** The song's own playback stops first: two songs never sound at once. */
  pause(): void;
}): (voicingId: string) => void {
  const { song, track, open, voicings, velocity, articulation, pause } = options;

  const engine = useMemo(
    () => new PreviewEngine((candidate) => new PlaybackController(candidate)),
    [],
  );

  const audition = useCallback(
    (voicingId: string) => {
      const voicing = voicings.find((entry) => entry.id === voicingId);
      if (!voicing || !track) return;
      // `start` stops the host and disposes any previous preview before it
      // builds a new one, so pressing four cards in a row leaves one voice.
      engine.start(
        auditionSong(song, track, voicing, { velocity, articulation }),
        "chord-audition",
        pause,
      );
    },
    [articulation, engine, pause, song, track, velocity, voicings],
  );

  useEffect(() => {
    if (!open) engine.stop();
  }, [engine, open]);
  useEffect(() => () => engine.stop(), [engine]);

  return audition;
}

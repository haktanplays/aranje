"use client";

/**
 * Hearing a chord, and making sure it stops (spec 13.22 §16, 2O-B).
 *
 * A real owner, and what it owns is two things that have the same lifetime:
 * the preview engine an audition plays through, and the session that keeps
 * the samples it decoded (2O-B.1 §3). The engine is the same class the
 * Copilot candidate uses, so there is no second audio context, no second
 * scheduler and no second sample bank.
 *
 * The reason this is a hook at all is the half nobody sees. A chord has to
 * stop sounding when the sheet closes, when the screen goes and when a
 * different shape is pressed — and the recordings must *not* be thrown away
 * at any of those moments. An audition builds an engine, plays one chord and
 * disposes it, so without something holding on, the decoded bank died
 * between shapes and the next one downloaded and decoded it all again.
 *
 * This hook lives for as long as the workspace does, not for as long as the
 * sheet is open, which is exactly the lifetime those samples should have.
 */
import { useCallback, useEffect, useMemo } from "react";

import { PlaybackController } from "@/lib/audio/playback";
import { PreviewBankSession } from "@/lib/audio/preview-bank";
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

  const bankSession = useMemo(() => new PreviewBankSession(), []);
  const engine = useMemo(
    () =>
      new PreviewEngine(
        (candidate) => new PlaybackController(candidate, { bankSession }),
      ),
    [bankSession],
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

  // Closing the sheet silences the chord. It does not throw the recordings
  // away: the reader is very likely to open it again, and the bank is the
  // same either way.
  useEffect(() => {
    if (!open) engine.stop();
  }, [engine, open]);
  // Leaving the screen ends both. Order matters: the engine gives its handles
  // back first, then the session lets go of what it was keeping, and the
  // banks are disposed because by then nobody holds them.
  useEffect(
    () => () => {
      engine.stop();
      bankSession.dispose();
    },
    [bankSession, engine],
  );

  return audition;
}

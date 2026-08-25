"use client";

/**
 * Hearing something before writing it, and making sure it stops
 * (spec 13.22 §16, 2O-B, 2Q-B §7.3).
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
import { auditionNoteSong, auditionSong } from "@/lib/chords/chord-audition";
import type { ChordArticulation } from "@/lib/chords/chord-command";
import type { ChordVoicing } from "@/lib/chords/chord-voicing";
import type { Song, Track } from "@/lib/song/schema";

export type Audition = {
  /** Play one of the builder's candidate shapes. */
  voicing(voicingId: string): void;
  /**
   * Play one note, on the reader's own track.
   *
   * The caller decides whether to offer this at all: a track whose preset has
   * no sample pack cannot be heard, and a preview that quietly substituted a
   * different instrument would be worse than no preview.
   */
  note(pitch: string, velocity: number): void;
  /** Silence whatever is sounding, without discarding the decoded bank. */
  stop(): void;
};

/**
 * One engine, one sample bank, both surfaces.
 *
 * The chord builder lives in the tab and the note sheet lives in the Çoklu
 * view, but "hear this before you write it" is the same act, and a second
 * engine would mean a second audio context and a second copy of every
 * decoded sample.
 */
export function useAudition(options: {
  song: Song;
  track: Track | undefined;
  /** True while the builder is open; false silences whatever is playing. */
  open: boolean;
  voicings: readonly ChordVoicing[];
  velocity: number;
  articulation: ChordArticulation;
  /** The song's own playback stops first: two songs never sound at once. */
  pause(): void;
}): Audition {
  const { song, track, open, voicings, velocity, articulation, pause } = options;

  const bankSession = useMemo(() => new PreviewBankSession(), []);
  const engine = useMemo(
    () =>
      new PreviewEngine(
        (candidate) => new PlaybackController(candidate, { bankSession }),
      ),
    [bankSession],
  );

  const voicing = useCallback(
    (voicingId: string) => {
      const chosen = voicings.find((entry) => entry.id === voicingId);
      if (!chosen || !track) return;
      // `start` stops the host and disposes any previous preview before it
      // builds a new one, so pressing four cards in a row leaves one voice.
      engine.start(
        auditionSong(song, track, chosen, { velocity, articulation }),
        "chord-audition",
        pause,
      );
    },
    [articulation, engine, pause, song, track, velocity, voicings],
  );

  const note = useCallback(
    (pitch: string, noteVelocity: number) => {
      if (!track) return;
      engine.start(
        auditionNoteSong(song, track, pitch, noteVelocity),
        "note-audition",
        pause,
      );
    },
    [engine, pause, song, track],
  );

  const stop = useCallback(() => engine.stop(), [engine]);

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

  return { voicing, note, stop };
}

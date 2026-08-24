/**
 * Hearing one shape before choosing it (spec 13.22 §16, 2O-B).
 *
 * An audition is not a new kind of playback. It is the *existing* preview
 * path — the one a Copilot candidate already uses — handed a one-bar song
 * that contains nothing but the chord, on the reader's own track with the
 * reader's own instrument, preset, tuning and mix. There is no second audio
 * context, no second scheduler, no second sample bank, and no second idea of
 * what an accent or a palm mute sounds like.
 *
 * The song this builds is thrown away as soon as it has been played. It never
 * reaches storage, history, the fingerprint or a Copilot request.
 */
import { voicingToNotes, type ChordVoicing } from "@/lib/chords/chord-voicing";
import { chordPreviewLimits } from "@/lib/limits";
import { DEFAULT_RESOLUTION, DEFAULT_TIME_SIGNATURE, slotCount } from "@/lib/music/timing";
import type { ChordArticulation } from "@/lib/chords/chord-command";
import type { Song, Track } from "@/lib/song/schema";

/**
 * How loudly a chord is auditioned.
 *
 * Six strings struck together are six voices at once, and at the velocity a
 * single note is written with they would sum well past what the output can
 * take. So the *preview* is scaled by how many notes it holds — and only the
 * preview. The velocity written into the Song is untouched, the mix is
 * untouched, and an exported file hears none of this.
 */
export function auditionVelocity(noteCount: number, velocity: number): number {
  const scale = Math.min(1, chordPreviewLimits.referenceVoices / Math.max(1, noteCount));
  const scaled = Math.round(velocity * scale);
  return Math.max(1, Math.min(127, scaled));
}

/**
 * A throwaway song: one bar, one track, the chord on the first beat.
 *
 * The track is copied whole, so preset, tuning, capo, volume and pan are the
 * ones the reader is actually working with; only its content is replaced.
 */
export function auditionSong(
  song: Song,
  track: Track,
  voicing: ChordVoicing,
  options: { velocity: number; articulation?: ChordArticulation },
): Song {
  const notes = voicingToNotes(voicing, {
    velocity: auditionVelocity(
      voicingToNotes(voicing).length,
      options.velocity,
    ),
    ...(options.articulation === undefined ? {} : { articulation: options.articulation }),
  });

  const count = slotCount(DEFAULT_TIME_SIGNATURE, DEFAULT_RESOLUTION);
  const slots = Array.from({ length: count }, (_, index) =>
    index === 0 ? { notes } : index < count ? ("-" as const) : null,
  );

  return {
    ...song,
    tracks: [track],
    sections: [
      {
        id: "chord-audition",
        name: "Akor",
        status: "fixed",
        bars: [
          {
            timeSignature: [...DEFAULT_TIME_SIGNATURE] as [4, 4],
            resolution: DEFAULT_RESOLUTION,
            slots: { [track.id]: slots },
          },
        ],
      },
    ],
  };
}

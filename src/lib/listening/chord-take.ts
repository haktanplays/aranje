/**
 * The B side of L8: the chord the new flow would actually write (2W §4, §11).
 *
 * The founder is being asked whether an ordinary chord sounds like a playable
 * voicing rather than a pile of pitches. Answering that honestly means the
 * clip has to contain the shape the product would really put on the grid —
 * not a hand-picked one that happens to sound good.
 *
 * So this walks the same three steps the chord panel will: ask the capability
 * model for the playable shapes, ask the recommendation layer which one goes
 * on the grid first, and write it with the production chord command. If any
 * of the three refuses, this returns null and the listening pack offers the
 * power chord alone rather than an A/B pair with one silent side.
 */
import { chordVoicings, type ChordVoicing } from "@/lib/chords/chord-voicing";
import { applyChordWrite } from "@/lib/chords/chord-command";
import { recommendVoicings } from "@/lib/chords/voicing-recommendation";
import { barTimeline, buildNotatedPlan } from "@/lib/audio/schedule";
import { songSupport } from "@/lib/acceptance/song-support";
import type { Song } from "@/lib/song/schema";

export type ChordTake = {
  readonly song: Song;
  readonly voicing: ChordVoicing;
  /** Which bar the chord went into, 1-based. The clip windows on it. */
  readonly barNumber: number;
  /** What the shape is, in one line, for the manifest and the report. */
  readonly description: string;
};

/**
 * Write the recommended voicing of one chord into a copy of the song.
 *
 * It goes into the first bar that instrument has left empty, and it fills it,
 * so the clip is one chord ringing on its own. Landing it on top of the power
 * chord instead was tried and is wrong twice over: the production command
 * refuses it (`target_occupied`, because the bar carries later onsets the
 * chord's own duration would cover), and even if it did not, a chord written
 * over a riff is not the thing the founder is being asked about.
 */
export function chordTake(
  song: Song,
  input: { readonly rootPitchClass: number; readonly quality: "minor" | "major" },
): ChordTake | null {
  const support = songSupport(song);
  const trackId = support.heldPowerChord?.trackId ?? song.tracks[0]?.id;
  const track = song.tracks.find((entry) => entry.id === trackId);
  const timeline = barTimeline(song);
  if (!track) return null;

  const sounding = buildNotatedPlan(song)
    .events.filter((event) => event.trackId === track.id)
    .map((event) => ({
      time: event.time,
      /* A drum hit has no written length; one tick is enough to say "here". */
      durationTicks: event.kind === "note" ? event.durationTicks : 1,
    }));
  const barIndex = timeline.findIndex(
    (entry) =>
      !sounding.some(
        (event) =>
          event.time < entry.time + entry.durationTicks &&
          event.time + event.durationTicks > entry.time,
      ),
  );
  const bar = timeline[barIndex];
  if (!bar) return null;

  const offered = chordVoicings({
    track,
    rootPitchClass: input.rootPitchClass,
    quality: input.quality,
  });
  if (!offered.ok) return null;

  const pick = recommendVoicings(offered.voicings);
  if (pick === null) return null;

  const written = applyChordWrite(song, {
    sectionId: bar.sectionId,
    trackId: track.id,
    /* Ticks from the start of the *section*, which is where this bar begins. */
    timeTicks: bar.time,
    durationTicks: bar.durationTicks,
    voicing: pick.recommended,
    velocity: 96,
    mode: "insert",
  });
  if (!written.ok) return null;

  const shape = pick.recommended;
  const description =
    shape.kind === "fretted"
      ? `${shape.shape.noteCount} tel · ${shape.shape.frettedCount} parmak · ${shape.shape.anchor}. perde`
      : `${shape.stack.midi.length} nota`;

  return {
    song: written.song,
    voicing: pick.recommended,
    barNumber: barIndex + 1,
    description,
  };
}

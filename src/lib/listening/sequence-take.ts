/**
 * L10's music: a fast connected run inside an ordinary bar (2V-B.3).
 *
 * The founder is being asked one thing — does `9–10–9` speed up naturally and
 * sound like a single guitar movement — so the clip has to contain all three
 * parts of that question in one short listen: the ordinary rhythm around it,
 * the run itself in the same interval of time, and the note after it arriving
 * on the beat it was always on.
 *
 * Everything goes through the production path. The run is written by
 * `applySequenceWrite`, with the same local override the reader would be asked
 * to approve, so what the founder hears is what the flow produces — not a
 * hand-built demo that happens to sound right.
 *
 * ## Why it appends a bar rather than borrowing one
 *
 * The acceptance fixture has no measure that is empty on *every* track, and a
 * local override re-expresses the whole measure — every lane in it, because a
 * bar has one grid. Writing the run into a bar the bass is playing in would
 * either refuse (the bass's own rhythm does not survive the finer grid) or
 * quietly move music the founder is not being asked about. So the clip gets a
 * measure of its own, on a copy of the song that only this clip ever sees.
 */
import { barTimeline } from "@/lib/audio/schedule";
import { songSupport } from "@/lib/acceptance/song-support";
import { planNoteSequence } from "@/lib/music/note-sequence";
import { pitchAt, settle } from "@/lib/song/edit";
import { applySequenceWrite } from "@/lib/song/sequence-write";
import {
  isDrumSlotArray,
  type DrumSlot,
  type MelodicSlot,
  type Song,
} from "@/lib/song/schema";

/** Where the run sits on the fretboard. The founder's own shape. */
const RUN_STRING = 1;
const RUN_FRETS = [9, 10, 9] as const;

/** 4/4 at 1/8: eight slots of 96 ticks, the grid a beginner's bar is on. */
const CONTEXT_RESOLUTION = 8;
const CONTEXT_SLOT_TICKS = 96;

export type SequenceTake = {
  readonly song: Song;
  /** Which bar it went into, 1-based. The clip windows on it. */
  readonly barNumber: number;
  /** One line, for the manifest and the report. */
  readonly description: string;
};

export function sequenceTake(song: Song): SequenceTake | null {
  const support = songSupport(song);
  const trackId = support.heldPowerChord?.trackId ?? song.tracks[0]?.id;
  const track = song.tracks.find((entry) => entry.id === trackId);
  const fretboard = track?.fretboard;
  if (!track || !fretboard) return null;

  const pitch = pitchAt(fretboard, RUN_STRING, RUN_FRETS[0]);
  if (pitch === null) return null;

  /*
   * The context: two ordinary eighths, then the space the run goes into, then
   * the note that must still arrive on time. Every other track rests, so what
   * is heard is the guitar movement and nothing competing with it.
   */
  const struck = { pitch, position: { string: RUN_STRING, fret: RUN_FRETS[0] } };
  const lane: MelodicSlot[] = Array.from({ length: 8 }, () => null);
  lane[0] = { notes: [struck] };
  lane[1] = { notes: [struck] };
  lane[3] = { notes: [struck] };

  const slots: Record<string, MelodicSlot[] | DrumSlot[]> = {};
  for (const entry of song.tracks) {
    const existing = song.sections[0]?.bars[0]?.slots[entry.id];
    slots[entry.id] =
      existing && isDrumSlotArray(existing)
        ? Array.from({ length: 8 }, () => [] as DrumSlot)
        : Array.from({ length: 8 }, () => null as MelodicSlot);
  }
  slots[track.id] = lane;

  const sectionIndex = song.sections.length - 1;
  const section = song.sections[sectionIndex];
  if (!section) return null;
  const barInSection = section.bars.length;

  const staged = settle({
    ...song,
    sections: song.sections.map((entry, index) =>
      index === sectionIndex
        ? {
            ...entry,
            bars: [
              ...entry.bars,
              {
                timeSignature: [4, 4] as const,
                resolution: CONTEXT_RESOLUTION,
                slots,
              },
            ],
          }
        : entry,
    ),
  });
  if (!staged.ok) return null;

  const planned = planNoteSequence({
    /* Ticks from the start of the bar: the third eighth. */
    startTicks: 2 * CONTEXT_SLOT_TICKS,
    spanTicks: CONTEXT_SLOT_TICKS,
    steps: RUN_FRETS.map((fret) => ({ stringIndex: RUN_STRING, fret })),
    performance: "connected",
  });
  if (!planned.ok) return null;

  const written = applySequenceWrite(staged.song, {
    sectionId: section.id,
    trackId: track.id,
    barIndex: barInSection,
    plan: planned.plan,
    /* The reader's "yes" to "Bu hareket için bu bölümü sıklaştır." */
    allowLocalOverride: true,
  });
  if (!written.ok) return null;

  const barNumber = barTimeline(written.song).findIndex(
    (marker) => marker.barKey === `${section.id}:${barInSection}`,
  );
  if (barNumber < 0) return null;

  return {
    song: written.song,
    barNumber: barNumber + 1,
    description: `${RUN_FRETS.join("–")} · ${planned.plan.notes.length} nota · ${planned.plan.stepTicks} tick`,
  };
}

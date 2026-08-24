/**
 * Offline renders that measure what a chord actually sounds like (2O-B §25).
 *
 * Evaluation only, and it goes through `renderSongToBuffer` — the same render
 * the WAV export performs — so what is measured is the audio, not a rehearsal
 * of it. Every number below is read off rendered samples.
 *
 * These prove **the right notes sound together, on the right instrument, with
 * the right mix**. They are not evidence that a chord sounds good. That
 * judgement is a human listening, and this file does not pretend to make it.
 */
import {
  guitar,
  bass as bassTrack,
  songOf,
} from "./fixtures";

import { applyChordWrite } from "@/lib/chords/chord-command";
import { auditionSong, auditionVelocity } from "@/lib/chords/chord-audition";
import { chordVoicings, voicingToNotes } from "@/lib/chords/chord-voicing";
import { renderSongToBuffer } from "@/lib/export/render-wav";
import { ticksPerSlot } from "@/lib/music/timing";
import type { ChordArticulation } from "@/lib/chords/chord-command";
import type { ChordQualityId } from "@/lib/chords/chord-formula";
import type { Song, Track } from "@/lib/song/schema";

const EIGHTH = ticksPerSlot(8);

/** The guitar the packs actually have samples for. */
const AUDIBLE_GUITAR = (overrides: Partial<Track> = {}) =>
  guitar({ presetId: "high_gain", volumeDb: 0, ...overrides });

type Case = {
  readonly song: Song;
  /** What the case is about, carried into the artefact. */
  readonly what: string;
};

function chordSong(options: {
  track: Track;
  root: number;
  quality: ChordQualityId;
  withOctave?: boolean;
  articulation?: ChordArticulation;
  velocity?: number;
  voicingIndex?: number;
}): Song {
  const base = songOf([options.track]);
  const found = chordVoicings({
    track: options.track,
    rootPitchClass: options.root,
    quality: options.quality,
    ...(options.withOctave === undefined ? {} : { withOctave: options.withOctave }),
  });
  if (!found.ok) throw new Error(`no voicing: ${options.root} ${options.quality}`);
  const voicing = found.voicings[options.voicingIndex ?? 0];
  if (!voicing) throw new Error("no voicing at index");

  const written = applyChordWrite(base, {
    sectionId: "s1",
    trackId: options.track.id,
    timeTicks: 0,
    durationTicks: EIGHTH * 4,
    voicing,
    velocity: options.velocity ?? 100,
    ...(options.articulation === undefined ? {} : { articulation: options.articulation }),
    mode: "insert",
  });
  if (!written.ok) throw new Error(`refused: ${written.error.code}`);
  return written.song;
}

/** One note, so a chord has something honest to be compared against. */
function singleNoteSong(): Song {
  const track = AUDIBLE_GUITAR();
  const base = songOf([track]);
  const slots = base.sections[0]!.bars[0]!.slots[track.id] as unknown[];
  slots[0] = {
    notes: [{ pitch: "A2", velocity: 100, position: { string: 0, fret: 5 } }],
  };
  for (let index = 1; index < 4; index += 1) slots[index] = "-";
  return base;
}

const CASES: Readonly<Record<string, () => Case>> = {
  "single-note": () => ({ song: singleNoteSong(), what: "one note, the baseline" }),

  "a5-two": () => ({
    song: chordSong({ track: AUDIBLE_GUITAR(), root: 9, quality: "power" }),
    what: "root and fifth",
  }),
  "a5-three": () => ({
    song: chordSong({
      track: AUDIBLE_GUITAR(),
      root: 9,
      quality: "power",
      withOctave: true,
    }),
    what: "root, fifth and the octave",
  }),

  "am-open": () => ({
    song: chordSong({ track: AUDIBLE_GUITAR(), root: 9, quality: "minor" }),
    what: "A minor, open position",
  }),
  "am7-open": () => ({
    song: chordSong({ track: AUDIBLE_GUITAR(), root: 9, quality: "minor_7" }),
    what: "A minor 7, open position",
  }),
  "am7-fifth": () => ({
    song: chordSong({
      track: AUDIBLE_GUITAR(),
      root: 9,
      quality: "minor_7",
      voicingIndex: 2,
    }),
    what: "A minor 7, around the fifth fret",
  }),

  "power-palm-muted": () => ({
    song: chordSong({
      track: AUDIBLE_GUITAR(),
      root: 9,
      quality: "power",
      articulation: "palm_mute",
    }),
    what: "the same power chord, palm muted",
  }),
  "chord-accent": () => ({
    song: chordSong({
      track: AUDIBLE_GUITAR(),
      root: 9,
      quality: "minor",
      articulation: "accent",
    }),
    what: "A minor, accented",
  }),

  "chord-panned-left": () => ({
    song: chordSong({ track: AUDIBLE_GUITAR({ pan: -1 }), root: 9, quality: "minor" }),
    what: "A minor, hard left",
  }),
  "chord-panned-right": () => ({
    song: chordSong({ track: AUDIBLE_GUITAR({ pan: 1 }), root: 9, quality: "minor" }),
    what: "A minor, hard right",
  }),

  "chord-with-bass": () => {
    const gtr = AUDIBLE_GUITAR();
    const low = bassTrack();
    const withChord = chordSong({ track: gtr, root: 9, quality: "minor" });
    const both: Song = {
      ...withChord,
      tracks: [gtr, low],
      sections: withChord.sections.map((section) => ({
        ...section,
        bars: section.bars.map((bar) => ({
          ...bar,
          slots: {
            ...bar.slots,
            [low.id]: Array.from({ length: 8 }, (_, index) =>
              index === 0
                ? { notes: [{ pitch: "A1", velocity: 100, position: { string: 1, fret: 0 } }] }
                : index < 4
                  ? ("-" as const)
                  : null,
            ),
          },
        })),
      })),
    };
    return { song: both, what: "a chord and another track at the same tick" };
  },

  "audition-chord": () => {
    const track = AUDIBLE_GUITAR();
    const found = chordVoicings({ track, rootPitchClass: 9, quality: "minor" });
    if (!found.ok) throw new Error("no voicing");
    return {
      song: auditionSong(songOf([track]), track, found.voicings[0]!, {
        velocity: 100,
      }),
      what: "what the audition path plays, rendered offline",
    };
  },

  /*
   * The same chord at the level the launch templates actually ship with.
   *
   * Rendered beside `am7-fifth` at 0 dB it separates two different claims: a
   * dense chord *can* be pushed past full scale, and the level a reader is
   * given by default does not do it.
   */
  "am7-fifth-at-minus-6": () => ({
    song: chordSong({
      track: AUDIBLE_GUITAR({ volumeDb: -6 }),
      root: 9,
      quality: "minor_7",
      voicingIndex: 2,
    }),
    what: "the six-note A minor 7 at the templates' own -6 dB",
  }),

  "audition-velocity-unscaled": () => {
    /*
     * The same chord written with the same velocity, but *without* the
     * preview scaling. Rendered beside `audition-chord` it shows what the
     * scaling does — and, read together with the written Song in the unit
     * tests, that it does it only to the preview.
     */
    const track = AUDIBLE_GUITAR();
    const found = chordVoicings({ track, rootPitchClass: 9, quality: "minor" });
    if (!found.ok) throw new Error("no voicing");
    const voicing = found.voicings[0]!;
    const base = songOf([track]);
    const slots = base.sections[0]!.bars[0]!.slots[track.id] as unknown[];
    slots[0] = { notes: voicingToNotes(voicing, { velocity: 100 }) };
    for (let index = 1; index < 8; index += 1) slots[index] = "-";
    return { song: base, what: "the same chord at full written velocity" };
  },
};

export function caseNames(): readonly string[] {
  return Object.keys(CASES);
}

/** What one rendered chord measured. */
export type ChordMeasurement = {
  readonly name: string;
  readonly what: string;
  readonly peak: number;
  readonly rms: number;
  readonly leftRms: number;
  readonly rightRms: number;
  readonly seconds: number;
  /** Every note event in the song, and how many share the first onset. */
  readonly events: number;
  readonly onsetTicks: readonly number[];
  readonly notesOnFirstOnset: number;
  readonly pitches: readonly string[];
  /** Voices still alive after the render disposed its context. */
  readonly activeAfterDispose: number;
};

function energy(channel: Float32Array): { rms: number; peak: number } {
  let sum = 0;
  let peak = 0;
  for (let index = 0; index < channel.length; index += 1) {
    const value = channel[index]!;
    sum += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  return { rms: Math.sqrt(sum / Math.max(1, channel.length)), peak };
}

/** Every struck slot of every melodic track, as ticks from the bar start. */
function onsetsOf(song: Song): { ticks: number[]; events: number; first: string[] } {
  const ticks: number[] = [];
  let events = 0;
  let first: string[] = [];
  for (const section of song.sections) {
    for (const bar of section.bars) {
      const step = ticksPerSlot(bar.resolution);
      for (const slots of Object.values(bar.slots)) {
        (slots as unknown[]).forEach((slot, index) => {
          if (slot === null || slot === "-" || Array.isArray(slot)) return;
          const notes = (slot as { notes: { pitch: string }[] }).notes;
          events += notes.length;
          ticks.push(index * step);
          if (index === 0) first = [...first, ...notes.map((note) => note.pitch)];
        });
      }
    }
  }
  return { ticks: [...new Set(ticks)].sort((a, b) => a - b), events, first };
}

export async function renderChordCase(name: string): Promise<ChordMeasurement> {
  const make = CASES[name];
  if (!make) throw new Error(`unknown case: ${name}`);
  const { song, what } = make();

  const rendered = await renderSongToBuffer(song, {});
  const perChannel = rendered.channels.map(energy);
  const peak = Math.max(...perChannel.map((entry) => entry.peak));
  const rms = Math.sqrt(
    perChannel.reduce((sum, entry) => sum + entry.rms * entry.rms, 0) /
      Math.max(1, perChannel.length),
  );

  const onsets = onsetsOf(song);
  const active =
    (globalThis as { AranjeActiveVoices?: () => number }).AranjeActiveVoices?.() ?? 0;

  return {
    name,
    what,
    peak,
    rms,
    leftRms: perChannel[0]?.rms ?? 0,
    rightRms: perChannel[1]?.rms ?? perChannel[0]?.rms ?? 0,
    seconds: rendered.frames / rendered.sampleRate,
    events: onsets.events,
    onsetTicks: onsets.ticks,
    notesOnFirstOnset: onsets.first.length,
    pitches: onsets.first,
    activeAfterDispose: active,
  };
}

/** The preview scaling, exposed so the harness can report it as a number. */
export function auditionScaling(noteCount: number, velocity: number): number {
  return auditionVelocity(noteCount, velocity);
}

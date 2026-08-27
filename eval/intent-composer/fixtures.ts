/**
 * The songs the 2S-A baseline and the 1/32 investigation measure (§2, §3).
 *
 * Evaluation only. Every fixture is an ordinary Song the schema already
 * accepts: no field is invented here, and nothing in this file is reachable
 * from the interface.
 *
 * The `dense` fixture is the one the reported defect describes, written out
 * exactly as §2 A gives it — 4/4, 132 BPM, `electric_guitar/high_gain`, a
 * 1/32 grid, eight onsets on one string, frets `7,7,7,7,8,7,7,7`, the `8→7`
 * a pull-off, one bar, and the track at its default safe volume. Everything
 * else in this file exists so that fixture can be compared against something.
 */
import { TUNING_PRESETS } from "@/lib/music/fretboard";
import { slotCount } from "@/lib/music/timing";
import { pitchToMidi, midiToPitch } from "@/lib/music/pitch";
import type {
  Articulation,
  Bar,
  MelodicSlot,
  Resolution,
  Section,
  Song,
  TimeSignature,
  Track,
} from "@/lib/song/schema";

const E_STANDARD = TUNING_PRESETS.e_standard!.tuning;
const DROP_D = TUNING_PRESETS.drop_d!.tuning;

/** The track the defect report names: the preset that actually has samples. */
export function guitar(overrides: Partial<Track> = {}): Track {
  return {
    id: "gtr",
    name: "Gitar",
    instrumentId: "electric_guitar",
    presetId: "high_gain",
    // The safe default a new track is created with; not a benchmark level.
    volumeDb: -6,
    fretboard: { tuning: [...E_STANDARD], capo: 0 },
    ...overrides,
  };
}

export function bass(overrides: Partial<Track> = {}): Track {
  return {
    id: "bass",
    name: "Bas",
    instrumentId: "electric_bass",
    presetId: "finger",
    volumeDb: -6,
    fretboard: { tuning: [...TUNING_PRESETS.bass_standard!.tuning], capo: 0 },
    ...overrides,
  };
}

/** The pitch a string/fret pair sounds, capo included, as the fretboard does. */
export function soundingPitch(
  tuning: readonly string[],
  stringIndex: number,
  fret: number,
  capo = 0,
): string {
  const open = tuning[stringIndex];
  if (open === undefined) throw new Error(`no string ${stringIndex}`);
  const midi = pitchToMidi(open);
  if (midi === null) throw new Error(`unreadable string pitch ${open}`);
  return midiToPitch(midi + capo + fret);
}

export type OnsetSpec = {
  readonly fret: number;
  readonly articulation?: Articulation;
  readonly velocity?: number;
};

export type FixtureSpec = {
  readonly name: string;
  readonly bpm: number;
  readonly resolution: Resolution;
  readonly timeSignature: TimeSignature;
  /** Which string the run sits on, 0 = highest. */
  readonly stringIndex: number;
  readonly tuning: readonly string[];
  readonly capo: number;
  readonly onsets: readonly OnsetSpec[];
  /** Onsets start here rather than at slot 0, for the boundary cases. */
  readonly startSlot?: number;
  /** More than one bar, so a run can straddle a bar line. */
  readonly bars?: number;
  /** A second section, so a run can straddle a section seam. */
  readonly sections?: number;
  readonly track?: Track;
};

/**
 * One bar of a single melodic track, onsets laid on consecutive slots.
 *
 * Consecutive on purpose: the defect is about notes that sit one grid step
 * apart, so a fixture that spaced them out would measure a different song.
 */
function barsFor(spec: FixtureSpec): Bar[] {
  const track = spec.track ?? guitar();
  const count = slotCount(spec.timeSignature, spec.resolution);
  const barCount = spec.bars ?? 1;
  const start = spec.startSlot ?? 0;

  const flat: MelodicSlot[] = Array.from(
    { length: count * barCount },
    () => null as MelodicSlot,
  );

  spec.onsets.forEach((onset, index) => {
    const at = start + index;
    if (at >= flat.length) throw new Error(`${spec.name}: onset ${index} past the end`);
    flat[at] = {
      notes: [
        {
          pitch: soundingPitch(spec.tuning, spec.stringIndex, onset.fret, spec.capo),
          position: { string: spec.stringIndex, fret: onset.fret },
          ...(onset.articulation ? { articulation: onset.articulation } : {}),
          ...(onset.velocity !== undefined ? { velocity: onset.velocity } : {}),
        },
      ],
    };
  });

  return Array.from({ length: barCount }, (_, barIndex) => ({
    timeSignature: spec.timeSignature,
    resolution: spec.resolution,
    slots: { [track.id]: flat.slice(barIndex * count, (barIndex + 1) * count) },
  }));
}

export function songFor(spec: FixtureSpec): Song {
  const track = spec.track ?? guitar();
  const withBoard: Track = {
    ...track,
    fretboard: { tuning: [...spec.tuning], capo: spec.capo },
  };
  const bars = barsFor(spec);
  const sectionCount = spec.sections ?? 1;

  const sections: Section[] = Array.from({ length: sectionCount }, (_, index) => ({
    id: `s${index + 1}`,
    name: `Bölüm ${index + 1}`,
    status: "fixed" as const,
    bars:
      index === sectionCount - 1
        ? bars
        : // A leading section of plain rests, so the run under test starts on
          // a section seam rather than at the song's own beginning.
          bars.map((bar) => ({
            ...bar,
            slots: { [withBoard.id]: bar.slots[withBoard.id]!.map(() => null) },
          })),
  }));

  return {
    version: 2,
    title: `2S-A ${spec.name}`,
    bpm: spec.bpm,
    key: "E minor",
    tracks: [withBoard],
    sections,
  };
}

/* ------------------------------------------------------- the reported case */

/** Frets `7,7,7,7,8,7,7,7`, the `8→7` a pull-off (§2 A). */
export const REPORTED_ONSETS: readonly OnsetSpec[] = [
  { fret: 7 },
  { fret: 7 },
  { fret: 7 },
  { fret: 7 },
  { fret: 8 },
  { fret: 7, articulation: "pull_off" },
  { fret: 7 },
  { fret: 7 },
];

/** The same run with no repeated pitch, so "repeat" can be ruled in or out. */
export const ALTERNATING_ONSETS: readonly OnsetSpec[] = [
  { fret: 5 },
  { fret: 7 },
  { fret: 5 },
  { fret: 7 },
  { fret: 8 },
  { fret: 7 },
  { fret: 5 },
  { fret: 7 },
];

/** Eight strikes of one pitch and nothing else. */
export const REPEATED_ONSETS: readonly OnsetSpec[] = Array.from(
  { length: 8 },
  () => ({ fret: 7 }),
);

const BASE = {
  timeSignature: [4, 4] as TimeSignature,
  stringIndex: 2,
  tuning: E_STANDARD,
  capo: 0,
} as const;

/** Exactly what §2 A describes, and the only fixture the report calls "the bug". */
export const REPORTED: FixtureSpec = {
  ...BASE,
  name: "reported-1-32",
  bpm: 132,
  resolution: 32,
  onsets: REPORTED_ONSETS,
};

/** The §3 matrix: grid × tempo × pitch pattern × technique × tuning × place. */
export function matrix(): FixtureSpec[] {
  const out: FixtureSpec[] = [];
  const grids: Resolution[] = [8, 16, 24, 32];
  const tempos = [40, 132, 260];

  for (const resolution of grids) {
    for (const bpm of tempos) {
      out.push({
        ...BASE,
        name: `repeat-${resolution}-${bpm}`,
        bpm,
        resolution,
        onsets: REPEATED_ONSETS,
      });
      out.push({
        ...BASE,
        name: `alternate-${resolution}-${bpm}`,
        bpm,
        resolution,
        onsets: ALTERNATING_ONSETS,
      });
      out.push({
        ...BASE,
        name: `reported-${resolution}-${bpm}`,
        bpm,
        resolution,
        onsets: REPORTED_ONSETS,
      });
    }
  }

  // Techniques, on the grid the defect is reported at.
  const techniques: readonly (Articulation | undefined)[] = [
    undefined,
    "hammer_on",
    "pull_off",
    "slide",
  ];
  for (const articulation of techniques) {
    out.push({
      ...BASE,
      name: `technique-${articulation ?? "plain"}-32`,
      bpm: 132,
      resolution: 32,
      onsets: [
        { fret: 7 },
        { fret: articulation === "pull_off" ? 5 : 9, ...(articulation ? { articulation } : {}) },
        { fret: 7 },
        { fret: 7 },
      ],
    });
  }

  // A chord on one onset: one strike, several notes, same slot.
  out.push({
    ...BASE,
    name: "chord-onset-32",
    bpm: 132,
    resolution: 32,
    onsets: REPEATED_ONSETS,
    track: guitar(),
  });

  // Tunings and capo.
  out.push({ ...BASE, name: "dropd-32", bpm: 132, resolution: 32, tuning: DROP_D, onsets: REPORTED_ONSETS });
  out.push({ ...BASE, name: "capo3-32", bpm: 132, resolution: 32, capo: 3, onsets: REPORTED_ONSETS });

  // The last onset next to a section boundary.
  out.push({
    ...BASE,
    name: "section-seam-32",
    bpm: 132,
    resolution: 32,
    onsets: REPORTED_ONSETS,
    startSlot: slotCount([4, 4], 32) - REPORTED_ONSETS.length,
    sections: 2,
  });

  return out;
}

/* --------------------------------------------- the technique notation slice */

/**
 * Every technique the Song Contract can express, on one string, in two bars.
 *
 * Written out slot by slot rather than through `songFor`, because this is the
 * one fixture that needs rests and a tie: a slur has to be broken before the
 * slides start, and the vibrato has to be held long enough for its length to
 * mean something. Nothing is invented — every value is one the schema already
 * accepts, and `make-fixtures` runs the strict parse and the central validator
 * chain over it before it is written.
 *
 * Bar 1: `5 h 7 h 8 p 7 p 5`, a rest, then `5 / 7 \ 5`, then a half bend, a
 * full bend, and a vibrato held one slot. Bar 2: three palm-muted notes and
 * one open one, so the rail has something to stop before.
 */
export function techniqueShowcase(): Song {
  const track = guitar();
  const stringIndex = 2;
  const at = (fret: number, articulation?: Articulation): MelodicSlot => ({
    notes: [
      {
        pitch: soundingPitch(E_STANDARD, stringIndex, fret, 0),
        position: { string: stringIndex, fret },
        ...(articulation ? { articulation } : {}),
      },
    ],
  });
  const rest: MelodicSlot = null;
  const tie: MelodicSlot = "-";

  const first: MelodicSlot[] = [
    at(5),
    at(7, "hammer_on"),
    at(8, "hammer_on"),
    at(7, "pull_off"),
    at(5, "pull_off"),
    rest,
    at(5),
    at(7, "slide"),
    at(5, "slide"),
    rest,
    at(7, "bend_half"),
    rest,
    at(7, "bend_full"),
    rest,
    at(7, "vibrato"),
    tie,
  ];

  const second: MelodicSlot[] = [
    at(5, "palm_mute"),
    at(5, "palm_mute"),
    at(5, "palm_mute"),
    at(7),
    ...Array.from({ length: 12 }, () => rest),
  ];

  const bar = (slots: MelodicSlot[]): Bar => ({
    timeSignature: [4, 4],
    resolution: 16,
    slots: { [track.id]: slots },
  });

  return {
    version: 2,
    title: "Teknik yazımı",
    bpm: 96,
    key: "E minor",
    tracks: [{ ...track, fretboard: { tuning: [...E_STANDARD], capo: 0 } }],
    sections: [
      {
        id: "s1",
        name: "Bölüm 1",
        status: "fixed",
        bars: [bar(first), bar(second)],
      },
    ],
  };
}

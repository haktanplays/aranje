/**
 * Five two-note figures that differ in one thing only (2T-C §10).
 *
 * The question this checkpoint asks is whether a listener can tell a picked
 * note from a hammer-on and from a pull-off. That question is only
 * answerable if everything except the gesture is held still, so every fixture
 * here has the same tempo, the same velocity, the same tuning, the same
 * preset and pack, the same track volume, the same string and the same two
 * frets. What differs is the articulation on the second note, and nothing
 * else.
 *
 * There are five rather than four because a pull-off descends. Comparing a
 * descending pull-off with an ascending picked pair would mix two changes —
 * the gesture and the direction — into one number, so each legato figure has
 * a picked control going the same way.
 */
import { TUNING_PRESETS } from "@/lib/music/fretboard";
import type { Bar, NoteEvent, Section, Song, Track } from "@/lib/song/schema";

const E_STANDARD = TUNING_PRESETS.e_standard!.tuning;

/** The one string every figure is played on, and the two frets it uses. */
export const STRING_INDEX = 2;
export const LOW = { pitch: "A3", fret: 7 };
export const HIGH = { pitch: "B3", fret: 9 };

export const BPM = 90;
export const VELOCITY = 100;
/** The eighth every figure is written on: 8 slots to a 4/4 bar at 90 BPM. */
export const SLOTS_PER_BAR = 8;

/** The one track. High gain is the preset with samples for this range. */
export function guitar(): Track {
  return {
    id: "gtr",
    name: "Gitar",
    instrumentId: "electric_guitar",
    presetId: "high_gain",
    volumeDb: -6,
    fretboard: { tuning: [...E_STANDARD], capo: 0 },
  };
}

const note = (
  where: { pitch: string; fret: number },
  articulation?: NoteEvent["articulation"],
): NoteEvent => ({
  pitch: where.pitch,
  velocity: VELOCITY,
  position: { string: STRING_INDEX, fret: where.fret },
  ...(articulation === undefined ? {} : { articulation }),
});

/**
 * The first note on beat one, the second on beat two, the rest of the bar
 * left to ring.
 *
 * The second note starts exactly one beat in — 0.666 s at 90 BPM — which is
 * where every measurement looks for the transition. Ties fill the bar so the
 * second note has room to be heard rather than being cut by the bar line.
 */
function figure(
  first: NoteEvent,
  second: NoteEvent,
  /** Slots the first note is held for before the second arrives. */
  hold: number,
): Bar {
  const slots = [
    { notes: [first] },
    ...Array.from({ length: hold - 1 }, () => "-" as const),
    { notes: [second] },
    ...Array.from({ length: SLOTS_PER_BAR - hold - 1 }, () => "-" as const),
  ];
  return { timeSignature: [4, 4], resolution: SLOTS_PER_BAR, slots: { gtr: slots } };
}

function songOf(title: string, bar: Bar): Song {
  const section: Section = { id: "s1", name: "Bölüm 1", status: "fixed", bars: [bar] };
  return {
    /*
     * Version 2, deliberately. These fixtures use nothing the later versions
     * added, so the same file measures the same music on either side of the
     * contract bump — which is the whole point of a baseline.
     */
    version: 2,
    title,
    bpm: BPM,
    key: "E minor",
    tracks: [guitar()],
    sections: [section],
  };
}

export type Fixture = {
  readonly name: string;
  /** What a reader would call it, in Turkish. */
  readonly what: string;
  readonly song: Song;
  /** When the second note is written, in seconds. */
  readonly transitionSeconds: number;
  /** The pitch the second note is written at. */
  readonly targetPitch: string;
  readonly fromPitch: string;
};

const beat = 60 / BPM;

export const FIXTURES: readonly Fixture[] = [
  {
    name: "pick-up",
    what: "iki ayrı mızrap vuruşu, çıkarak",
    song: songOf("Mızrap (çıkan)", figure(note(LOW), note(HIGH), 2)),
    transitionSeconds: beat,
    fromPitch: LOW.pitch,
    targetPitch: HIGH.pitch,
  },
  {
    name: "pick-down",
    what: "iki ayrı mızrap vuruşu, inerek",
    song: songOf("Mızrap (inen)", figure(note(HIGH), note(LOW), 2)),
    transitionSeconds: beat,
    fromPitch: HIGH.pitch,
    targetPitch: LOW.pitch,
  },
  {
    name: "hammer-on",
    what: "aynı iki nota, ikincisi hammer-on",
    song: songOf("Hammer-on", figure(note(LOW), note(HIGH, "hammer_on"), 2)),
    transitionSeconds: beat,
    fromPitch: LOW.pitch,
    targetPitch: HIGH.pitch,
  },
  {
    name: "pull-off",
    what: "aynı iki nota, ikincisi pull-off",
    song: songOf("Pull-off", figure(note(HIGH), note(LOW, "pull_off"), 2)),
    transitionSeconds: beat,
    fromPitch: HIGH.pitch,
    targetPitch: LOW.pitch,
  },
  {
    name: "slide",
    what: "aynı iki nota, ikincisine slide",
    song: songOf("Slide", figure(note(LOW), note(HIGH, "slide"), 2)),
    transitionSeconds: beat,
    fromPitch: LOW.pitch,
    targetPitch: HIGH.pitch,
  },
];

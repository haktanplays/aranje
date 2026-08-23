/**
 * Offline renders that measure what the mixer actually does to the sound
 * (spec 13.18, 2L-C §8). Evaluation only — nothing here is reachable from
 * the app.
 *
 * The same engine, the same scheduler, the same samples and the same
 * `setTrackAudibility` the running app uses; the only thing that differs is
 * the context, which `Tone.Offline` supplies. Every case renders a tiny song
 * and reports peak and RMS per channel, so a claim about a level or a
 * stereo position is a number rather than an impression.
 *
 * These are gain/pan/audibility correctness measurements. They are **not**
 * evidence of mix quality, and nothing here should be read as such.
 */
import * as Tone from "tone";

import {
  createEngine,
  scheduleSong,
  setTrackAudibility,
  type Engine,
} from "@/lib/audio/engine";
import { buildTempoMap } from "@/lib/audio/tempo";
import { songSchema, type Song, type Track } from "@/lib/song/schema";

const GUITAR_TUNING = ["E2", "A2", "D3", "G3", "B3", "E4"];
const BASS_TUNING = ["E1", "A1", "D2", "G2"];

function guitar(overrides: Partial<Track> = {}): Track {
  return {
    id: "gtr",
    name: "Gitar",
    instrumentId: "electric_guitar",
    presetId: "high_gain",
    volumeDb: 0,
    fretboard: { tuning: [...GUITAR_TUNING], capo: 0 },
    ...overrides,
  } as Track;
}

function bass(overrides: Partial<Track> = {}): Track {
  return {
    id: "bass",
    name: "Bas",
    instrumentId: "electric_bass",
    presetId: "finger",
    volumeDb: 0,
    fretboard: { tuning: [...BASS_TUNING], capo: 0 },
    ...overrides,
  } as Track;
}

/** One 4/4 bar at 1/8, with whatever each track plays on the downbeat. */
function oneBar(
  tracks: readonly Track[],
  slotsByTrack: Record<string, unknown[]>,
): Song {
  return songSchema.parse({
    version: 2,
    title: "Mikser Ölçümü",
    bpm: 120,
    key: "E minor",
    tracks,
    sections: [
      {
        id: "s1",
        name: "Ölçüm",
        status: "fixed",
        bars: [
          { timeSignature: [4, 4], resolution: 8, slots: slotsByTrack },
        ],
      },
    ],
  });
}

const rest = (count: number) => Array.from({ length: count }, () => null);

/** A single E2 on the low string, then silence. */
const oneNote = () => [
  { notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }] },
  ...rest(7),
];

/** An E5 shape: two notes in one slot, so a chord shares one track's pan. */
const chord = () => [
  {
    notes: [
      { pitch: "E2", position: { string: 0, fret: 0 } },
      { pitch: "B2", position: { string: 1, fret: 2 } },
    ],
  },
  ...rest(7),
];

/** A hammer-on: the second note is played by the expressive layer. */
const hammered = () => [
  { notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }] },
  {
    notes: [
      { pitch: "G2", position: { string: 0, fret: 3 }, articulation: "hammer_on" },
    ],
  },
  ...rest(6),
];

const bassNote = () => [
  { notes: [{ pitch: "E1", position: { string: 0, fret: 0 } }] },
  ...rest(7),
];

export type MixMeasurement = {
  readonly name: string;
  readonly peak: number;
  readonly rms: number;
  readonly leftRms: number;
  readonly rightRms: number;
  readonly channels: number;
  /** How many engines this render built, and how many URLs it asked for. */
  readonly builds: number;
  readonly fetchedUrls: number;
  /** Voices still sounding after dispose. */
  readonly activeAfterDispose: number;
  readonly diagnostics: unknown;
};

type Case = {
  song: Song;
  /** Session audition, applied to the graph exactly as the app applies it. */
  audible?: readonly string[];
  metronome?: boolean;
};

const CASES: Readonly<Record<string, () => Case>> = {
  "level-0": () => ({
    song: oneBar([guitar({ volumeDb: 0 })], { gtr: oneNote() }),
  }),
  "level--6": () => ({
    song: oneBar([guitar({ volumeDb: -6 })], { gtr: oneNote() }),
  }),
  "level--12": () => ({
    song: oneBar([guitar({ volumeDb: -12 })], { gtr: oneNote() }),
  }),
  "pan-centre": () => ({
    song: oneBar([guitar({ pan: 0 })], { gtr: oneNote() }),
  }),
  "pan-left": () => ({
    song: oneBar([guitar({ pan: -1 })], { gtr: oneNote() }),
  }),
  "pan-right": () => ({
    song: oneBar([guitar({ pan: 1 })], { gtr: oneNote() }),
  }),
  "two-tracks-split": () => ({
    song: oneBar([guitar({ pan: -1 }), bass({ pan: 1 })], {
      gtr: oneNote(),
      bass: bassNote(),
    }),
  }),
  "chord-shares-pan": () => ({
    song: oneBar([guitar({ pan: -1 })], { gtr: chord() }),
  }),
  "expressive-shares-mix": () => ({
    song: oneBar([guitar({ pan: -1, volumeDb: -6 })], { gtr: hammered() }),
  }),
  "expressive-plain": () => ({
    song: oneBar([guitar({ pan: -1, volumeDb: -6 })], { gtr: oneNote() }),
  }),
  "both-audible": () => ({
    song: oneBar([guitar(), bass()], { gtr: oneNote(), bass: bassNote() }),
    audible: ["gtr", "bass"],
  }),
  "session-mute-guitar": () => ({
    song: oneBar([guitar(), bass()], { gtr: oneNote(), bass: bassNote() }),
    audible: ["bass"],
  }),
  "session-solo-guitar": () => ({
    song: oneBar([guitar(), bass()], { gtr: oneNote(), bass: bassNote() }),
    audible: ["gtr"],
  }),
  "all-muted": () => ({
    song: oneBar([guitar(), bass()], { gtr: oneNote(), bass: bassNote() }),
    audible: [],
  }),
  "all-muted-with-metronome": () => ({
    song: oneBar([guitar(), bass()], { gtr: oneNote(), bass: bassNote() }),
    audible: [],
    metronome: true,
  }),
};

export function caseNames(): readonly string[] {
  return Object.keys(CASES);
}

export async function renderMixCase(name: string): Promise<MixMeasurement> {
  const build = CASES[name];
  if (!build) throw new Error(`unknown case: ${name}`);
  const { song, audible, metronome = false } = build();

  let builds = 0;
  let fetchedUrls = 0;
  let activeAfterDispose = -1;
  let diagnostics: unknown = null;

  /*
   * One graph, one render. The engine is kept so the teardown can be measured
   * *after* the buffer resolves: disposing it while the transport still had
   * events to fire would silence a sampler mid-render and prove nothing about
   * a live engine being torn down.
   */
  let built: Engine | null = null;

  const buffer = await Tone.Offline(async (context) => {
    const engine = await createEngine(song, context);
    built = engine;
    builds += 1;
    fetchedUrls = engine.expression.fetchedUrls;
    diagnostics = {
      expectedBuffers: engine.expectedBuffers,
      loadedBuffers: engine.loadedBuffers,
    };

    scheduleSong(engine, buildTempoMap(song), {
      metronomeEnabled: () => metronome,
    });

    // The session audition, through the very function the app calls.
    if (audible !== undefined) setTrackAudibility(engine, audible);

    context.transport.start(0);
  }, buildTempoMap(song).totalSeconds + 2.5);

  const raw = buffer.toArray() as Float32Array | Float32Array[];
  const channels = Array.isArray(raw) ? raw : [raw];

  const energy = (channel: Float32Array) => {
    let sum = 0;
    let peak = 0;
    for (const value of channel) {
      sum += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    return { rms: Math.sqrt(sum / Math.max(1, channel.length)), peak };
  };

  const perChannel = channels.map(energy);
  const peak = Math.max(...perChannel.map((entry) => entry.peak));
  const rms = Math.sqrt(
    perChannel.reduce((sum, entry) => sum + entry.rms * entry.rms, 0) /
      Math.max(1, perChannel.length),
  );

  // The render is over; now tear the graph down and see what is left.
  const engine = built as Engine | null;
  if (engine) {
    engine.expression.stopAll();
    engine.dispose();
    activeAfterDispose = engine.expression.counts.active;
  }

  return {
    name,
    peak: Number(peak.toFixed(6)),
    rms: Number(rms.toFixed(6)),
    leftRms: Number((perChannel[0]?.rms ?? 0).toFixed(6)),
    rightRms: Number((perChannel[1]?.rms ?? perChannel[0]?.rms ?? 0).toFixed(6)),
    channels: channels.length,
    builds,
    fetchedUrls,
    activeAfterDispose,
    diagnostics,
  };
}

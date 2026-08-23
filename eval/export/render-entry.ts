/**
 * Offline renders that measure what a WAV export actually contains
 * (spec 13.19, 2M-A §6, §16, §17). Evaluation only — nothing here is
 * reachable from the app.
 *
 * These go through `renderSongToBuffer` and `encodeWav` — the very functions
 * the export button calls — so what is measured is the file, not a rehearsal
 * of it. Every claim about level, stereo position, articulation or scope is a
 * number read off the rendered samples and off the encoded header.
 *
 * They are gain/pan/audibility/format correctness measurements. They are
 * **not** evidence of mix quality, and nothing here should be read as such.
 */
import { renderSongToBuffer } from "@/lib/export/render-wav";
import { encodeWav } from "@/lib/export/wav-encoder";
import { estimateWav, renderDuration } from "@/lib/export/export-plan";
import { audibleTrackIds, EMPTY_AUDITION, setTrackMuted, setTrackSoloed } from "@/lib/song/track-mix";
import { songSchema, type Song, type Track } from "@/lib/song/schema";
import {
  heaviestEventSong,
  longestDurationSong,
} from "../shared/export-worst-case";

const GUITAR = ["E2", "A2", "D3", "G3", "B3", "E4"];
const BASS = ["E1", "A1", "D2", "G2"];

function guitar(overrides: Partial<Track> = {}): Track {
  return {
    id: "gtr",
    name: "Gitar",
    instrumentId: "electric_guitar",
    presetId: "high_gain",
    volumeDb: 0,
    fretboard: { tuning: [...GUITAR], capo: 0 },
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
    fretboard: { tuning: [...BASS], capo: 0 },
    ...overrides,
  } as Track;
}

const rest = (count: number) => Array.from({ length: count }, () => null);

const oneNote = () => [
  { notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }] },
  ...rest(7),
];

const bassNote = () => [
  { notes: [{ pitch: "E1", position: { string: 0, fret: 0 } }] },
  ...rest(7),
];

/** A note held over the bar line, to prove the tail does not cut it off. */
const heldToTheEnd = () => [
  ...rest(7),
  { notes: [{ pitch: "E2", position: { string: 0, fret: 0 }, articulation: "sustain" }] },
];

const hammered = () => [
  { notes: [{ pitch: "E2", position: { string: 0, fret: 0 } }] },
  {
    notes: [
      { pitch: "G2", position: { string: 0, fret: 3 }, articulation: "hammer_on" },
    ],
  },
  ...rest(6),
];

function build(
  tracks: readonly Track[],
  slotsByTrack: Record<string, unknown[]>,
  options: {
    timeSignature?: [number, number];
    resolution?: number;
    bpm?: number;
    bars?: number;
    bpmOverride?: number;
  } = {},
): Song {
  const {
    timeSignature = [4, 4],
    resolution = 8,
    bpm = 120,
    bars = 1,
    bpmOverride,
  } = options;
  return songSchema.parse({
    version: 2,
    title: "Export Olcumu",
    bpm,
    key: "E minor",
    tracks,
    sections: [
      {
        id: "s1",
        name: "Olcum",
        status: "fixed",
        ...(bpmOverride === undefined ? {} : { bpmOverride }),
        bars: Array.from({ length: bars }, (_, index) => ({
          timeSignature,
          resolution,
          slots: index === 0 ? slotsByTrack : {},
        })),
      },
    ],
  });
}

export type ExportMeasurement = {
  readonly name: string;
  readonly peak: number;
  readonly rms: number;
  readonly leftRms: number;
  readonly rightRms: number;
  readonly channels: number;
  readonly sampleRate: number;
  readonly frames: number;
  readonly seconds: number;
  /** Where the last written note ends, and how long the file runs. */
  readonly notatedSeconds: number;
  readonly tailSeconds: number;
  /** Energy in the final second: a decay that finished inside the file. */
  readonly lastSecondRms: number;
  /**
   * Energy *after* the notated end.
   *
   * The claim that matters for the tail: a file merely being long proves
   * nothing, because silence is long too. Sound in this window is what shows
   * the decay of the last note was captured rather than chopped at the bar.
   */
  readonly tailRms: number;
  readonly activeAfterDispose: number;
  /**
   * What the pre-flight estimate predicted, beside what was rendered.
   *
   * The estimate rounds the frame count up, so the size a user is shown is
   * never smaller than the file they get; the render may land one frame
   * short of it. Reported as two numbers rather than one, because "the
   * estimate is the file" is only true to within that rounding.
   */
  readonly estimatedFrames: number;
  readonly estimatedBytes: number;
  /** The encoded file, read back from its own header. */
  readonly wavBytes: number;
  readonly wavChannels: number;
  readonly wavSampleRate: number;
  readonly wavBitDepth: number;
  readonly wavDataBytes: number;
  readonly headerMatchesFile: boolean;
  /** How long `encodeWav` took, apart from the render. */
  readonly encodeMillis: number;
  /**
   * A JS heap reading either side of the encode, when the browser exposes it.
   *
   * `performance.memory` is Chromium-only and coarse, so it is reported as
   * what it is — a controlled desktop observation, not an allocation profile.
   */
  readonly heapBeforeBytes: number | null;
  readonly heapAfterBytes: number | null;
};

type Case = {
  song: Song;
  /** Passed only when the case is exercising "Şu anda duyduklarım". */
  audible?: readonly string[];
};

const twoTrackSong = () =>
  build([guitar(), bass()], { gtr: oneNote(), bass: bassNote() });

const muteGuitar = () => {
  const song = twoTrackSong();
  return {
    song,
    audible: audibleTrackIds(song, setTrackMuted(EMPTY_AUDITION, "gtr", true)),
  };
};

const soloGuitar = () => {
  const song = twoTrackSong();
  return {
    song,
    audible: audibleTrackIds(song, setTrackSoloed(EMPTY_AUDITION, "gtr", true)),
  };
};

const CASES: Readonly<Record<string, () => Case>> = {
  /* Level: the persisted volume, straight into the file. */
  "level-0": () => ({ song: build([guitar({ volumeDb: 0 })], { gtr: oneNote() }) }),
  "level--6": () => ({ song: build([guitar({ volumeDb: -6 })], { gtr: oneNote() }) }),
  "level--12": () => ({ song: build([guitar({ volumeDb: -12 })], { gtr: oneNote() }) }),

  /* Stereo: the persisted pan, straight into the file. */
  "pan-centre": () => ({ song: build([guitar({ pan: 0 })], { gtr: oneNote() }) }),
  "pan-left": () => ({ song: build([guitar({ pan: -1 })], { gtr: oneNote() }) }),
  "pan-right": () => ({ song: build([guitar({ pan: 1 })], { gtr: oneNote() }) }),

  /* Articulation is heard, not merely planned. */
  "expressive-hammer": () => ({
    song: build([guitar({ volumeDb: -6 })], { gtr: hammered() }),
  }),
  "expressive-plain": () => ({
    song: build([guitar({ volumeDb: -6 })], { gtr: oneNote() }),
  }),

  /* Scope: the two content choices, and the silence at the end of them. */
  "scope-all-tracks": () => ({ song: twoTrackSong() }),
  "scope-audible-muted-guitar": muteGuitar,
  "scope-audible-solo-guitar": soloGuitar,
  "scope-all-muted": () => ({ song: twoTrackSong(), audible: [] }),

  /*
   * The legacy contract flags, on a track that must still be heard, and with
   * *no* audition passed: a full-mix export must ignore them (2M-A §0).
   */
  "legacy-flags-full-mix": () => ({
    song: build([guitar({ muted: true, soloed: true } as Partial<Track>)], {
      gtr: oneNote(),
    }),
  }),

  /* Metres and tempo, so the file's length is the song's length. */
  "meter-3-4": () => ({
    song: build([guitar()], { gtr: [...oneNote()].slice(0, 6) }, {
      timeSignature: [3, 4],
      bars: 2,
    }),
  }),
  "meter-7-8": () => ({
    song: build([guitar()], { gtr: [...oneNote()].slice(0, 7) }, {
      timeSignature: [7, 8],
      bars: 2,
    }),
  }),
  "meter-6-8": () => ({
    song: build([guitar()], { gtr: [...oneNote()].slice(0, 6) }, {
      timeSignature: [6, 8],
      bars: 2,
    }),
  }),
  "tempo-section-override": () => ({
    song: build([guitar()], { gtr: oneNote() }, { bpm: 120, bpmOverride: 60, bars: 2 }),
  }),

  /* A note that rings into the tail: the file must not cut it. */
  "tail-held-note": () => ({
    song: build([guitar()], { gtr: heldToTheEnd() }),
  }),

  /*
   * The two real worst cases (2M-A.1 §2), derived from the product's limits
   * rather than from whatever a fixture happened to be set to.
   *
   * They are separate because the pressures are: one is the longest file the
   * app can produce (slowest tempo, longest bars — bytes and memory), the
   * other is the heaviest event load (every track, finest grid, real legato —
   * scheduler and voice pool). Rendering only one of them and calling the
   * result "worst case" is how a wrong number gets reported.
   */
  "worst-longest-duration": () => ({ song: longestDurationSong() }),
  "worst-heaviest-events": () => ({ song: heaviestEventSong() }),
};

export function caseNames(): readonly string[] {
  return Object.keys(CASES);
}

/** Chromium's coarse heap reading, or null where the browser has none. */
function readHeap(): number | null {
  const memory = (performance as { memory?: { usedJSHeapSize?: number } }).memory;
  return typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : null;
}

export async function renderExportCase(name: string): Promise<ExportMeasurement> {
  const make = CASES[name];
  if (!make) throw new Error(`unknown case: ${name}`);
  const { song, audible } = make();
  const heapBefore = readHeap();

  const rendered = await renderSongToBuffer(
    song,
    audible === undefined ? {} : { audibleTrackIds: audible },
  );

  const energy = (channel: Float32Array, from = 0) => {
    let sum = 0;
    let peak = 0;
    for (let index = from; index < channel.length; index += 1) {
      const value = channel[index]!;
      sum += value * value;
      peak = Math.max(peak, Math.abs(value));
    }
    const count = Math.max(1, channel.length - from);
    return { rms: Math.sqrt(sum / count), peak };
  };

  const perChannel = rendered.channels.map((channel) => energy(channel));
  const peak = Math.max(...perChannel.map((entry) => entry.peak));
  const rms = Math.sqrt(
    perChannel.reduce((sum, entry) => sum + entry.rms * entry.rms, 0) /
      Math.max(1, perChannel.length),
  );

  const lastSecondFrom = Math.max(0, rendered.frames - rendered.sampleRate);
  const lastSecond = rendered.channels.map((channel) =>
    energy(channel, lastSecondFrom),
  );
  const lastSecondRms = Math.sqrt(
    lastSecond.reduce((sum, entry) => sum + entry.rms * entry.rms, 0) /
      Math.max(1, lastSecond.length),
  );

  const duration0 = renderDuration(song);
  const tailFrom = Math.min(
    rendered.frames,
    Math.floor(duration0.notatedSeconds * rendered.sampleRate),
  );
  const tailChannels = rendered.channels.map((channel) => energy(channel, tailFrom));
  const tailRms = Math.sqrt(
    tailChannels.reduce((sum, entry) => sum + entry.rms * entry.rms, 0) /
      Math.max(1, tailChannels.length),
  );

  /* The real encoder, timed separately from the render it follows. */
  const encodeStarted = performance.now();
  const encoded = encodeWav({
    channels: rendered.channels,
    sampleRate: rendered.sampleRate,
  });
  const encodeMillis = performance.now() - encodeStarted;
  if (!encoded.ok) throw new Error(`encode refused: ${encoded.code}`);
  const view = new DataView(
    encoded.bytes.buffer,
    encoded.bytes.byteOffset,
    encoded.bytes.byteLength,
  );
  const dataBytes = view.getUint32(40, true);

  const duration = renderDuration(song);
  const estimate = estimateWav(song);
  const round = (value: number) => Number(value.toFixed(6));

  return {
    name,
    peak: round(peak),
    rms: round(rms),
    leftRms: round(perChannel[0]?.rms ?? 0),
    rightRms: round(perChannel[1]?.rms ?? perChannel[0]?.rms ?? 0),
    channels: rendered.channels.length,
    sampleRate: rendered.sampleRate,
    frames: rendered.frames,
    seconds: round(rendered.frames / rendered.sampleRate),
    notatedSeconds: round(duration.notatedSeconds),
    tailSeconds: duration.tailSeconds,
    lastSecondRms: round(lastSecondRms),
    tailRms: round(tailRms),
    activeAfterDispose: rendered.activeAfterDispose,
    wavBytes: encoded.bytes.length,
    wavChannels: view.getUint16(22, true),
    wavSampleRate: view.getUint32(24, true),
    wavBitDepth: view.getUint16(34, true),
    wavDataBytes: dataBytes,
    headerMatchesFile: dataBytes + 44 === encoded.bytes.length,
    estimatedFrames: estimate.frames,
    estimatedBytes: estimate.bytes,
    encodeMillis: Number(encodeMillis.toFixed(1)),
    heapBeforeBytes: heapBefore,
    heapAfterBytes: readHeap(),
  };
}

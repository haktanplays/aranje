/**
 * Offline renders that measure what a chord costs in headroom (2O-B.1 §4,
 * §5).
 *
 * Evaluation only, and every render goes through `renderSongToBuffer` — the
 * same one the WAV export performs — so what is measured is the audio a
 * reader would receive rather than a rehearsal of it.
 *
 * Two things are deliberately kept apart. Everything **before** the gain
 * comparison is what production does today, unchanged. The four gain
 * approaches are applied here, to the rendered floats, and reach no
 * production code at all: this file may not decide what an export sounds
 * like, only report what four candidates would do to it.
 */
import {
  bass,
  chordOn,
  drums,
  guitar,
  silentGuitar,
  voicingNoteCount,
} from "./fixtures";

import { silentTracks } from "@/lib/audio/preset-availability";
import { audioExportLimits } from "@/lib/limits";
import { chordPreviewLimits } from "@/lib/limits";
import { encodeWav } from "@/lib/export/wav-encoder";
import { renderSongToBuffer } from "@/lib/export/render-wav";
import { materializeTemplate } from "@/lib/song/song-templates";
import type { Song, Track } from "@/lib/song/schema";

/* --------------------------------------------------------------- measuring */

const dbfs = (linear: number): number =>
  linear <= 0 ? -Infinity : 20 * Math.log10(linear);

function energy(channel: Float32Array): { peak: number; rms: number } {
  let sum = 0;
  let peak = 0;
  for (let index = 0; index < channel.length; index += 1) {
    const value = channel[index]!;
    sum += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, channel.length)) };
}

/**
 * What the 16-bit encoder would do to these floats.
 *
 * Counted here rather than inferred: a sample at or past ±1 is clamped by
 * `toInt16`, and today nothing anywhere reports that it happened. "Clipped
 * frames" counts positions where *either* channel clipped, because that is
 * the number of moments the listener hears, not the number of samples.
 */
function clipping(channels: readonly Float32Array[]): {
  clippedSamples: number;
  clippedFrames: number;
  overFullScaleSamples: number;
  peak: number;
} {
  const frames = channels[0]?.length ?? 0;
  let clippedSamples = 0;
  let clippedFrames = 0;
  let overFullScaleSamples = 0;
  let peak = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    let frameClipped = false;
    for (const channel of channels) {
      const value = Math.abs(channel[frame] ?? 0);
      peak = Math.max(peak, value);
      if (value >= 1) {
        clippedSamples += 1;
        frameClipped = true;
      }
      // Sitting *exactly* at full scale is not damage — the encoder maps it
      // to the end of the type, which is what full scale means. Going past
      // it is: that is the sample whose shape is lost.
      if (value > 1) overFullScaleSamples += 1;
    }
    if (frameClipped) clippedFrames += 1;
  }
  return { clippedSamples, clippedFrames, overFullScaleSamples, peak };
}

/** The peak the encoded PCM actually carries, read back out of the bytes. */
function encodedPeak(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let peak = 0;
  for (let offset = 44; offset + 1 < bytes.byteLength; offset += 2) {
    const sample = view.getInt16(offset, true);
    peak = Math.max(peak, Math.abs(sample) / 32767);
  }
  return peak;
}

/* -------------------------------------------------- the four gain approaches */

type Channels = readonly Float32Array[];

const scaled = (channels: Channels, gain: number): Float32Array[] =>
  channels.map((channel) => {
    const out = new Float32Array(channel.length);
    for (let i = 0; i < channel.length; i += 1) out[i] = channel[i]! * gain;
    return out;
  });

/**
 * Equal-power attenuation by how many notes are sounding.
 *
 * The same shape the chord *preview* already uses: below the reference number
 * of voices nothing is touched, and above it the level comes down. Power, not
 * amplitude, so two voices are not halved.
 */
function equalPowerGain(noteCount: number): number {
  const reference = chordPreviewLimits.referenceVoices;
  return Math.sqrt(Math.min(1, reference / Math.max(1, noteCount)));
}

/** Bring the loudest sample to a target, whatever it started at. */
function peakNormalized(channels: Channels, targetDb = -1): Float32Array[] {
  const peak = Math.max(...channels.map((channel) => energy(channel).peak));
  if (peak <= 0) return channels.map((channel) => new Float32Array(channel));
  return scaled(channels, Math.pow(10, targetDb / 20) / peak);
}

/**
 * A soft knee above a threshold, instead of a wall at ±1.
 *
 * `tanh` on the part above the threshold, so nothing ever exceeds the ceiling
 * and the curve is continuous — which is the whole argument for a limiter
 * over a clamp. The ceiling is −0.1 dBFS rather than 1.0 on purpose: a curve
 * that only *approaches* full scale still lands on exactly 1.0 once it is
 * written into 32-bit floats, so a limiter aimed at the very top produces
 * samples the encoder clamps anyway.
 *
 * What it costs is measured, not assumed: the transient comparison below
 * reads the first milliseconds of the attack.
 */
function softLimited(channels: Channels, threshold = 0.7, ceiling = 0.9886): Float32Array[] {
  const room = ceiling - threshold;
  return channels.map((channel) => {
    const out = new Float32Array(channel.length);
    for (let i = 0; i < channel.length; i += 1) {
      const value = channel[i]!;
      const magnitude = Math.abs(value);
      out[i] =
        magnitude <= threshold
          ? value
          : Math.sign(value) * (threshold + room * Math.tanh((magnitude - threshold) / room));
    }
    return out;
  });
}

/** Peak of the first `ms` after the loudest sample: what an attack looks like. */
function attackEnergy(channels: Channels, sampleRate: number, ms = 10): number {
  const window = Math.round((ms / 1000) * sampleRate);
  const first = channels[0];
  if (!first) return 0;
  let onset = 0;
  let best = 0;
  for (let i = 0; i < first.length; i += 1) {
    const value = Math.abs(first[i]!);
    if (value > best) {
      best = value;
      onset = i;
    }
  }
  let sum = 0;
  let count = 0;
  for (let i = onset; i < Math.min(first.length, onset + window); i += 1) {
    sum += first[i]! * first[i]!;
    count += 1;
  }
  return Math.sqrt(sum / Math.max(1, count));
}

type GainReport = {
  readonly approach: string;
  readonly what: string;
  readonly peak: number;
  readonly peakDbfs: number;
  readonly rms: number;
  readonly clippedSamples: number;
  readonly clippedFrames: number;
  readonly overFullScaleSamples: number;
  /** RMS of the ten milliseconds from the loudest sample on. */
  readonly attackRms: number;
  /** How much of the attack survived, against the raw mix. */
  readonly attackRatioVsRaw: number;
};

function compareGainApproaches(
  channels: Channels,
  sampleRate: number,
  noteCount: number,
): readonly GainReport[] {
  const rawAttack = attackEnergy(channels, sampleRate);
  const candidates: { approach: string; what: string; channels: Float32Array[] }[] = [
    {
      approach: "raw_mix",
      what: "bugünkü davranış: hiçbir şey uygulanmıyor",
      channels: channels.map((channel) => new Float32Array(channel)),
    },
    {
      approach: "equal_power_by_note_count",
      what: `nota sayısına bağlı equal-power (${noteCount} nota → ×${equalPowerGain(noteCount).toFixed(4)})`,
      channels: scaled(channels, equalPowerGain(noteCount)),
    },
    {
      approach: "peak_normalized_minus_1dbfs",
      what: "offline peak normalization, hedef −1 dBFS",
      channels: peakNormalized(channels),
    },
    {
      approach: "soft_limiter_0.7_ceiling_-0.1dbfs",
      what: "0.7 üstünde tanh yumuşak diz, tavan −0.1 dBFS",
      channels: softLimited(channels),
    },
  ];

  return candidates.map((candidate) => {
    const clip = clipping(candidate.channels);
    const perChannel = candidate.channels.map(energy);
    const rms = Math.sqrt(
      perChannel.reduce((sum, entry) => sum + entry.rms * entry.rms, 0) /
        Math.max(1, perChannel.length),
    );
    const attackRms = attackEnergy(candidate.channels, sampleRate);
    return {
      approach: candidate.approach,
      what: candidate.what,
      peak: clip.peak,
      peakDbfs: dbfs(clip.peak),
      rms,
      clippedSamples: clip.clippedSamples,
      clippedFrames: clip.clippedFrames,
      overFullScaleSamples: clip.overFullScaleSamples,
      attackRms,
      attackRatioVsRaw: rawAttack > 0 ? attackRms / rawAttack : 0,
    };
  });
}

/* ------------------------------------------------------------- the fixtures */

type HeadroomCase = {
  readonly what: string;
  readonly song: Song;
  /** Notes sounding on the first onset, for the note-count approach. */
  readonly noteCount: number;
  /** Track to render alone as well, when the mix has more than one. */
  readonly isolateTrackId?: string;
};

const AT = (volumeDb: number): Track => guitar({ volumeDb });

const minorSeventhAt = (volumeDb: number, voicingIndex: number): HeadroomCase => ({
  what: `altı sesli Am7, track ${volumeDb} dB`,
  song: chordOn(AT(volumeDb), { root: 9, quality: "minor_7", voicingIndex }),
  noteCount: voicingNoteCount(AT(volumeDb), 9, "minor_7", { voicingIndex }),
});

const HEADROOM: Readonly<Record<string, () => HeadroomCase>> = {
  "power-two": () => ({
    what: "iki sesli power chord, −6 dB",
    song: chordOn(AT(-6), { root: 9, quality: "power" }),
    noteCount: voicingNoteCount(AT(-6), 9, "power"),
  }),
  "power-three": () => ({
    what: "üç sesli power chord, −6 dB",
    song: chordOn(AT(-6), { root: 9, quality: "power", withOctave: true }),
    noteCount: voicingNoteCount(AT(-6), 9, "power", { withOctave: true }),
  }),
  "minor-triad": () => ({
    what: "üç sesli minör akor, −6 dB",
    song: chordOn(AT(-6), { root: 9, quality: "minor", voicingIndex: 1 }),
    noteCount: voicingNoteCount(AT(-6), 9, "minor", { voicingIndex: 1 }),
  }),
  // G major and C major 7 rather than E major and E major 7: the fixture song
  // is in E minor, and a chord out of key is refused by the same tonality
  // validator a reader's would be. A fixture that has to be forced past a
  // validator is measuring the wrong thing.
  "major-triad": () => ({
    what: "üç sesli majör akor (G), −6 dB",
    song: chordOn(AT(-6), { root: 7, quality: "major", voicingIndex: 1 }),
    noteCount: voicingNoteCount(AT(-6), 7, "major", { voicingIndex: 1 }),
  }),
  "minor-7-four": () => ({
    what: "dört sesli min7, −6 dB",
    song: chordOn(AT(-6), { root: 9, quality: "minor_7", voicingIndex: 1 }),
    noteCount: voicingNoteCount(AT(-6), 9, "minor_7", { voicingIndex: 1 }),
  }),
  "major-7-four": () => ({
    what: "dört sesli maj7 (Cmaj7), −6 dB",
    song: chordOn(AT(-6), { root: 0, quality: "major_7", voicingIndex: 1 }),
    noteCount: voicingNoteCount(AT(-6), 0, "major_7", { voicingIndex: 1 }),
  }),
  "minor-7-open": () => ({
    what: "açık pozisyon Am7, −6 dB",
    song: chordOn(AT(-6), { root: 9, quality: "minor_7" }),
    noteCount: voicingNoteCount(AT(-6), 9, "minor_7"),
  }),
  "minor-7-dense-minus-12": () => minorSeventhAt(-12, 2),
  "minor-7-dense-minus-6": () => minorSeventhAt(-6, 2),
  "minor-7-dense-0": () => minorSeventhAt(0, 2),
  "minor-7-dense-plus-6": () => minorSeventhAt(6, 2),
  "pan-centre": () => ({
    what: "aynı akor, pan merkez",
    song: chordOn(guitar({ volumeDb: -6, pan: 0 }), { root: 9, quality: "minor_7", voicingIndex: 2 }),
    noteCount: voicingNoteCount(AT(-6), 9, "minor_7", { voicingIndex: 2 }),
  }),
  "pan-hard-left": () => ({
    what: "aynı akor, sert sol",
    song: chordOn(guitar({ volumeDb: -6, pan: -1 }), { root: 9, quality: "minor_7", voicingIndex: 2 }),
    noteCount: voicingNoteCount(AT(-6), 9, "minor_7", { voicingIndex: 2 }),
  }),
  "pan-hard-right": () => ({
    what: "aynı akor, sert sağ",
    song: chordOn(guitar({ volumeDb: -6, pan: 1 }), { root: 9, quality: "minor_7", voicingIndex: 2 }),
    noteCount: voicingNoteCount(AT(-6), 9, "minor_7", { voicingIndex: 2 }),
  }),
  "two-guitars": () => {
    const lead = guitar({ id: "gtr2", name: "Gitar 2", volumeDb: -6, pan: 0.6 });
    const song = chordOn(guitar({ volumeDb: -6, pan: -0.6 }), {
      root: 9,
      quality: "minor_7",
      voicingIndex: 2,
    }, [lead]);
    // The second guitar plays the same chord, so this is the honest worst
    // case: two tracks whose peaks land on the same tick.
    const doubled = chordOn(lead, { root: 9, quality: "minor_7", voicingIndex: 2 });
    const leadSlots = doubled.sections[0]!.bars[0]!.slots[lead.id];
    const merged: Song = {
      ...song,
      sections: song.sections.map((section) => ({
        ...section,
        bars: section.bars.map((bar) => ({
          ...bar,
          slots: { ...bar.slots, [lead.id]: leadSlots! },
        })),
      })),
    };
    return {
      what: "aynı anda iki gitar track'i, ikisi de −6 dB",
      song: merged,
      noteCount: voicingNoteCount(AT(-6), 9, "minor_7", { voicingIndex: 2 }) * 2,
      isolateTrackId: "gtr",
    };
  },
  "launch-template-mix": () => {
    const song = materializeTemplate("rock_band")!;
    const track = song.tracks[0]!;
    const withChord = chordOn(
      { ...track, id: "gtr" },
      { root: 9, quality: "minor_7", voicingIndex: 2 },
      [bass(), drums()],
    );
    return {
      what: "varsayılan rock şablonunun mix'i: gitar, bas, davul",
      song: withChord,
      noteCount: voicingNoteCount(AT(-6), 9, "minor_7", { voicingIndex: 2 }),
      isolateTrackId: "gtr",
    };
  },
};

export function headroomCaseNames(): readonly string[] {
  return Object.keys(HEADROOM);
}

export type HeadroomMeasurement = {
  readonly name: string;
  readonly what: string;
  readonly trackVolumesDb: readonly number[];
  readonly noteCount: number;
  readonly seconds: number;
  readonly preEncodePeak: number;
  readonly preEncodePeakDbfs: number;
  readonly postEncodePeak: number;
  readonly clippedSamples: number;
  readonly clippedFrames: number;
  readonly overFullScaleSamples: number;
  readonly rms: number;
  readonly rmsDbfs: number;
  /**
   * Not measured. A trustworthy integrated loudness needs the K-weighting
   * filters of ITU-R BS.1770 at this sample rate, and a number derived from
   * remembered coefficients would be a number nobody could rely on. RMS is
   * reported instead, and is not the same thing.
   */
  readonly integratedLoudnessLufs: null;
  readonly loudnessNote: string;
  /** Peak of the chord's own track rendered alone, when the mix has others. */
  readonly trackPeak: number | null;
  readonly masterPeak: number;
  readonly wavBytes: number;
  readonly wavOk: boolean;
  readonly activeAfterDispose: number;
  readonly gainApproaches: readonly GainReport[];
};

export async function renderHeadroomCase(name: string): Promise<HeadroomMeasurement> {
  const make = HEADROOM[name];
  if (!make) throw new Error(`unknown headroom case: ${name}`);
  const { what, song, noteCount, isolateTrackId } = make();

  const rendered = await renderSongToBuffer(song, {});
  const clip = clipping(rendered.channels);
  const perChannel = rendered.channels.map(energy);
  const rms = Math.sqrt(
    perChannel.reduce((sum, entry) => sum + entry.rms * entry.rms, 0) /
      Math.max(1, perChannel.length),
  );

  const encoded = encodeWav({
    channels: rendered.channels,
    sampleRate: rendered.sampleRate,
  });

  let trackPeak: number | null = null;
  if (isolateTrackId) {
    const alone = await renderSongToBuffer(song, { audibleTrackIds: [isolateTrackId] });
    trackPeak = Math.max(...alone.channels.map((channel) => energy(channel).peak));
  }

  return {
    name,
    what,
    trackVolumesDb: song.tracks.map((track) => track.volumeDb),
    noteCount,
    seconds: rendered.frames / rendered.sampleRate,
    preEncodePeak: clip.peak,
    preEncodePeakDbfs: dbfs(clip.peak),
    postEncodePeak: encoded.ok ? encodedPeak(encoded.bytes) : 0,
    clippedSamples: clip.clippedSamples,
    clippedFrames: clip.clippedFrames,
    overFullScaleSamples: clip.overFullScaleSamples,
    rms,
    rmsDbfs: dbfs(rms),
    integratedLoudnessLufs: null,
    loudnessNote:
      "LUFS ölçülmedi: BS.1770 K-weighting bu örnekleme hızında doğrulanmadan uygulanamaz.",
    trackPeak,
    masterPeak: clip.peak,
    wavBytes: encoded.ok ? encoded.bytes.byteLength : 0,
    wavOk: encoded.ok,
    activeAfterDispose: rendered.activeAfterDispose,
    gainApproaches: compareGainApproaches(rendered.channels, rendered.sampleRate, noteCount),
  };
}

/* -------------------------------------------------- launch template evidence */

export type TemplateAudio = {
  readonly templateId: string;
  readonly tracks: readonly { id: string; instrumentId: string; presetId: string }[];
  readonly silentTrackNames: readonly string[];
  readonly peak: number;
  readonly rms: number;
  readonly perTrackPeak: Readonly<Record<string, number>>;
  readonly activeAfterDispose: number;
};

/**
 * The same song, with one bass note and one kick on the first beat.
 *
 * Written straight into the slots rather than through a command because
 * there is no bass or drum *command* to go through; what is being measured
 * is the engine, and the schema and the validators still have to accept it.
 */
function withAccompaniment(song: Song): Song {
  const bassTrack = song.tracks.find((track) => track.instrumentId === "electric_bass");
  const drumTrack = song.tracks.find((track) => track.instrumentId === "drum_kit");
  if (!bassTrack && !drumTrack) return song;

  return {
    ...song,
    sections: song.sections.map((section) => ({
      ...section,
      bars: section.bars.map((bar) => {
        const slots = { ...bar.slots };
        if (bassTrack) {
          slots[bassTrack.id] = Array.from({ length: 8 }, (_, index) =>
            index === 0
              ? { notes: [{ pitch: "A1", velocity: 100, position: { string: 1, fret: 0 } }] }
              : index < 4
                ? ("-" as const)
                : null,
          );
        }
        if (drumTrack) {
          slots[drumTrack.id] = Array.from({ length: 8 }, (_, index) =>
            index === 0 ? [{ piece: "kick" as const, velocity: 110 }] : [],
          );
        }
        return { ...bar, slots };
      }),
    })),
  };
}

/**
 * A template's own song, with something on **every** track it stands up.
 *
 * A chord on the first track alone would have measured the other tracks as
 * silent and proved nothing about them — an empty lane and a lane with no
 * samples sound identical. So the bass gets a note and the kit gets a hit,
 * and then "every track of this template can be heard" is a claim about the
 * template rather than about which lane happened to carry music.
 */
export async function renderTemplateAudio(templateId: string): Promise<TemplateAudio> {
  const template = materializeTemplate(templateId);
  if (!template) throw new Error(`unknown template: ${templateId}`);
  const first = template.tracks[0]!;
  const song = withAccompaniment(
    chordOn(first, { root: 9, quality: "minor_7", voicingIndex: 0 }, template.tracks.slice(1)),
  );

  const rendered = await renderSongToBuffer(song, {});
  const perTrackPeak: Record<string, number> = {};
  for (const track of song.tracks) {
    const alone = await renderSongToBuffer(song, { audibleTrackIds: [track.id] });
    perTrackPeak[track.id] = Math.max(
      ...alone.channels.map((channel) => energy(channel).peak),
    );
  }
  const perChannel = rendered.channels.map(energy);

  return {
    templateId,
    tracks: song.tracks.map((track) => ({
      id: track.id,
      instrumentId: track.instrumentId,
      presetId: track.presetId,
    })),
    silentTrackNames: silentTracks(song).map((track) => track.name),
    peak: Math.max(...perChannel.map((entry) => entry.peak)),
    rms: Math.sqrt(
      perChannel.reduce((sum, entry) => sum + entry.rms * entry.rms, 0) /
        Math.max(1, perChannel.length),
    ),
    perTrackPeak,
    activeAfterDispose: rendered.activeAfterDispose,
  };
}

/**
 * A track on a preset with no samples, rendered for real.
 *
 * The point is not that it is quiet — it is that the engine says so. A silent
 * success and a reported silence are indistinguishable to a listener and
 * completely different to a reader.
 */
export async function renderMissingPreset(): Promise<{
  peak: number;
  silentTrackNames: readonly string[];
  activeAfterDispose: number;
  otherTrackPeak: number;
}> {
  const song = chordOn(silentGuitar(), { root: 9, quality: "minor_7" }, [bass()]);
  const withBass: Song = {
    ...song,
    sections: song.sections.map((section) => ({
      ...section,
      bars: section.bars.map((bar) => ({
        ...bar,
        slots: {
          ...bar.slots,
          bass: Array.from({ length: 8 }, (_, index) =>
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

  const rendered = await renderSongToBuffer(withBass, {});
  const guitarOnly = await renderSongToBuffer(withBass, { audibleTrackIds: ["gtr"] });
  const bassOnly = await renderSongToBuffer(withBass, { audibleTrackIds: ["bass"] });

  return {
    peak: Math.max(...guitarOnly.channels.map((channel) => energy(channel).peak)),
    silentTrackNames: silentTracks(withBass).map((track) => track.name),
    activeAfterDispose: rendered.activeAfterDispose,
    otherTrackPeak: Math.max(...bassOnly.channels.map((channel) => energy(channel).peak)),
  };
}

/* ---------------------------------------------------------- listening WAVs */

type ListeningCase = { readonly what: string; readonly song: Song };

const LISTENING: Readonly<Record<string, () => ListeningCase>> = {
  "01-new-song-default-guitar": () => {
    const song = materializeTemplate("empty")!;
    return {
      what: "yeni boş şarkının varsayılan gitarı, bir Am7 ile",
      song: chordOn(song.tracks[0]!, { root: 9, quality: "minor_7" }),
    };
  },
  "02-rock-template-rhythm": () => {
    const song = materializeTemplate("rock_band")!;
    return {
      what: "rock şablonunun ritim gitarı, bas ve davulla",
      song: chordOn(song.tracks[0]!, { root: 9, quality: "minor_7" }, song.tracks.slice(1)),
    };
  },
  "03-power-chord-two-note": () => ({
    what: "iki sesli A5",
    song: chordOn(AT(-6), { root: 9, quality: "power" }),
  }),
  "04-power-chord-three-note": () => ({
    what: "üç sesli A5",
    song: chordOn(AT(-6), { root: 9, quality: "power", withOctave: true }),
  }),
  "05-am-open": () => ({
    what: "açık Am",
    song: chordOn(AT(-6), { root: 9, quality: "minor" }),
  }),
  "06-am7-open": () => ({
    what: "açık Am7",
    song: chordOn(AT(-6), { root: 9, quality: "minor_7" }),
  }),
  "07-am7-compact": () => ({
    what: "kompakt Am7 (aramanın ikinci varyasyonu)",
    song: chordOn(AT(-6), { root: 9, quality: "minor_7", voicingIndex: 1 }),
  }),
  "08-am7-barre": () => ({
    what: "beşinci perde civarı Am7",
    song: chordOn(AT(-6), { root: 9, quality: "minor_7", voicingIndex: 2 }),
  }),
  "09-am7-six-voice-minus6": () => ({
    what: "altı sesli Am7, şablonun kendi −6 dB'si",
    song: chordOn(AT(-6), { root: 9, quality: "minor_7", voicingIndex: 2 }),
  }),
  "10-am7-six-voice-0db": () => ({
    what: "aynı altı sesli Am7, 0 dB",
    song: chordOn(AT(0), { root: 9, quality: "minor_7", voicingIndex: 2 }),
  }),
  "11-two-guitars-panned": () => HEADROOM["two-guitars"]!(),
  "12-preview-after-25-switches": () => ({
    // The audio a twenty-sixth audition produces. Rendered offline, so what
    // it proves is that a reused bank still plays the right chord — the
    // request counts themselves are measured in the live browser.
    what: "yirmi beş varyasyon değişiminden sonraki dinleme",
    song: chordOn(AT(-6), { root: 9, quality: "minor_7", voicingIndex: 1 }),
  }),
};

export function listeningCaseNames(): readonly string[] {
  return Object.keys(LISTENING);
}

export type ListeningRender = {
  readonly name: string;
  readonly what: string;
  readonly preset: string;
  readonly samplePack: string;
  readonly notes: readonly string[];
  readonly positions: readonly string[];
  readonly peak: number;
  readonly rms: number;
  readonly clippedSamples: number;
  readonly clippedFrames: number;
  readonly requestedBuffers: number;
  readonly decodedBuffers: number;
  readonly activeAfterDispose: number;
  readonly wavBase64: string;
  readonly wavBytes: number;
};

function firstOnsetNotes(song: Song): {
  notes: string[];
  positions: string[];
} {
  const notes: string[] = [];
  const positions: string[] = [];
  for (const section of song.sections) {
    for (const bar of section.bars) {
      for (const slots of Object.values(bar.slots)) {
        const slot = (slots as unknown[])[0];
        if (slot === null || slot === undefined || slot === "-") continue;
        // A drum slot is a list of hits, not a melodic slot; it has no
        // pitches to report and is not what a chord fixture is about.
        if (Array.isArray(slot)) continue;
        for (const note of (slot as { notes: { pitch: string; position?: { string: number; fret: number } }[] }).notes) {
          notes.push(note.pitch);
          positions.push(
            note.position ? `s${note.position.string + 1}f${note.position.fret}` : "—",
          );
        }
      }
    }
  }
  return { notes, positions };
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary);
};

export async function renderListeningCase(name: string): Promise<ListeningRender> {
  const make = LISTENING[name];
  if (!make) throw new Error(`unknown listening case: ${name}`);
  const { what, song } = make();

  const rendered = await renderSongToBuffer(song, {});
  const clip = clipping(rendered.channels);
  const perChannel = rendered.channels.map(energy);
  const encoded = encodeWav({
    channels: rendered.channels,
    sampleRate: rendered.sampleRate,
  });
  if (!encoded.ok) throw new Error(`encode refused: ${encoded.code}`);

  const chordTrack = song.tracks[0]!;
  const onset = firstOnsetNotes(song);

  return {
    name,
    what,
    preset: `${chordTrack.instrumentId}/${chordTrack.presetId}`,
    samplePack: `${chordTrack.instrumentId}/${chordTrack.presetId}`,
    notes: onset.notes,
    positions: onset.positions,
    peak: clip.peak,
    rms: Math.sqrt(
      perChannel.reduce((sum, entry) => sum + entry.rms * entry.rms, 0) /
        Math.max(1, perChannel.length),
    ),
    clippedSamples: clip.clippedSamples,
    clippedFrames: clip.clippedFrames,
    requestedBuffers: 0,
    decodedBuffers: 0,
    activeAfterDispose: rendered.activeAfterDispose,
    wavBase64: toBase64(encoded.bytes),
    wavBytes: encoded.bytes.byteLength,
  };
}

/** The encoder's own limits, so the harness reports them rather than assuming. */
export const EXPORT_LIMITS = audioExportLimits;

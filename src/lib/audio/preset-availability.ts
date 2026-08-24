/**
 * Whether a preset can actually be heard (2O-B.1 §2).
 *
 * The registry says what instruments and presets *exist*; it deliberately
 * knows nothing about recordings. That separation is right, and it left a
 * gap: `electric_guitar/clean` is a real, core-scope, selectable preset with
 * no vendored sample pack behind it, so a track carrying it produced no
 * sound at all — not a quieter sound, none — while every layer above
 * reported success. Two launch templates handed a new reader exactly that
 * track (see `eval/chord-audio/artifacts/BASELINE.json`).
 *
 * So "in the registry" and "can be played" become two different questions
 * with two different answers, and this module owns the second one. It is
 * **not** part of the Song Contract: a song stores what the reader chose,
 * and no availability field is ever written to, exported from, or validated
 * against a song. A preset that is unavailable today and vendored tomorrow
 * must change nothing about any file already on disk.
 *
 * Pure data in, pure data out. No Tone, no context, no fetch.
 */
import { samplePackFor, type SamplePack } from "@/lib/audio/packs";
import {
  corePresets,
  getPreset,
  isDrumInstrument,
  type InstrumentPreset,
} from "@/lib/instruments/registry";
import type { Song } from "@/lib/song/schema";

/**
 * Why a preset makes a sound, or why it cannot.
 *
 * `bankKey` is the identity of the decoded asset set, not of the preset:
 * see `SamplePack.bankKey`. It is carried here so that everything asking
 * "can this be heard" and everything asking "which bank is this" gets the
 * same answer from the same place.
 */
export type AudioPresetAvailability =
  | {
      readonly status: "available";
      readonly source: "sample_pack";
      readonly sampleCount: number;
      readonly bankKey: string;
      readonly pack: SamplePack;
    }
  | {
      readonly status: "available";
      readonly source: "synthesised";
      readonly sampleCount: 0;
      readonly bankKey: null;
    }
  | { readonly status: "unavailable"; readonly reason: "sample_pack_missing" };

/** The only reason a preset can be unavailable today. A closed union on purpose. */
export type UnavailableReason = Extract<
  AudioPresetAvailability,
  { status: "unavailable" }
>["reason"];

export function audioPresetAvailability(
  instrumentId: string,
  presetId: string,
): AudioPresetAvailability {
  // The drum kit is built from the allowed synth nodes (spec 8.1), so it has
  // nothing to download and cannot be missing.
  if (isDrumInstrument(instrumentId)) {
    return { status: "available", source: "synthesised", sampleCount: 0, bankKey: null };
  }
  const pack = samplePackFor(instrumentId, presetId);
  if (!pack) return { status: "unavailable", reason: "sample_pack_missing" };
  return {
    status: "available",
    source: "sample_pack",
    sampleCount: Object.keys(pack.urls).length,
    bankKey: pack.bankKey,
    pack,
  };
}

export function isPlayablePreset(instrumentId: string, presetId: string): boolean {
  return audioPresetAvailability(instrumentId, presetId).status === "available";
}

/**
 * Core presets of an instrument that can be heard today, in registry order.
 *
 * What a launch template chooses from, and what a preset picker marks as
 * playable. The order is the registry's: this filters, it does not re-rank,
 * because which preset sounds best is a musical decision and not one made
 * here.
 */
export function playableCorePresets(
  instrumentId: string,
): readonly InstrumentPreset[] {
  return corePresets(instrumentId).filter((preset) =>
    isPlayablePreset(instrumentId, preset.id),
  );
}

/** One track a song asks for that the engine cannot produce a sound for. */
export type SilentTrack = {
  readonly trackId: string;
  readonly name: string;
  readonly reason: UnavailableReason;
};

/**
 * Tracks of this song that will be silent, with the names the reader gave
 * them.
 *
 * The song is read and never written. A song carrying an unavailable preset
 * is a song to be told the truth about, not a song to be corrected.
 */
export function silentTracks(song: Song): readonly SilentTrack[] {
  const silent: SilentTrack[] = [];
  for (const track of song.tracks) {
    const availability = audioPresetAvailability(track.instrumentId, track.presetId);
    if (availability.status === "unavailable") {
      silent.push({ trackId: track.id, name: track.name, reason: availability.reason });
    }
  }
  return silent;
}

/**
 * What a reader is told, in their own language, about tracks that cannot
 * sound.
 *
 * Their own track names and nothing else: no preset id, no pack id, no URL,
 * no manifest file name and no reason code. Those belong in the artefacts
 * and the console, not on a screen someone is trying to write music on.
 */
export function silentTrackNotice(silent: readonly SilentTrack[]): string | null {
  if (silent.length === 0) return null;
  const names = silent.map((track) => `"${track.name}"`).join(", ");
  return silent.length === 1
    ? `${names} track'i için ses bulunamadı, bu track sessiz çalınıyor. Track ayarlarından başka bir varyasyon seçebilirsiniz.`
    : `${names} track'leri için ses bulunamadı, bu track'ler sessiz çalınıyor. Track ayarlarından başka bir varyasyon seçebilirsiniz.`;
}

/** One row of a preset picker: the registry entry, and whether it can be heard. */
export type PresetOption = {
  readonly preset: InstrumentPreset;
  readonly playable: boolean;
};

/**
 * What a preset picker may offer, given what the track already carries.
 *
 * Two rules, and they pull in opposite directions. A picker must not offer a
 * preset that makes no sound, or the reader chooses silence without being
 * told. But a track that *already* carries such a preset — from an older
 * file, or from a pack that has since been withdrawn — must still see its
 * own value in the list: dropping it would make the control display some
 * other preset, and the first keystroke anywhere in the form would then
 * write that other preset into the song. Silently changing what a reader
 * chose is exactly what this checkpoint refuses to do.
 *
 * So: every playable core preset, in registry order, plus the one already
 * selected if it is not among them — marked unplayable, for the caller to
 * present as un-choosable rather than as an ordinary option.
 */
export function corePresetOptions(
  instrumentId: string,
  selectedPresetId: string,
): readonly PresetOption[] {
  const options: PresetOption[] = playableCorePresets(instrumentId).map((preset) => ({
    preset,
    playable: true,
  }));
  if (options.some((option) => option.preset.id === selectedPresetId)) return options;
  const selected = getPreset(instrumentId, selectedPresetId);
  if (!selected) return options;
  return [...options, { preset: selected, playable: false }];
}

/**
 * The track lifecycle commands (spec 13.17, 2L-B §7, §8).
 *
 * Seven pure commands over the track list, with the one genuinely dangerous
 * pair split in two on purpose. Changing the setup of a track that already
 * carries music can invalidate that music, and there are exactly two honest
 * answers:
 *
 * - `update_track_setup` keeps every note and asks the strict schema and the
 *   central validator chain whether the combination still stands. If any
 *   explicit position, pitch, range or string stops being valid, the whole
 *   change is refused atomically — nothing is clamped, dropped or moved to
 *   another string to force a fit.
 * - `replace_track_setup_and_clear_content` is the separate, explicitly
 *   destructive road: the track's keys disappear from every bar (missing key
 *   *is* silence, spec 5.5) and the new setup applies to an empty lane.
 *
 * There is deliberately no third command between them.
 *
 * Setups resolve against the registry: an instrument must exist in core
 * scope, the preset must be one of its core presets, and a fretboard is
 * required exactly when the registry says the instrument has one.
 */
import { songLimits } from "@/lib/limits";
import { MAX_CAPO, TUNING_PRESETS, type TuningPreset } from "@/lib/music/fretboard";
import { PITCH_PATTERN } from "@/lib/music/pitch";
import { getInstrument, isCorePreset } from "@/lib/instruments/registry";
import { guardCandidate } from "@/lib/song/lifecycle-guard";
import { copyName, dedupeId, nextNumberedId } from "@/lib/song/lifecycle-ids";
import { DEFAULT_TRACK_VOLUME_DB } from "@/lib/song/song-templates";
import type { Bar, Section, Song, Track } from "@/lib/song/schema";
import type {
  LifecycleErrorCode,
  LifecycleResult,
} from "@/lib/song/lifecycle-types";

/** Everything a track form can say about a track. */
export type TrackSetup = {
  readonly name: string;
  readonly instrumentId: string;
  readonly presetId: string;
  readonly fretboard?: {
    readonly tuning: readonly string[];
    readonly capo: number;
  };
};

export type TrackCommand =
  | { readonly kind: "create_track"; readonly setup: TrackSetup }
  | {
      readonly kind: "rename_track";
      readonly trackId: string;
      readonly name: string;
    }
  | { readonly kind: "duplicate_track"; readonly trackId: string }
  | {
      readonly kind: "move_track";
      readonly trackId: string;
      readonly direction: "up" | "down";
    }
  | { readonly kind: "delete_track"; readonly trackId: string }
  | {
      readonly kind: "update_track_setup";
      readonly trackId: string;
      readonly setup: TrackSetup;
    }
  | {
      readonly kind: "replace_track_setup_and_clear_content";
      readonly trackId: string;
      readonly setup: TrackSetup;
    };

/** Does the registry say this instrument is played on a fretboard? */
export function isFrettedInstrument(instrumentId: string): boolean {
  return getInstrument(instrumentId)?.defaultTuningPresetId !== undefined;
}

/**
 * The tuning presets a track form may offer for an instrument (2L-B §7).
 *
 * Derived, not listed: every preset with the same string count as the
 * instrument's registry default, default first. A guitar is offered E
 * Standard and Drop D; a bass only its own standard; a fretboard-less
 * instrument gets an empty list, which is the form's cue to show no tuning
 * control at all.
 */
export function tuningOptionsFor(instrumentId: string): readonly TuningPreset[] {
  const defaultId = getInstrument(instrumentId)?.defaultTuningPresetId;
  const fallback = defaultId ? TUNING_PRESETS[defaultId] : undefined;
  if (!fallback) return [];
  return [
    fallback,
    ...Object.values(TUNING_PRESETS).filter(
      (preset) =>
        preset.id !== fallback.id &&
        preset.tuning.length === fallback.tuning.length,
    ),
  ];
}

const trackIndex = (song: Song, trackId: string): number =>
  song.tracks.findIndex((track) => track.id === trackId);

const withTracks = (song: Song, tracks: readonly Track[]): Song => ({
  ...song,
  tracks: [...tracks],
});

/**
 * The setup checked against the registry, before any candidate is built.
 * Returns the refusal, or null when the setup is sound.
 */
function setupError(setup: TrackSetup): LifecycleErrorCode | null {
  if (setup.name.trim().length === 0) return "invalid_track_name";
  const instrument = getInstrument(setup.instrumentId);
  if (!instrument || instrument.scope !== "core") return "unknown_instrument";
  if (!isCorePreset(setup.instrumentId, setup.presetId)) return "unknown_preset";

  if (!isFrettedInstrument(setup.instrumentId)) {
    // No fretboard to configure — a tuning here would be an invention.
    return setup.fretboard === undefined ? null : "fretboard_not_allowed";
  }
  const fretboard = setup.fretboard;
  if (!fretboard || fretboard.tuning.length === 0) return "invalid_fretboard";
  if (!fretboard.tuning.every((pitch) => PITCH_PATTERN.test(pitch))) {
    return "invalid_fretboard";
  }
  if (
    !Number.isInteger(fretboard.capo) ||
    fretboard.capo < 0 ||
    fretboard.capo > MAX_CAPO
  ) {
    return "invalid_capo";
  }
  return null;
}

/** The track a setup describes, keeping what the form does not touch. */
function applySetup(setup: TrackSetup, keep: Pick<Track, "id" | "volumeDb"> &
  Partial<Pick<Track, "pan" | "muted" | "soloed">>): Track {
  return {
    id: keep.id,
    name: setup.name.trim(),
    instrumentId: setup.instrumentId,
    presetId: setup.presetId,
    volumeDb: keep.volumeDb,
    ...(keep.pan !== undefined ? { pan: keep.pan } : {}),
    ...(keep.muted !== undefined ? { muted: keep.muted } : {}),
    ...(keep.soloed !== undefined ? { soloed: keep.soloed } : {}),
    ...(setup.fretboard
      ? {
          fretboard: {
            tuning: [...setup.fretboard.tuning],
            capo: setup.fretboard.capo,
          },
        }
      : {}),
  };
}

/** Every bar of every section with this track's key removed. */
function sectionsWithoutTrackKey(
  sections: readonly Section[],
  trackId: string,
): Section[] {
  return sections.map((section) => ({
    ...section,
    bars: section.bars.map((bar): Bar => {
      if (!(trackId in bar.slots)) return bar;
      const slots = { ...bar.slots };
      delete slots[trackId];
      return { ...bar, slots };
    }),
  }));
}

export function applyTrackCommand(
  song: Song,
  command: TrackCommand,
): LifecycleResult {
  switch (command.kind) {
    case "create_track": {
      if (song.tracks.length >= songLimits.maxTracks) {
        return { ok: false, error: { code: "track_limit_reached" } };
      }
      const refused = setupError(command.setup);
      if (refused) return { ok: false, error: { code: refused } };
      const track = applySetup(command.setup, {
        id: nextNumberedId(song.tracks.map((entry) => entry.id), "track"),
        volumeDb: DEFAULT_TRACK_VOLUME_DB,
      });
      // No section gains a key for the new track: it is silent everywhere,
      // and silence is a missing key (spec 5.5).
      return guardCandidate(withTracks(song, [...song.tracks, track]));
    }

    case "rename_track": {
      const name = command.name.trim();
      if (name.length === 0) {
        return { ok: false, error: { code: "invalid_track_name" } };
      }
      const index = trackIndex(song, command.trackId);
      if (index < 0) return { ok: false, error: { code: "track_not_found" } };
      const tracks = song.tracks.map((track, at) =>
        at === index ? { ...track, name } : track,
      );
      return guardCandidate(withTracks(song, tracks));
    }

    case "duplicate_track": {
      const index = trackIndex(song, command.trackId);
      if (index < 0) return { ok: false, error: { code: "track_not_found" } };
      if (song.tracks.length >= songLimits.maxTracks) {
        return { ok: false, error: { code: "track_limit_reached" } };
      }
      const source = song.tracks[index]!;
      const id = dedupeId(
        song.tracks.map((entry) => entry.id),
        `${source.id}-copy`,
      );
      const copy: Track = {
        ...source,
        id,
        name: copyName(song.tracks.map((entry) => entry.name), source.name),
      };
      /*
       * Content follows the copy bar by bar — and only where the source
       * actually has a key. A bar where the source is silent stays silent
       * for the copy too; inventing an empty slot array there would turn
       * "says nothing" into "plays nothing", which are different statements.
       */
      const sections = song.sections.map((section) => ({
        ...section,
        bars: section.bars.map((bar): Bar => {
          const slots = bar.slots[source.id];
          if (slots === undefined) return bar;
          return { ...bar, slots: { ...bar.slots, [id]: slots } };
        }),
      }));
      const tracks = [...song.tracks];
      tracks.splice(index + 1, 0, copy);
      return guardCandidate({ ...song, tracks, sections });
    }

    case "move_track": {
      const index = trackIndex(song, command.trackId);
      if (index < 0) return { ok: false, error: { code: "track_not_found" } };
      const target = command.direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= song.tracks.length) {
        return { ok: false, error: { code: "no_room_to_move" } };
      }
      const tracks = [...song.tracks];
      const [moved] = tracks.splice(index, 1);
      tracks.splice(target, 0, moved!);
      return guardCandidate(withTracks(song, tracks));
    }

    case "delete_track": {
      const index = trackIndex(song, command.trackId);
      if (index < 0) return { ok: false, error: { code: "track_not_found" } };
      if (song.tracks.length <= 1) {
        return { ok: false, error: { code: "last_track_undeletable" } };
      }
      // The registry row and every section's key go together or not at all.
      return guardCandidate({
        ...song,
        tracks: song.tracks.filter((_, at) => at !== index),
        sections: sectionsWithoutTrackKey(song.sections, command.trackId),
      });
    }

    case "update_track_setup": {
      const index = trackIndex(song, command.trackId);
      if (index < 0) return { ok: false, error: { code: "track_not_found" } };
      const refused = setupError(command.setup);
      if (refused) return { ok: false, error: { code: refused } };
      const current = song.tracks[index]!;
      const tracks = song.tracks.map((track, at) =>
        at === index ? applySetup(command.setup, current) : track,
      );
      // Content stays put; the schema and validators judge the combination.
      // An error is the safe path's whole answer (spec 2L-B §8).
      return guardCandidate(withTracks(song, tracks), "setup_incompatible");
    }

    case "replace_track_setup_and_clear_content": {
      const index = trackIndex(song, command.trackId);
      if (index < 0) return { ok: false, error: { code: "track_not_found" } };
      const refused = setupError(command.setup);
      if (refused) return { ok: false, error: { code: refused } };
      const current = song.tracks[index]!;
      const tracks = song.tracks.map((track, at) =>
        at === index ? applySetup(command.setup, current) : track,
      );
      return guardCandidate({
        ...song,
        tracks,
        sections: sectionsWithoutTrackKey(song.sections, command.trackId),
      });
    }
  }
}

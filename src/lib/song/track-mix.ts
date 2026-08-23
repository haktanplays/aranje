/**
 * The mixer, as a pure model (spec 13.18, 2L-C §3, §4, §5).
 *
 * Two kinds of state meet here and never mix into one another:
 *
 * - **Persisted mix** — a track's `volumeDb` and `pan`. These are musical
 *   project data. They already live in the Song Contract, they travel in a
 *   project file, they move the fingerprint, they go through the one commit
 *   gate and they are what an offline render reads.
 * - **Session audition** — mute and solo. These are how someone *listens*
 *   while working. They are never written to the Song: no contract field, no
 *   file, no fingerprint, no history, no storage. A reload starts with
 *   everything audible again, and that is the honest default — a track
 *   silenced last Tuesday is not a property of the music.
 *
 * Mute is deliberately not "volume at minus infinity" (§4). Audibility is a
 * separate question from level, so the two are separate functions here:
 * `effectiveTrackGain` says how loud a track asks to be, `audibleTrackIds`
 * says who is heard at all. Folding them would make "unmute" ambiguous about
 * what level to come back to.
 */
import { mixerLimits } from "@/lib/limits";
import { sameSong } from "@/lib/song/edit-history";
import { guardCandidate } from "@/lib/song/lifecycle-guard";
import type { GuardResult } from "@/lib/song/lifecycle-types";
import type { Song, Track } from "@/lib/song/schema";

/** One track's persisted mix. `pan` is always stated here, centre included. */
export type TrackMix = {
  readonly volumeDb: number;
  readonly pan: number;
};

/** Mixes by track id. The mixer's staged draft has exactly this shape. */
export type TrackMixMap = Readonly<Record<string, TrackMix>>;

export type MixCommand =
  /** Write a whole set of levels at once: one apply, however many tracks. */
  | { readonly kind: "update_track_mix"; readonly mixes: TrackMixMap }
  /**
   * Put back the levels the mixer was opened with. The same command the
   * cancel path stages, so "back to where we started" has one meaning.
   */
  | {
      readonly kind: "reset_track_mix_to_opened_value";
      readonly opened: TrackMixMap;
    };

export type MixErrorCode =
  | "track_not_found"
  | "volume_out_of_range"
  | "pan_out_of_range"
  | "mix_validation_failed";

export type MixResult = GuardResult<MixErrorCode>;

/* ------------------------------------------------------------- the levels */

/** A track's pan as a number, with the contract's absent pan read as centre. */
export function trackPan(track: Track): number {
  return track.pan ?? mixerLimits.pan.center;
}

/** What the mixer shows when it opens: every track's current levels. */
export function readTrackMixes(song: Song): TrackMixMap {
  const mixes: Record<string, TrackMix> = {};
  for (const track of song.tracks) {
    mixes[track.id] = { volumeDb: track.volumeDb, pan: trackPan(track) };
  }
  return mixes;
}

/**
 * The linear gain a track's own volume asks for.
 *
 * Volume only — mute and solo are not in here by design (§4). A caller that
 * wants "will I hear this" asks `audibleTrackIds`.
 */
export function effectiveTrackGain(track: Track): number {
  return 10 ** (track.volumeDb / 20);
}

const inRange = (value: number, min: number, max: number) =>
  Number.isFinite(value) && value >= min && value <= max;

/**
 * The track a mix describes, or the track itself when nothing moved.
 *
 * Returning the *same object* for an unchanged track is what keeps a no-op
 * apply a genuine no-op all the way down to the commit gate. Centre pan is
 * written as an absent field, the shape the contract already uses — but only
 * when the pan actually changed, so a file that states `pan: 0` explicitly
 * is not silently rewritten by opening the mixer and closing it.
 */
function withMix(track: Track, mix: TrackMix): Track {
  if (track.volumeDb === mix.volumeDb && trackPan(track) === mix.pan) {
    return track;
  }
  const next: Track = { ...track, volumeDb: mix.volumeDb };
  if (mix.pan === mixerLimits.pan.center) {
    delete (next as { pan?: number }).pan;
    return next;
  }
  return { ...next, pan: mix.pan };
}

/**
 * Apply a set of levels.
 *
 * Nothing but `volumeDb` and `pan` can move: notes, positions, tuning, capo,
 * sections and bars are all read from the input song and handed back
 * untouched. Out of range is refused whole — never clamped, because a slider
 * that silently lands somewhere else than where it was let go is a slider
 * that cannot be trusted.
 */
export function applyMixCommand(song: Song, command: MixCommand): MixResult {
  const mixes =
    command.kind === "update_track_mix" ? command.mixes : command.opened;

  for (const [trackId, mix] of Object.entries(mixes)) {
    if (!song.tracks.some((track) => track.id === trackId)) {
      return { ok: false, error: { code: "track_not_found" } };
    }
    if (!inRange(mix.volumeDb, mixerLimits.volumeDb.min, mixerLimits.volumeDb.max)) {
      return { ok: false, error: { code: "volume_out_of_range" } };
    }
    if (!inRange(mix.pan, mixerLimits.pan.min, mixerLimits.pan.max)) {
      return { ok: false, error: { code: "pan_out_of_range" } };
    }
  }

  const tracks = song.tracks.map((track) => {
    const mix = mixes[track.id];
    return mix === undefined ? track : withMix(track, mix);
  });

  return guardCandidate({ ...song, tracks }, "mix_validation_failed");
}

/* ---------------------------------------------------------- the audition */

/**
 * Who is silenced and who is being listened to alone, this session.
 *
 * Sets rather than flags on the track, because this is not a property of the
 * music and must not be able to travel with it.
 */
export type TrackAudition = {
  readonly muted: ReadonlySet<string>;
  readonly soloed: ReadonlySet<string>;
};

export const EMPTY_AUDITION: TrackAudition = {
  muted: new Set(),
  soloed: new Set(),
};

const toggled = (
  set: ReadonlySet<string>,
  trackId: string,
  on: boolean,
): ReadonlySet<string> => {
  const next = new Set(set);
  if (on) next.add(trackId);
  else next.delete(trackId);
  return next;
};

export function setTrackMuted(
  state: TrackAudition,
  trackId: string,
  muted: boolean,
): TrackAudition {
  return { ...state, muted: toggled(state.muted, trackId, muted) };
}

export function setTrackSoloed(
  state: TrackAudition,
  trackId: string,
  soloed: boolean,
): TrackAudition {
  return { ...state, soloed: toggled(state.soloed, trackId, soloed) };
}

/** Everything audible again. A new song and an opened project both land here. */
export function clearTrackAudition(): TrackAudition {
  return EMPTY_AUDITION;
}

/**
 * The same state with ids the song no longer has dropped.
 *
 * A deleted track must not leave a mute behind that would silence whatever
 * later happens to be given its id, and a stale solo must not narrow the mix
 * to a track nobody can see.
 */
export function pruneAudition(
  song: Song,
  state: TrackAudition,
): TrackAudition {
  const live = new Set(song.tracks.map((track) => track.id));
  const keep = (set: ReadonlySet<string>) =>
    new Set([...set].filter((id) => live.has(id)));
  const muted = keep(state.muted);
  const soloed = keep(state.soloed);
  if (muted.size === state.muted.size && soloed.size === state.soloed.size) {
    return state;
  }
  return { muted, soloed };
}

/**
 * Who is heard, in the song's own track order (spec 13.18 §5).
 *
 * - no solo at all → everything that is not muted;
 * - any solo → the soloed tracks, minus any of them that are also muted.
 *
 * Mute beats solo: a soloed *and* muted track is silent, because muting is
 * the more specific instruction and the reader gave it last as often as not.
 * Every track muted is a valid silence — an empty list here is an answer, not
 * a failure to be papered over with a fallback.
 *
 * The metronome is not a track and never appears in this list, so it keeps
 * clicking through any combination of mutes and solos.
 */
export function audibleTrackIds(
  song: Song,
  state: TrackAudition,
): readonly string[] {
  const pruned = pruneAudition(song, state);
  const soloing = pruned.soloed.size > 0;
  return song.tracks
    .filter(
      (track) =>
        !pruned.muted.has(track.id) &&
        (!soloing || pruned.soloed.has(track.id)),
    )
    .map((track) => track.id);
}

/**
 * Does the difference between two songs consist of nothing but track levels?
 *
 * The audio graph asks this (2L-C §7). A song that changed only its mix needs
 * no new engine, no new schedule and no re-decoded sample — the levels are
 * written onto the channels that are already playing. Anything else, down to
 * a renamed track or a moved bar, is not a mix change and gets the ordinary
 * rebuild. Deliberately strict and deliberately central: a component that
 * decided this for itself would eventually decide it wrongly while music is
 * playing.
 */
export function isMixOnlyChange(previous: Song, next: Song): boolean {
  if (previous === next) return false;
  if (previous.tracks.length !== next.tracks.length) return false;

  const bare = (track: Track): Track => {
    const copy: Track = { ...track, volumeDb: 0 };
    delete (copy as { pan?: number }).pan;
    return copy;
  };

  /*
   * Structural, not textual: one of these songs has usually been through the
   * schema parser and the other has not, and the two agree about the music
   * while disagreeing about key order. `sameSong` is the comparator the
   * commit gate already trusts for exactly this reason.
   */
  const sameOtherwise = sameSong(
    { ...previous, tracks: previous.tracks.map(bare) },
    { ...next, tracks: next.tracks.map(bare) },
  );
  if (!sameOtherwise) return false;

  // ...and at least one of the two mix fields must actually have moved.
  return previous.tracks.some((track, index) => {
    const other = next.tracks[index]!;
    return track.volumeDb !== other.volumeDb || trackPan(track) !== trackPan(other);
  });
}

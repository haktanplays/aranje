"use client";

/**
 * The mixer session (spec 13.18, 2L-C §6).
 *
 * Two clocks run here and they are deliberately not the same one.
 *
 * **The staged mix** is a draft. Opening the mixer takes a copy of every
 * track's committed levels; moving a slider changes the copy and the sound,
 * and changes nothing else — not the song, not storage, not the history.
 * "Uygula" turns the whole draft into one commit; "Vazgeç" throws the copy
 * away and puts the graph back on the committed values.
 *
 * **The audition** — muted and soloed — is not a draft at all. It is how the
 * reader is listening *right now*, so it survives cancel, survives closing
 * the sheet, and survives switching between the arrangement and the tab. It
 * is also never written to the song: no field, no file, no fingerprint, no
 * history, no storage. A new song or an opened project puts it down, because
 * those are different music.
 *
 * The audio moves are injected. This controller never imports the engine,
 * the store or another controller: it is handed exactly three things it may
 * do to the sound and one gate it may commit through.
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { instrumentLabel } from "@/lib/instruments/registry";
import { mixerLimits } from "@/lib/limits";
import { sameSong, type HistoryAction } from "@/lib/song/edit-history";
import {
  MIX_MESSAGES,
  MIX_STALE_MESSAGE,
  muteControlLabel,
  panLabel,
  soloControlLabel,
  volumeLabel,
} from "@/lib/song/track-mix-messages";
import {
  EMPTY_AUDITION,
  applyMixCommand,
  audibleTrackIds,
  clearTrackAudition,
  pruneAudition,
  readTrackMixes,
  setTrackMuted,
  setTrackSoloed,
  type TrackAudition,
  type TrackMixMap,
} from "@/lib/song/track-mix";
import type { Song } from "@/lib/song/schema";
import type { ValidationIssue } from "@/lib/validators";

/** One line of the mixer, ready to render. No ids or dB maths in the sheet. */
export type MixerRow = {
  readonly trackId: string;
  readonly name: string;
  readonly instrument: string;
  readonly volumeDb: number;
  readonly volumeText: string;
  readonly pan: number;
  readonly panText: string;
  readonly muted: boolean;
  readonly soloed: boolean;
  /** What the audition decided for this row, all rules applied. */
  readonly audible: boolean;
  readonly muteLabel: string;
  readonly soloLabel: string;
};

export type MixerHandle = {
  readonly rows: readonly MixerRow[];
  /** The song moved under the open mixer; the staged levels cannot land. */
  readonly stale: boolean;
  readonly canApply: boolean;
  readonly error: string | null;
  readonly warnings: readonly ValidationIssue[];
  /** True while any track is silenced or soloed, for the entry control. */
  readonly auditioning: boolean;
  /** Take the copy the session will draft against. */
  begin(): void;
  setVolume(trackId: string, volumeDb: number): void;
  setPan(trackId: string, pan: number): void;
  centrePan(trackId: string): void;
  toggleMuted(trackId: string): void;
  toggleSoloed(trackId: string): void;
  /** One commit for the whole draft. True when the sheet may close. */
  apply(): boolean;
  /** Draft away, graph back on the committed levels. Audition untouched. */
  cancel(): void;
  /** Everything audible again: a new song, or a project opened over this one. */
  clearAudition(): void;
};

export function useMixer(options: {
  song: Song;
  canPersist: boolean;
  commit(next: Song, action: HistoryAction): boolean;
  /** Preview one track on the running graph. Injected: no engine import. */
  previewMix(trackId: string, volumeDb: number, pan: number): void;
  /** Put the graph back on the song's own levels. */
  clearPreview(): void;
  /** Tell the graph who is heard. */
  setAudibility(audibleTrackIds: readonly string[]): void;
}): MixerHandle {
  const { song, canPersist, commit, previewMix, clearPreview, setAudibility } =
    options;

  const [staged, setStaged] = useState<TrackMixMap>(() => readTrackMixes(song));
  const [audition, setAudition] = useState<TrackAudition>(EMPTY_AUDITION);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<readonly ValidationIssue[]>([]);
  /** The song the draft was taken from. Staleness is measured against it. */
  const [openedSong, setOpenedSong] = useState<Song>(song);

  /*
   * A deleted track's audition goes with it, rather than being filtered out
   * at read time: an undo that brings the track back must bring it back
   * audible, not silently still muted from before it was deleted.
   *
   * Adjusted during render, on the render that first sees a different set of
   * tracks — the same shape the playback hook uses when the song changes
   * under it, and cheaper than an effect that would render twice.
   */
  const trackIds = song.tracks.map((track) => track.id).join(" ");
  const [knownTrackIds, setKnownTrackIds] = useState(trackIds);
  if (knownTrackIds !== trackIds) {
    setKnownTrackIds(trackIds);
    setAudition((current) => pruneAudition(song, current));
  }

  const audible = useMemo(
    () => audibleTrackIds(song, audition),
    [song, audition],
  );

  /* The graph hears every audition change at once — session, not draft. */
  useEffect(() => {
    setAudibility(audible);
  }, [audible, setAudibility]);

  const begin = useCallback(() => {
    setOpenedSong(song);
    setStaged(readTrackMixes(song));
    setError(null);
    setWarnings([]);
  }, [song]);

  const stale = !sameSong(song, openedSong);

  const stage = useCallback(
    (trackId: string, patch: { volumeDb?: number; pan?: number }) => {
      setStaged((current) => {
        const existing = current[trackId];
        if (!existing) return current;
        const next = {
          volumeDb: patch.volumeDb ?? existing.volumeDb,
          pan: patch.pan ?? existing.pan,
        };
        // The sound follows the slider, and only the sound.
        previewMix(trackId, next.volumeDb, next.pan);
        return { ...current, [trackId]: next };
      });
      setError(null);
    },
    [previewMix],
  );

  const setVolume = useCallback(
    (trackId: string, volumeDb: number) => stage(trackId, { volumeDb }),
    [stage],
  );
  const setPan = useCallback(
    (trackId: string, pan: number) => stage(trackId, { pan }),
    [stage],
  );
  const centrePan = useCallback(
    (trackId: string) => stage(trackId, { pan: mixerLimits.pan.center }),
    [stage],
  );

  const toggleMuted = useCallback(
    (trackId: string) =>
      setAudition((current) =>
        setTrackMuted(current, trackId, !current.muted.has(trackId)),
      ),
    [],
  );

  const toggleSoloed = useCallback(
    (trackId: string) =>
      setAudition((current) =>
        setTrackSoloed(current, trackId, !current.soloed.has(trackId)),
      ),
    [],
  );

  const clearAudition = useCallback(() => {
    setAudition(clearTrackAudition());
  }, []);

  const cancel = useCallback(() => {
    setStaged(readTrackMixes(song));
    setError(null);
    setWarnings([]);
    clearPreview();
  }, [clearPreview, song]);

  const apply = useCallback((): boolean => {
    if (stale) {
      setError(MIX_STALE_MESSAGE);
      return false;
    }
    if (!canPersist) return false;

    const result = applyMixCommand(song, {
      kind: "update_track_mix",
      mixes: staged,
    });
    if (!result.ok) {
      setError(MIX_MESSAGES[result.error.code]);
      return false;
    }
    setError(null);
    setWarnings(result.warnings);

    /*
     * A draft that came back as the same music is not a failure and not a
     * write: the sheet simply closes. The store refuses it for us, so there
     * is no second no-op rule here to drift from the one in the gate.
     */
    if (sameSong(result.song, song)) return true;
    return commit(result.song, { kind: "track_mix_update" });
  }, [canPersist, commit, song, staged, stale]);

  const rows = useMemo(
    () =>
      song.tracks.map((track): MixerRow => {
        const mix = staged[track.id] ?? {
          volumeDb: track.volumeDb,
          pan: track.pan ?? mixerLimits.pan.center,
        };
        const muted = audition.muted.has(track.id);
        const soloed = audition.soloed.has(track.id);
        return {
          trackId: track.id,
          name: track.name,
          instrument: instrumentLabel(track.instrumentId),
          volumeDb: mix.volumeDb,
          volumeText: volumeLabel(mix.volumeDb),
          pan: mix.pan,
          panText: panLabel(mix.pan),
          muted,
          soloed,
          audible: audible.includes(track.id),
          muteLabel: muteControlLabel(track.name, muted),
          soloLabel: soloControlLabel(track.name, soloed),
        };
      }),
    [audible, audition, song.tracks, staged],
  );

  return {
    rows,
    stale,
    canApply: canPersist && !stale,
    error,
    warnings,
    auditioning: audition.muted.size > 0 || audition.soloed.size > 0,
    begin,
    setVolume,
    setPan,
    centrePan,
    toggleMuted,
    toggleSoloed,
    apply,
    cancel,
    clearAudition,
  };
}

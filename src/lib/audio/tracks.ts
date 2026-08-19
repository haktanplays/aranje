/**
 * Track partitioning for isolated renders and for mixing decisions.
 *
 * Deliberately free of Tone: these are questions about the song, not about the
 * audio graph, so they stay testable without an audio context.
 */
import { isDrumInstrument } from "@/lib/instruments/registry";
import type { Song } from "@/lib/song/schema";

export function drumTrackIds(song: Song): string[] {
  return song.tracks
    .filter((track) => isDrumInstrument(track.instrumentId))
    .map((track) => track.id);
}

export function melodicTrackIds(song: Song): string[] {
  return song.tracks
    .filter((track) => !isDrumInstrument(track.instrumentId))
    .map((track) => track.id);
}

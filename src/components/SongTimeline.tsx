"use client";

import { useSyncExternalStore } from "react";

import { BRAND_NAME } from "@/lib/brand";
import { getInstrument } from "@/lib/instruments/registry";
import { formatTimeSignature } from "@/lib/music/timing";
import { SAMPLE_SONG } from "@/lib/song/sample-song";
import type { Section, Song, Track } from "@/lib/song/schema";
import { loadSong, type LoadResult } from "@/lib/song/storage";

/* localStorage is an external store, so it is read through
   useSyncExternalStore rather than an effect. The read happens once and the
   result is cached, because getSnapshot must return a stable value.

   Phase 0 only reads. Subscribing to changes arrives with the phase that can
   actually change the song. */
const NO_CHANGES = () => () => {};

let clientSnapshot: LoadResult | null = null;

function getClientSnapshot(): LoadResult {
  clientSnapshot ??= loadSong();
  return clientSnapshot;
}

/* Prerender and hydration show the sample song; the stored song replaces it as
   soon as the client can reach storage. */
const SERVER_SNAPSHOT: LoadResult = { song: SAMPLE_SONG, outcome: "empty" };

function getServerSnapshot(): LoadResult {
  return SERVER_SNAPSHOT;
}

const STATUS_LABEL: Record<Section["status"], string> = {
  fixed: "Sabit",
  pending: "AI önerisi",
  accepted: "Kabul edildi",
};

function statusClasses(status: Section["status"]): string {
  switch (status) {
    case "pending":
      return "border-dashed border-bronze text-bronze";
    case "accepted":
      return "border-accept text-accept";
    default:
      return "border-line text-muted";
  }
}

/** Tracks that actually carry slots somewhere in this section (spec 5.5). */
function activeTrackIds(section: Section): string[] {
  const ids = new Set<string>();
  for (const bar of section.bars) {
    for (const trackId of Object.keys(bar.slots)) ids.add(trackId);
  }
  return [...ids];
}

function meterSummary(section: Section): string {
  const meters = new Set(
    section.bars.map(
      (bar) => `${formatTimeSignature(bar.timeSignature)} - ${bar.resolution}`,
    ),
  );
  return [...meters].join(", ");
}

function TrackRow({ track }: { track: Track }) {
  const instrument = getInstrument(track.instrumentId);
  const strings = track.fretboard?.tuning.length;
  return (
    <li className="flex items-baseline justify-between gap-3 py-2">
      <span className="font-medium">{track.name}</span>
      <span className="text-right text-sm text-muted">
        {instrument?.displayName ?? track.instrumentId}
        {" - "}
        {track.presetId}
        {strings === undefined ? "" : ` - ${strings} tel`}
      </span>
    </li>
  );
}

function SectionCard({
  section,
  tracksById,
}: {
  section: Section;
  tracksById: Map<string, Track>;
}) {
  const active = activeTrackIds(section);
  return (
    <article
      className={`flex min-h-28 w-64 shrink-0 flex-col justify-between rounded-xl border bg-panel p-4 ${statusClasses(
        section.status,
      )}`}
    >
      <header>
        <h3 className="font-display text-lg text-text">{section.name}</h3>
        <p className="mt-1 text-xs tracking-wide uppercase">
          {STATUS_LABEL[section.status]}
        </p>
      </header>
      <dl className="mt-3 space-y-1 text-sm text-muted">
        <div className="flex justify-between gap-2">
          <dt>Bar</dt>
          <dd className="text-text">{section.bars.length}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Ölçü</dt>
          <dd className="text-text">{meterSummary(section)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Track</dt>
          <dd className="text-text">
            {active
              .map((id) => tracksById.get(id)?.name ?? id)
              .join(", ")}
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function SongTimeline() {
  const state = useSyncExternalStore(
    NO_CHANGES,
    getClientSnapshot,
    getServerSnapshot,
  );

  const song: Song = state.song;
  const tracksById = new Map(song.tracks.map((track) => [track.id, track]));
  const totalBars = song.sections.reduce(
    (total, section) => total + section.bars.length,
    0,
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-12">
      <header className="mb-6">
        <p className="text-xs font-semibold tracking-[0.18em] text-bronze uppercase">
          {BRAND_NAME}
        </p>
        <h1 className="font-display mt-1 text-3xl leading-tight">
          {song.title}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {song.key} - {song.bpm} BPM - {song.tracks.length} track - {totalBars}{" "}
          bar
        </p>
      </header>

      {state.message ? (
        <p
          role="status"
          className="mb-6 rounded-lg border border-reject/60 bg-raised p-3 text-sm text-text"
        >
          {state.message}
        </p>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold tracking-[0.14em] text-muted uppercase">
          Bölümler
        </h2>
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
          {song.sections.map((section) => (
            <SectionCard
              key={section.id}
              section={section}
              tracksById={tracksById}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-xs font-semibold tracking-[0.14em] text-muted uppercase">
          Trackler
        </h2>
        <ul className="divide-y divide-line rounded-xl border border-line bg-panel px-4">
          {song.tracks.map((track) => (
            <TrackRow key={track.id} track={track} />
          ))}
        </ul>
      </section>
    </main>
  );
}

"use client";

/**
 * Every track, and the details of the one you are on (spec 13.11, K-42).
 *
 * This used to be a details panel for one track, sitting next to a permanent
 * four-by-two grid of track buttons. On a 320px phone that grid was fifty-seven
 * pixels of chrome that existed to answer a question — "which track?" — that
 * gets asked a few times a session and is answered by one line of text the rest
 * of the time.
 *
 * So the grid is gone and the list moved in here, behind a single control that
 * says which track is active. It is the same list and the same `onSelect`: the
 * selection still goes through the one state path it always did, and there is
 * no second track-selector implementation to keep in step with the first.
 */
import { Sheet } from "@/components/workspace/Sheet";
import {
  getPreset,
  instrumentLabel,
  presetLabel,
} from "@/lib/instruments/registry";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type { Track } from "@/lib/song/schema";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-muted text-xs">{label}</dt>
      <dd className="text-right text-sm">{value}</dd>
    </div>
  );
}

/** How a track reads in one line: name, instrument, variation. */
export function trackLine(track: Track): string {
  return `${track.name} · ${presetLabel(track.instrumentId, track.presetId)}`;
}

export function TrackSheet({
  tracks,
  selectedTrackId,
  open,
  onSelect,
  onClose,
}: {
  tracks: readonly Track[];
  selectedTrackId: string;
  open: boolean;
  onSelect: (trackId: string) => void;
  onClose: () => void;
}) {
  const track =
    tracks.find((entry) => entry.id === selectedTrackId) ?? tracks[0];
  if (!open || !track) return null;

  const preset = getPreset(track.instrumentId, track.presetId);

  return (
    <Sheet open={open} title="Track" onClose={onClose} labelledBy="track-sheet-title">
      <div role="listbox" aria-label="Track seç" className="flex flex-col gap-1">
        {tracks.map((entry) => {
          const selected = entry.id === track.id;
          return (
            <button
              key={entry.id}
              type="button"
              role="option"
              aria-selected={selected}
              data-track-option={entry.id}
              onClick={() => {
                onSelect(entry.id);
                onClose();
              }}
              className={`flex items-baseline justify-between gap-3 rounded-lg border px-3 text-left ${
                selected
                  ? "border-bronze/60 bg-raised text-bronze"
                  : "border-line text-muted"
              }`}
              style={{ minHeight: MIN_TOUCH_TARGET_PX }}
            >
              <span className="truncate text-sm">{entry.name}</span>
              <span className="shrink-0 text-[11px] opacity-70">
                {instrumentLabel(entry.instrumentId)}
              </span>
            </button>
          );
        })}
      </div>

      {/* The full technical picture of the active track lives here, which is
          why the lane and the tab header do not have to carry it. */}
      <dl className="divide-line mt-4 divide-y">
        <Row label="Enstrüman" value={instrumentLabel(track.instrumentId)} />
        <Row
          label="Varyasyon"
          value={`${presetLabel(track.instrumentId, track.presetId)}${
            preset?.scope === "core" ? "" : " (Faz 2.5)"
          }`}
        />
        {track.fretboard ? (
          <>
            <Row label="Akort" value={track.fretboard.tuning.join(" ")} />
            <Row label="Capo" value={String(track.fretboard.capo)} />
          </>
        ) : null}
        <Row label="Ses" value={`${track.volumeDb} dB`} />
      </dl>
    </Sheet>
  );
}

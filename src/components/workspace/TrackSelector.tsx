"use client";

import { instrumentLabel, presetLabel } from "@/lib/instruments/registry";
import type { Track } from "@/lib/song/schema";

/** Quick switch between the tracks of the song. Touch targets stay 44px. */
export function TrackSelector({
  tracks,
  selectedTrackId,
  onSelect,
  onOpenDetails,
}: {
  tracks: readonly Track[];
  selectedTrackId: string;
  onSelect: (trackId: string) => void;
  onOpenDetails: () => void;
}) {
  return (
    <div className="flex items-stretch gap-1 border-t border-line px-2 py-2">
      <div
        role="tablist"
        aria-label="Track"
        className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
      >
        {tracks.map((track) => {
          const selected = track.id === selectedTrackId;
          return (
            <button
              key={track.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onSelect(track.id)}
              className={`min-h-11 flex-1 rounded-lg px-3 text-sm whitespace-nowrap transition-colors ${
                selected
                  ? "bg-raised text-bronze border-bronze/50 border font-semibold"
                  : "text-muted border border-transparent"
              }`}
            >
              {track.name}
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onOpenDetails}
        aria-label="Track ayrıntıları"
        className="text-muted min-h-11 min-w-11 shrink-0 rounded-lg border border-line text-lg leading-none"
      >
        &#8942;
      </button>
    </div>
  );
}

/** One-line summary of what the selected track is, shown in the top bar. */
export function trackSummary(track: Track): string {
  const parts = [
    instrumentLabel(track.instrumentId),
    presetLabel(track.instrumentId, track.presetId),
  ];
  if (track.fretboard) parts.push(`${track.fretboard.tuning.length} tel`);
  return parts.join(" · ");
}

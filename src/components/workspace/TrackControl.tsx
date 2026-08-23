"use client";

/**
 * The tab's one-line track control (2J-P).
 *
 * It says which track is active and opens the list that changes it. The list
 * itself lives in the track sheet, behind the same select path, so there is
 * no second track-selector to keep in step with the first.
 *
 * Its own component since 2L-C — a footer control with its own accessible
 * name is not composition-root glue, and the root has a line budget to keep.
 */
import { trackLine } from "@/components/workspace/TrackSheet";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type { Track } from "@/lib/song/schema";

export function TrackControl({
  track,
  onOpen,
}: {
  /** Undefined on a song with no resolvable track, or off the tab. */
  track: Track | undefined;
  onOpen: () => void;
}) {
  if (!track) return null;

  return (
    <button
      type="button"
      data-track-control
      onClick={onOpen}
      aria-label={`Aktif track: ${trackLine(track)}. Track değiştir`}
      className="border-line flex items-center justify-between gap-2 border-t px-3 text-left"
      style={{ minHeight: MIN_TOUCH_TARGET_PX }}
    >
      <span className="text-bronze truncate text-sm">{trackLine(track)}</span>
      <span className="text-muted shrink-0 text-xs" aria-hidden>
        &#9662;
      </span>
    </button>
  );
}

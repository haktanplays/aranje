"use client";

/**
 * The ideas, drawn above the music (2V-B.4 §10, §11).
 *
 * A thin strip in the staff's existing top padding — beside the section
 * names, not instead of them — so the band costs the grid no height and
 * covers no note. Each phrase is one span with its name, chevrons where it
 * runs off the mounted window, and a touch target that selects it.
 *
 * A phrase is not a selection and not a measure. Its span therefore does not
 * snap to bar lines, does not end where the screen does, and keeps the same
 * identity in every viewport: what changes with the window is where the ink
 * is, never what the phrase is.
 */
import { phraseBand, type PhraseBandSpan } from "@/lib/tab/phrase-band";
import type { SongAxis, SongAxisBar } from "@/lib/tab/song-axis";
import type { Song } from "@/lib/song/schema";

export function PhraseBand({
  song,
  axis,
  mounted,
  activePhraseId = null,
  onSelect,
}: {
  song: Song;
  axis: SongAxis;
  /** The bars actually on the screen; what the chevrons are a claim about. */
  mounted: readonly SongAxisBar[];
  activePhraseId?: string | null;
  /** Touching a phrase may select it — the range, in section ticks (§11). */
  onSelect?: (span: PhraseBandSpan) => void;
}) {
  const spans = phraseBand({
    song,
    axis,
    window: {
      fromTicks: mounted[0]?.startTicks ?? 0,
      toTicks: mounted.at(-1)?.endTicks ?? 0,
    },
  });
  if (spans.length === 0) return null;
  return (
    <div
      data-phrase-band={spans.length}
      className="absolute inset-x-0 top-0 h-3.5"
    >
      {spans.map((span) => (
        <button
          key={`${span.sectionId}:${span.phraseId}`}
          type="button"
          data-phrase-id={span.phraseId}
          data-phrase-continues={
            `${span.continuesBefore ? "before" : ""}${span.continuesAfter ? "after" : ""}` ||
            undefined
          }
          onClick={() => onSelect?.(span)}
          className={`absolute top-0 flex h-3.5 items-center gap-0.5 overflow-hidden rounded-sm border-t-2 px-1 text-[9px] leading-none font-semibold tracking-wide whitespace-nowrap ${
            activePhraseId === span.phraseId
              ? "border-bronze text-bronze"
              : "border-muted/60 text-muted"
          }`}
          style={{ left: span.leftPx, width: span.widthPx }}
        >
          {span.continuesBefore ? <span aria-hidden>‹</span> : null}
          <span className="truncate">{span.name}</span>
          {span.continuesAfter ? <span aria-hidden>›</span> : null}
        </button>
      ))}
    </div>
  );
}

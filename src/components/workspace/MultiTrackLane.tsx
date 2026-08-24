"use client";

/**
 * One instrument's row in the multi-track view (2Q-A §7).
 *
 * The frame around a lane: a header you can hit with a finger, a collapse
 * control, and whatever notation the lane's kind draws. The notation itself
 * is three separate components, and this one imports none of them — the
 * canvas composes them, so a fretted lane and a drum lane never reach for
 * each other.
 *
 * What is deliberately absent: level, pan, mute and solo. This is a reading
 * surface. A mixer lives behind the transport's mixer control and stays
 * there; putting a fader here would make the two disagree about which one is
 * the truth.
 */
import {
  LANE_DIGEST_HEIGHT,
  LANE_HEADER_HEIGHT,
} from "@/components/workspace/geometry";

export function MultiTrackLane({
  trackId,
  label,
  instrumentFamily,
  active,
  collapsed,
  silentThroughout,
  onActivate,
  onToggleCollapse,
  digest,
  children,
}: {
  trackId: string;
  /** The name the reader gave the track. */
  label: string;
  /** The instrument in the reader's language; never an id, never a lane kind. */
  instrumentFamily: string;
  active: boolean;
  collapsed: boolean;
  /** True when the track is written in no bar of this section at all. */
  silentThroughout: boolean;
  onActivate: () => void;
  onToggleCollapse: () => void;
  /** A one-line rhythmic summary, shown in place of the notation when closed. */
  digest: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      data-multi-lane={trackId}
      data-active={active || undefined}
      data-collapsed={collapsed || undefined}
      /*
       * The active lane is marked by a border as well as a colour. Colour
       * alone is a state a reader who cannot separate bronze from grey does
       * not have.
       */
      className={`border-l-2 ${
        active ? "border-bronze bg-raised/30" : "border-transparent"
      }`}
    >
      <div className="flex items-stretch gap-1 px-2">
        <button
          type="button"
          data-multi-lane-header={trackId}
          onClick={onActivate}
          aria-pressed={active}
          aria-label={
            `${label}, ${instrumentFamily}` +
            (active ? ", düzenlenen track" : "") +
            (silentThroughout ? ", bu bölümde sessiz" : "")
          }
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          style={{ minHeight: LANE_HEADER_HEIGHT }}
        >
          <span
            className={`truncate text-sm ${active ? "text-bronze" : "text-text"}`}
          >
            {label}
          </span>
          <span className="text-muted shrink-0 text-[11px]">{instrumentFamily}</span>
          {/*
            One quiet mark for a track that says nothing here, beside the
            name. The alternative — the word "Sessiz" printed across every
            empty bar — is a hundred labels saying one thing.
          */}
          {silentThroughout ? (
            <span className="text-muted/70 shrink-0 text-[11px]" title="Bu bölümde sessiz">
              &#9679;
            </span>
          ) : null}
        </button>

        <button
          type="button"
          data-multi-lane-collapse={trackId}
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          aria-label={
            collapsed ? `${label} şeridini aç` : `${label} şeridini daralt`
          }
          className="text-muted shrink-0"
          style={{ minHeight: LANE_HEADER_HEIGHT, minWidth: LANE_HEADER_HEIGHT }}
        >
          <span aria-hidden>{collapsed ? "▸" : "▾"}</span>
        </button>
      </div>

      {collapsed ? (
        <div
          data-multi-lane-digest={trackId}
          aria-hidden
          className="text-muted/60 px-2"
          style={{ height: LANE_DIGEST_HEIGHT }}
        >
          {digest}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

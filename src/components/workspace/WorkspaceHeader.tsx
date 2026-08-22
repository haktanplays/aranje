"use client";

/**
 * The workspace's top strip, exactly as it was inside `Workspace` (2J-P).
 *
 * Three columns, and the outer two are fixed. The brand and the song title
 * used to start at the very edge of the screen, which is where a host shell
 * puts its close control — so the first characters of both sat underneath it.
 * A title that is unreadable at its start is worse than a truncated one,
 * because truncation at least happens at the end. The centre column is the
 * only one that flexes, and `min-w-0` is what lets it truncate instead of
 * pushing the trailing action off the screen.
 */
import { formatBpm } from "@/lib/audio/practice-rate";
import { BRAND_NAME } from "@/lib/brand";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";

export function WorkspaceHeader({
  title,
  songKey,
  bpm,
  meter,
  activeBpm,
  hasTempoChanges,
  onInfo,
}: {
  title: string;
  songKey: string;
  bpm: number;
  meter: string;
  /** The tempo sounding *now*, which is what the header shows (K-25). */
  activeBpm: number;
  hasTempoChanges: boolean;
  onInfo: () => void;
}) {
  return (
    <header
      className="border-line grid items-center gap-2 border-b px-2 py-1.5"
      style={{
        gridTemplateColumns: `${MIN_TOUCH_TARGET_PX}px minmax(0, 1fr) ${MIN_TOUCH_TARGET_PX}px`,
      }}
    >
      {/*
        Reserved, not decorative. The shell this runs inside draws its own
        close control here; the header's job is to leave it the room rather
        than to draw underneath it.
      */}
      <div aria-hidden style={{ width: MIN_TOUCH_TARGET_PX }} />

      <div className="min-w-0">
        <p className="text-bronze truncate text-[9px] font-semibold tracking-[0.18em] uppercase">
          {BRAND_NAME}
        </p>
        <h1 className="font-display truncate text-sm leading-tight">{title}</h1>
        {/*
          Key, tempo and meter on one line under the title. The tempo shown is
          the one sounding now, not the song's top-level number: on a song
          that changes tempo the two differ for most of its length, and a
          header that is wrong most of the time is worse than no header
          (spec 13.8, K-25).
        */}
        <p className="text-muted truncate text-[10px] leading-tight tabular-nums">
          {songKey} · {hasTempoChanges ? `${formatBpm(activeBpm)} BPM •` : `${bpm} BPM`} · {meter}
        </p>
      </div>

      <button
        type="button"
        onClick={onInfo}
        aria-label="Ses kaynakları ve lisans"
        className="text-muted border-line justify-self-end rounded-lg border text-sm"
        style={{ width: MIN_TOUCH_TARGET_PX, height: MIN_TOUCH_TARGET_PX }}
      >
        <span aria-hidden>&#9432;</span>
      </button>
    </header>
  );
}

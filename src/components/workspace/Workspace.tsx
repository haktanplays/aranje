"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { SectionChips } from "@/components/workspace/SectionChips";
import { BAR_KEY_ATTRIBUTE, TabCanvas } from "@/components/workspace/TabCanvas";
import { GUTTER_WIDTH } from "@/components/workspace/geometry";
import { TrackSelector, trackSummary } from "@/components/workspace/TrackSelector";
import { TrackSheet } from "@/components/workspace/TrackSheet";
import { BRAND_NAME } from "@/lib/brand";
import { formatTimeSignature } from "@/lib/music/timing";
import { useSong } from "@/lib/song/use-song";
import { buildTrackTimeline, sectionRuns } from "@/lib/tab/timeline";

export function Workspace() {
  const { song, message } = useSong();

  const firstTrackId = song.tracks[0]?.id ?? "";
  const [selectedTrackId, setSelectedTrackId] = useState(firstTrackId);
  const [selectedBarKey, setSelectedBarKey] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const track =
    song.tracks.find((entry) => entry.id === selectedTrackId) ?? song.tracks[0];

  const timeline = useMemo(
    () => buildTrackTimeline(song, track?.id ?? ""),
    [song, track?.id],
  );
  const runs = useMemo(() => sectionRuns(song), [song]);

  const jumpToSection = useCallback((sectionId: string) => {
    const scroller = scrollRef.current;
    const target = scroller?.querySelector<HTMLElement>(
      `[${BAR_KEY_ATTRIBUTE}="${sectionId}:0"]`,
    );
    if (!scroller || !target) return;
    // offsetLeft includes the sticky gutter, so subtracting its width lands the
    // bar just clear of it instead of underneath it.
    scroller.scrollTo({
      left: Math.max(0, target.offsetLeft - GUTTER_WIDTH),
      behavior: "smooth",
    });
  }, []);

  const activeSectionId = selectedBarKey?.split(":")[0] ?? null;

  const firstBar = song.sections[0]?.bars[0];
  const meter = firstBar ? formatTimeSignature(firstBar.timeSignature) : "";

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex items-center gap-3 border-b border-line px-3 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-bronze text-[10px] font-semibold tracking-[0.18em] uppercase">
            {BRAND_NAME}
          </p>
          <h1 className="font-display truncate text-base leading-tight">
            {song.title}
          </h1>
        </div>
        <p className="text-muted shrink-0 text-right text-[11px] tabular-nums">
          {song.key}
          <br />
          {song.bpm} BPM · {meter}
        </p>
      </header>

      {message ? (
        <p
          role="status"
          className="border-reject/50 bg-raised border-b px-3 py-2 text-xs"
        >
          {message}
        </p>
      ) : null}

      <SectionChips
        runs={runs}
        activeSectionId={activeSectionId}
        onJump={jumpToSection}
      />

      <main className="min-h-0 flex-1">
        <TabCanvas
          timeline={timeline}
          selectedBarKey={selectedBarKey}
          onSelectBar={setSelectedBarKey}
          scrollRef={scrollRef}
        />
      </main>

      {track ? (
        <p className="text-muted truncate border-t border-line px-3 py-1.5 text-[11px]">
          {trackSummary(track)}
        </p>
      ) : null}

      <TrackSelector
        tracks={song.tracks}
        selectedTrackId={track?.id ?? ""}
        onSelect={setSelectedTrackId}
        onOpenDetails={() => setSheetOpen(true)}
      />

      {/* Reserved for the transport. The controls arrive with playback; putting
          a dead Play button here would promise something that does not work. */}
      <footer className="text-muted/70 border-t border-line px-3 py-2 text-center text-[11px]">
        Çalma kontrolleri sonraki checkpoint&apos;te
      </footer>

      {track ? (
        <TrackSheet
          track={track}
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </div>
  );
}

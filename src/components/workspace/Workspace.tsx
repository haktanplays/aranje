"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { InfoSheet } from "@/components/workspace/InfoSheet";
import { SectionChips } from "@/components/workspace/SectionChips";
import { BAR_KEY_ATTRIBUTE, TabCanvas } from "@/components/workspace/TabCanvas";
import { GUTTER_WIDTH } from "@/components/workspace/geometry";
import { TrackSelector, trackSummary } from "@/components/workspace/TrackSelector";
import { TrackSheet } from "@/components/workspace/TrackSheet";
import { TransportBar } from "@/components/workspace/TransportBar";
import { useDebugHandle } from "@/lib/audio/use-debug-handle";
import { usePlayback } from "@/lib/audio/use-playback";
import { BRAND_NAME } from "@/lib/brand";
import { formatTimeSignature } from "@/lib/music/timing";
import { useSong } from "@/lib/song/use-song";
import { buildTrackTimeline, sectionRuns } from "@/lib/tab/timeline";

export function Workspace() {
  const { song, message } = useSong();
  const { controller, state } = usePlayback(song);
  useDebugHandle(controller);

  const firstTrackId = song.tracks[0]?.id ?? "";
  const [selectedTrackId, setSelectedTrackId] = useState(firstTrackId);
  const [activeBarKey, setActiveBarKey] = useState<string | null>(null);
  const [trackSheetOpen, setTrackSheetOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const track =
    song.tracks.find((entry) => entry.id === selectedTrackId) ?? song.tracks[0];

  const timeline = useMemo(
    () => buildTrackTimeline(song, track?.id ?? ""),
    [song, track?.id],
  );
  const runs = useMemo(() => sectionRuns(song), [song]);
  const plan = controller.getPlan();

  const getPosition = useCallback(() => controller.getPosition(), [controller]);

  const jumpToSection = useCallback((sectionId: string) => {
    const scroller = scrollRef.current;
    const target = scroller?.querySelector<HTMLElement>(
      `[${BAR_KEY_ATTRIBUTE}="${sectionId}:0"]`,
    );
    if (!scroller || !target) return;
    scroller.scrollTo({
      left: Math.max(0, target.offsetLeft - GUTTER_WIDTH),
      behavior: "smooth",
    });
  }, []);

  const seekToBar = useCallback(
    (barKey: string) => {
      controller.seekToBar(barKey);
      setActiveBarKey(barKey);
    },
    [controller],
  );

  const toggleLoop = useCallback(() => {
    // Loops follow the section the playhead is in, or the first one.
    const current =
      activeBarKey?.split(":")[0] ?? runs[0]?.sectionId ?? null;
    controller.setLoopSection(state.loopSectionId ? null : current);
  }, [activeBarKey, controller, runs, state.loopSectionId]);

  const activeSectionId = activeBarKey?.split(":")[0] ?? null;
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
          {state.bpm} BPM · {meter}
        </p>
        <button
          type="button"
          onClick={() => setInfoOpen(true)}
          aria-label="Ses kaynakları ve lisans"
          className="text-muted min-h-11 min-w-11 shrink-0 rounded-lg border border-line text-sm"
        >
          <span aria-hidden>&#9432;</span>
        </button>
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
        loopSectionId={state.loopSectionId}
        onJump={jumpToSection}
      />

      <main className="min-h-0 flex-1">
        <TabCanvas
          timeline={timeline}
          plan={plan}
          getPosition={getPosition}
          running={state.status === "playing"}
          activeBarKey={activeBarKey}
          onActiveBarChange={setActiveBarKey}
          onSeekBar={seekToBar}
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
        onOpenDetails={() => setTrackSheetOpen(true)}
      />

      <TransportBar
        state={state}
        runs={runs}
        onPlayPause={() => controller.toggle()}
        onRewind={() => controller.rewind()}
        onToggleLoop={toggleLoop}
        onToggleMetronome={() => controller.setMetronome(!state.metronome)}
        onBpmChange={(bpm) => controller.setBpm(bpm)}
      />

      {track ? (
        <TrackSheet
          track={track}
          open={trackSheetOpen}
          onClose={() => setTrackSheetOpen(false)}
        />
      ) : null}

      <InfoSheet open={infoOpen} onClose={() => setInfoOpen(false)} />
    </div>
  );
}

"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { ArrangeSheet, type ArrangeForm } from "@/components/workspace/ArrangeSheet";
import { EditToolbar } from "@/components/workspace/EditToolbar";
import { FretSheet, type FretSheetTarget } from "@/components/workspace/FretSheet";
import { InfoSheet } from "@/components/workspace/InfoSheet";
import { PreviewSheet } from "@/components/workspace/PreviewSheet";
import { SectionChips } from "@/components/workspace/SectionChips";
import { BAR_KEY_ATTRIBUTE, TabCanvas } from "@/components/workspace/TabCanvas";
import { GUTTER_WIDTH } from "@/components/workspace/geometry";
import { TrackSelector, trackSummary } from "@/components/workspace/TrackSelector";
import { TrackSheet } from "@/components/workspace/TrackSheet";
import { TransportBar } from "@/components/workspace/TransportBar";
import { useDebugHandle } from "@/lib/audio/use-debug-handle";
import { usePlayback } from "@/lib/audio/use-playback";
import { BRAND_NAME } from "@/lib/brand";
import { availableSkills, targetsFor } from "@/lib/copilot/ui-options";
import { useCoArranger } from "@/lib/copilot/use-co-arranger";
import { formatTimeSignature } from "@/lib/music/timing";
import { applyEdit, isEditableTrack, type EditCommand } from "@/lib/song/edit";
import { useSong } from "@/lib/song/use-song";
import { buildTrackTimeline, sectionRuns } from "@/lib/tab/timeline";

type Cell = { barKey: string; slotIndex: number; stringIndex: number };

export function Workspace() {
  const { song, message, canUndo, persisted, commit, undo } = useSong();
  const { controller, state } = usePlayback(song);
  useDebugHandle(controller);

  const firstTrackId = song.tracks[0]?.id ?? "";
  const [selectedTrackId, setSelectedTrackId] = useState(firstTrackId);
  const [activeBarKey, setActiveBarKey] = useState<string | null>(null);
  const [trackSheetOpen, setTrackSheetOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const [editing, setEditing] = useState(false);
  const [cell, setCell] = useState<Cell | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  const track =
    song.tracks.find((entry) => entry.id === selectedTrackId) ?? song.tracks[0];

  const copilot = useCoArranger(song, {
    onApply: commit,
    onBeforePreviewPlay: () => controller.pause(),
  });
  const previewOpen =
    copilot.state.status === "preview_ready" ||
    copilot.state.status === "preview_playing" ||
    copilot.state.status === "applying";
  const arrangeOpen =
    copilot.state.status === "editing_request" ||
    copilot.state.status === "submitting" ||
    copilot.state.status === "error";

  const skills = useMemo(() => availableSkills(song), [song]);
  const [form, setForm] = useState<ArrangeForm>(() => {
    const skill = skills[0] ?? "drums";
    return {
      sectionId: song.sections[0]?.id ?? "",
      skill,
      targetTrackId: targetsFor(song, skill)[0]?.id ?? "",
      styleId: null,
      instruction: "",
    };
  });

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
    const current = activeBarKey?.split(":")[0] ?? runs[0]?.sectionId ?? null;
    controller.setLoopSection(state.loopSectionId ? null : current);
  }, [activeBarKey, controller, runs, state.loopSectionId]);

  // Editing and a candidate never share the screen: a candidate is measured
  // against the song as it was when it was asked for.
  const canEdit = track !== undefined && isEditableTrack(track) && !previewOpen;
  const editDisabledReason =
    track === undefined
      ? null
      : canEdit
        ? null
        : `"${track.name}" bu ekrandan düzenlenemiyor. Şimdilik yalnız akordu olan telli track'ler düzenlenebiliyor.`;

  const toggleEdit = useCallback(() => {
    setEditError(null);
    setCell(null);
    setEditing((was) => {
      // Editing and playback do not share the screen (spec 13.1).
      if (!was) controller.pause();
      return !was;
    });
  }, [controller]);

  const currentFret = useMemo(() => {
    if (!cell || timeline.kind !== "fretted") return null;
    const bar = timeline.bars.find((entry) => entry.key === cell.barKey);
    const span = bar?.spans.find(
      (entry) =>
        entry.startSlot === cell.slotIndex &&
        !entry.openStart &&
        entry.stringIndex === cell.stringIndex,
    );
    return span?.fret ?? null;
  }, [cell, timeline]);

  const fretTarget: FretSheetTarget | null = useMemo(() => {
    if (!cell || timeline.kind !== "fretted") return null;
    const bar = timeline.bars.find((entry) => entry.key === cell.barKey);
    if (!bar) return null;
    return {
      barNumber: bar.barNumber,
      slotIndex: cell.slotIndex,
      stringIndex: cell.stringIndex,
      currentFret,
    };
  }, [cell, currentFret, timeline]);

  const runCommand = useCallback(
    (build: (target: { sectionId: string; barIndex: number }) => EditCommand) => {
      if (!cell || !track) return;
      const [sectionId, barIndexText] = cell.barKey.split(":");
      const barIndex = Number(barIndexText);
      if (!sectionId || !Number.isInteger(barIndex)) return;

      const result = applyEdit(song, build({ sectionId, barIndex }));
      if (!result.ok) {
        setEditError(result.error.message);
        return;
      }
      setEditError(null);
      commit(result.song);
    },
    [cell, commit, song, track],
  );

  const nudge = useCallback(
    (delta: { slot?: number; string?: number }) => {
      if (!cell || timeline.kind !== "fretted") return;
      const bar = timeline.bars.find((entry) => entry.key === cell.barKey);
      if (!bar) return;
      const slotIndex = Math.min(
        bar.slotCount - 1,
        Math.max(0, cell.slotIndex + (delta.slot ?? 0)),
      );
      const stringIndex = Math.min(
        timeline.strings.length - 1,
        Math.max(0, cell.stringIndex + (delta.string ?? 0)),
      );
      setEditError(null);
      setCell({ ...cell, slotIndex, stringIndex });
    },
    [cell, timeline],
  );

  const activeSectionId = activeBarKey?.split(":")[0] ?? null;
  const firstBar = song.sections[0]?.bars[0];
  const meter = firstBar ? formatTimeSignature(firstBar.timeSignature) : "";
  const fretboard = track?.fretboard;

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

      {!persisted ? (
        <p
          role="status"
          className="border-reject/50 bg-raised border-b px-3 py-2 text-xs"
        >
          Değişiklikler kaydedilemiyor; bu oturumda bellekte tutuluyor.
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
          editing={editing}
          selectedCell={cell}
          onCellSelect={(next) => {
            setEditError(null);
            setCell(next);
          }}
        />
      </main>

      {track ? (
        <p className="text-muted truncate border-t border-line px-3 py-1.5 text-[11px]">
          {trackSummary(track)}
        </p>
      ) : null}

      <EditToolbar
        editing={editing}
        canEdit={canEdit}
        editDisabledReason={editDisabledReason}
        onToggleEdit={toggleEdit}
        onArrange={() => {
          controller.pause();
          setEditing(false);
          setCell(null);
          copilot.open();
        }}
        arrangeDisabled={skills.length === 0 || previewOpen}
        canUndo={canUndo}
        onUndo={undo}
      />

      <TrackSelector
        tracks={song.tracks}
        selectedTrackId={track?.id ?? ""}
        onSelect={(id) => {
          setEditing(false);
          setCell(null);
          setSelectedTrackId(id);
        }}
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

      {editing && fretboard && track ? (
        <FretSheet
          key={`${cell?.barKey}:${cell?.slotIndex}:${cell?.stringIndex}:${currentFret}`}
          open={cell !== null && !previewOpen}
          fretboard={fretboard}
          target={fretTarget}
          error={editError}
          onClose={() => {
            setCell(null);
            setEditError(null);
          }}
          onNudge={nudge}
          onCommit={(fret) =>
            runCommand(({ sectionId, barIndex }) => ({
              kind: "set_note",
              target: {
                sectionId,
                trackId: track.id,
                barIndex,
                slotIndex: cell?.slotIndex ?? 0,
              },
              stringIndex: cell?.stringIndex ?? 0,
              fret,
            }))
          }
          onClearString={() =>
            runCommand(({ sectionId, barIndex }) => ({
              kind: "clear_string",
              target: {
                sectionId,
                trackId: track.id,
                barIndex,
                slotIndex: cell?.slotIndex ?? 0,
              },
              stringIndex: cell?.stringIndex ?? 0,
            }))
          }
          onRest={() =>
            runCommand(({ sectionId, barIndex }) => ({
              kind: "set_rest",
              target: {
                sectionId,
                trackId: track.id,
                barIndex,
                slotIndex: cell?.slotIndex ?? 0,
              },
            }))
          }
          onTie={() =>
            runCommand(({ sectionId, barIndex }) => ({
              kind: "set_tie",
              target: {
                sectionId,
                trackId: track.id,
                barIndex,
                slotIndex: cell?.slotIndex ?? 0,
              },
            }))
          }
        />
      ) : null}

      <ArrangeSheet
        open={arrangeOpen}
        song={song}
        form={form}
        onChange={setForm}
        onClose={copilot.close}
        submitting={copilot.state.status === "submitting"}
        demo={copilot.demo}
        error={copilot.state.error?.message ?? null}
        onSubmit={() =>
          copilot.submit({
            operation: "arrange_track",
            skill: form.skill,
            sectionId: form.sectionId,
            targetTrackId: form.targetTrackId,
            ...(form.styleId ? { styleId: form.styleId } : {}),
            ...(form.instruction.trim()
              ? { instruction: form.instruction.trim() }
              : {}),
          })
        }
      />

      <PreviewSheet
        open={previewOpen}
        status={copilot.state.status}
        source={copilot.state.source}
        diff={copilot.state.diff}
        warnings={copilot.state.warnings}
        error={copilot.state.error?.message ?? null}
        stale={copilot.isStaleNow}
        onPlay={copilot.play}
        onStop={copilot.stop}
        onApply={copilot.apply}
        onReject={copilot.close}
      />

      <InfoSheet open={infoOpen} onClose={() => setInfoOpen(false)} />
    </div>
  );
}

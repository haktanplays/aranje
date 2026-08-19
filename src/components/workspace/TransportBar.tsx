"use client";

import { bpmRange } from "@/lib/limits";
import type { PlaybackState } from "@/lib/audio/playback";
import type { SectionRun } from "@/components/workspace/SectionChips";

const BUSY: PlaybackState["status"][] = ["loading"];

function statusLabel(state: PlaybackState): string {
  switch (state.status) {
    case "loading": {
      const p = state.progress;
      return p && p.totalBuffers > 0
        ? `Sesler yükleniyor ${p.buffers}/${p.totalBuffers}`
        : "Sesler yükleniyor";
    }
    case "ended":
      return "Bitti";
    case "paused":
      return "Duraklatıldı";
    case "playing":
      return "Çalıyor";
    case "error":
      return "Ses hatası";
    default:
      return "Hazır";
  }
}

function IconButton({
  label,
  onClick,
  active,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className={`flex min-h-11 min-w-11 items-center justify-center rounded-lg border text-sm disabled:opacity-40 ${
        active
          ? "border-bronze/60 bg-raised text-bronze"
          : "border-line text-muted"
      }`}
    >
      {children}
    </button>
  );
}

export function TransportBar({
  state,
  runs,
  onPlayPause,
  onRewind,
  onToggleLoop,
  onToggleMetronome,
  onBpmChange,
}: {
  state: PlaybackState;
  runs: readonly SectionRun[];
  onPlayPause: () => void;
  onRewind: () => void;
  onToggleLoop: () => void;
  onToggleMetronome: () => void;
  onBpmChange: (bpm: number) => void;
}) {
  const busy = BUSY.includes(state.status);
  const playing = state.status === "playing";
  const loopRun = runs.find((run) => run.sectionId === state.loopSectionId);

  return (
    <footer className="border-t border-line">
      {state.error ? (
        <p
          role="alert"
          className="border-reject/60 bg-raised text-text border-b px-3 py-2 text-xs"
        >
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center gap-2 px-3 py-2">
        <IconButton label="Başa dön" onClick={onRewind} disabled={busy}>
          <span aria-hidden>&#9198;</span>
        </IconButton>

        <button
          type="button"
          onClick={onPlayPause}
          disabled={busy}
          aria-label={playing ? "Duraklat" : "Çal"}
          className="bg-bronze flex min-h-11 min-w-14 items-center justify-center rounded-lg px-4 text-base font-semibold text-[#1A1409] disabled:opacity-50"
        >
          <span aria-hidden>{playing ? "⏸" : "▶"}</span>
        </button>

        <IconButton
          label="Section loop"
          onClick={onToggleLoop}
          active={Boolean(state.loopSectionId)}
          disabled={busy || runs.length === 0}
        >
          <span aria-hidden>&#8635;</span>
        </IconButton>

        <IconButton
          label="Metronom"
          onClick={onToggleMetronome}
          active={state.metronome}
          disabled={busy}
        >
          <span aria-hidden>&#9834;</span>
        </IconButton>

        <label className="ml-auto flex items-center gap-2">
          <span className="sr-only">Tempo</span>
          <input
            type="range"
            min={bpmRange.min}
            max={bpmRange.max}
            step={1}
            value={state.bpm}
            onChange={(event) => onBpmChange(Number(event.target.value))}
            className="accent-bronze h-11 w-20"
            aria-label="Tempo"
          />
          <span className="text-text w-14 shrink-0 text-right font-mono text-xs tabular-nums">
            {state.bpm} BPM
          </span>
        </label>
      </div>

      <p className="text-muted/80 px-3 pb-2 text-[11px]">
        {statusLabel(state)}
        {loopRun ? ` · Loop: ${loopRun.name}` : ""}
      </p>
    </footer>
  );
}

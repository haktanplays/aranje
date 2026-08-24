"use client";

import { DEFAULT_PRACTICE_PERCENT } from "@/lib/audio/practice-rate";
import type { PlaybackState } from "@/lib/audio/playback";
import type { SectionRun } from "@/lib/tab/timeline";

const BUSY: PlaybackState["status"][] = ["loading"];

/**
 * What the transport has to say, or nothing.
 *
 * "Hazır" and "Duraklatıldı" were a permanent line at the bottom of the screen
 * restating what the play button already showed. A status line earns its space
 * when it says something the controls cannot: sounds still loading, an error,
 * the end of the song. The rest of the time it is not there.
 */
function statusLabel(state: PlaybackState): string | null {
  switch (state.status) {
    case "loading": {
      const p = state.progress;
      return p && p.totalBuffers > 0
        ? `Sesler yükleniyor ${p.buffers}/${p.totalBuffers}`
        : "Sesler yükleniyor";
    }
    case "ended":
      return "Bitti";
    case "error":
      return "Ses hatası";
    default:
      return null;
  }
}

function IconButton({
  label,
  onClick,
  active,
  disabled,
  children,
  ...rest
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
} & Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "disabled" | "children"
>) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      {...rest}
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
  onOpenMixer,
  auditioning,
  onOpenPracticeRate,
}: {
  state: PlaybackState;
  runs: readonly SectionRun[];
  onPlayPause: () => void;
  onRewind: () => void;
  onToggleLoop: () => void;
  onToggleMetronome: () => void;
  /** Opens the mixer sheet (spec 13.18). */
  onOpenMixer: () => void;
  /** Any track silenced or soloed this session, so the control says so. */
  auditioning: boolean;
  onOpenPracticeRate: () => void;
}) {
  const busy = BUSY.includes(state.status);
  const status = statusLabel(state);
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

      {/*
        A track with no sound is not a failure of playback — the rest of the
        song is playing — so it is announced, not alerted (2O-B.1 §2).
      */}
      {state.silentTrackNotice ? (
        <p
          role="status"
          data-silent-track-notice
          className="border-line bg-raised text-muted border-b px-3 py-2 text-xs"
        >
          {state.silentTrackNotice}
        </p>
      ) : null}

      {/*
        The control row, and the whole of it (2Q-A §3).

        At 320px this row needed 355.7px and lost 23.7px off the practice
        pill — clipped by the workspace shell's `overflow-hidden`, so the
        control did not scroll into reach, it simply was not there
        (`eval/multitrack/BASELINE.json`). Hiding a control behind an overflow
        rule is not a layout; it is a control the reader does not have.

        The fix is spacing, not subtraction: below 360px the gaps and the
        padding tighten and the play button drops to the same 44px square as
        its neighbours. Nothing is removed, nothing moves to a second row, and
        no second horizontal scroller appears. At 360px and above — which is
        every phone the app is measured at except the 320 class — the row is
        byte-for-byte the layout it already was.
      */}
      <div
        className="flex items-center gap-1 px-2 py-1.5 xs:gap-2 xs:px-3"
        style={{ paddingBottom: "max(0.375rem, env(safe-area-inset-bottom))" }}
      >
        <IconButton label="Başa dön" onClick={onRewind} disabled={busy}>
          <span aria-hidden>&#9198;</span>
        </IconButton>

        <button
          type="button"
          onClick={onPlayPause}
          disabled={busy}
          aria-label={playing ? "Duraklat" : "Çal"}
          /*
           * Wider than its neighbours where the width exists, and a plain
           * 44px square where it does not. The emphasis is worth twelve
           * pixels on a 390px screen and is not worth a missing control on a
           * 320px one.
           */
          className="bg-bronze flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 text-base font-semibold text-[#1A1409] disabled:opacity-50 xs:min-w-14 xs:px-4"
        >
          <span aria-hidden>{playing ? "⏸" : "▶"}</span>
        </button>

        <IconButton
          /*
           * The one accessible name on this screen that was still English.
           * A screen reader saying "Section loop" between "Çal" and
           * "Metronom" is the app changing language mid-sentence.
           */
          label="Bölüm döngüsü"
          onClick={onToggleLoop}
          active={Boolean(state.loopSectionId)}
          disabled={busy || runs.length === 0}
        >
          <span aria-hidden>&#8635;</span>
        </IconButton>

        <IconButton
          /*
           * The mixer is a listening tool, so it sits with the listening
           * controls. It stays lit while anything is silenced or soloed:
           * a track muted ten minutes ago is easy to forget, and the
           * transport is where you would notice something is missing.
           */
          label={
            auditioning
              ? "Mikser: bir track susturulmuş veya tek dinleniyor"
              : "Mikser"
          }
          onClick={onOpenMixer}
          active={auditioning}
          data-open-mixer
        >
          <span aria-hidden>&#9707;</span>
        </IconButton>

        <IconButton
          label="Metronom"
          onClick={onToggleMetronome}
          active={state.metronome}
          disabled={busy}
        >
          <span aria-hidden>&#9834;</span>
        </IconButton>

        {/*
          The practice rate, as one pill.
          
          Two rows of controls and a repeated "138 BPM · %100" were spending
          seventy pixels to say a number that is 100 almost always. The pill
          says the number; tapping it opens the − / + / reset it used to keep
          on screen permanently, along with the arithmetic.
        */}
        <button
          type="button"
          onClick={onOpenPracticeRate}
          aria-label={`Çalışma hızı yüzde ${state.practicePercent}. Değiştir`}
          /*
           * `min-w-11` is new and is not decoration: the pill was 59.7px wide
           * because of its text, not because anything required it to be, so
           * a larger system font or a three-digit percentage could have taken
           * it under the touch minimum without anything failing.
           */
          className={`ml-auto min-h-11 min-w-11 shrink-0 rounded-lg border px-2 font-mono text-sm tabular-nums xs:px-3 ${
            state.practicePercent === DEFAULT_PRACTICE_PERCENT
              ? "border-line text-muted"
              : "border-bronze/60 text-bronze"
          }`}
        >
          %{state.practicePercent}
        </button>
      </div>

      {/* A line only when there is something to say that the buttons cannot. */}
      {status || loopRun ? (
        <p data-transport-status className="text-muted/80 px-3 pb-1.5 text-[11px]">
          {[status, loopRun ? `Döngü: ${loopRun.name}` : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}
    </footer>
  );
}

"use client";

/**
 * The one door every exported file goes out of (spec 13.19, 2M-A §12, §15).
 *
 * Three formats, one state machine, one place that mints an Object URL and
 * one place that revokes it. The single entry point is deliberate beyond
 * tidiness: an entitlement check, a quota or a paywall does not exist in this
 * checkpoint and must not need to be retrofitted into three components when
 * it does — so no component gets its own download path.
 *
 * ## What an export is not allowed to touch
 *
 * The song, storage, the history, the fingerprint, the clipboard, the
 * selection and the online audio graph. Reading is all it does: the render
 * builds its *own* offline context, and the only thing it ever asks of the
 * live app is to stop playing first.
 *
 * ## One job at a time
 *
 * A second export while one is running is refused rather than queued. Two
 * renders on one device would fight for the same samples and the same CPU,
 * and the second file would be the one the user is looking at while the first
 * one is still writing — an easy way to hand someone the wrong audio.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { exportProject } from "@/lib/project/project-file";
import { PROJECT_FILE_MIME, projectFileName } from "@/lib/project/project-file-name";
import {
  ATTRIBUTION_FILE_NAME,
  ATTRIBUTION_MIME,
  attributionText,
} from "@/lib/export/attribution";
import {
  EXPORT_MESSAGES,
  EXPORT_STATUS_TEXT,
  type ExportErrorCode,
} from "@/lib/export/export-messages";
import {
  estimateWav,
  formatBytes,
  formatDuration,
  midiFileName,
  MIDI_MIME,
  wavFileName,
  WAV_MIME,
  type WavEstimate,
} from "@/lib/export/export-plan";
import { buildMidiPlan } from "@/lib/export/midi-plan";
import { writeMidiFile } from "@/lib/export/midi-writer";
import { encodeWav } from "@/lib/export/wav-encoder";
import { renderSongToBuffer, type RenderOptions } from "@/lib/export/render-wav";
import type { Song } from "@/lib/song/schema";

export type ExportFormat = "project" | "wav" | "midi";

/** Which tracks a WAV should contain. Asked, never inferred. */
export type WavScope = "all" | "audible";

export type ExportPhase =
  | "idle"
  | "preparing"
  | "rendering"
  | "encoding"
  | "ready"
  | "error";

export type ExportReady = {
  readonly format: ExportFormat;
  readonly fileName: string;
  readonly url: string;
  readonly bytes: number;
  /** Audio only; null for MIDI and the project file. */
  readonly seconds: number | null;
  readonly sizeText: string;
  readonly durationText: string | null;
};

export type ExportHandle = {
  readonly phase: ExportPhase;
  /** What the machine is doing, in the reader's words. Null when idle. */
  readonly statusText: string | null;
  readonly ready: ExportReady | null;
  readonly error: string | null;
  readonly busy: boolean;
  /** Pre-flight numbers, so nobody starts a render blind. */
  readonly wavEstimate: WavEstimate;
  readonly wavEstimateText: string;
  readonly midiEventEstimate: number;
  readonly scope: WavScope;
  setScope(scope: WavScope): void;
  /** True when the session audition would actually change the audible mix. */
  readonly auditionActive: boolean;
  exportProjectFile(): Promise<void>;
  exportWav(): Promise<void>;
  exportMidi(): Promise<void>;
  downloadAttribution(): void;
  /** Drop the finished file and go back to idle, revoking its URL. */
  reset(): void;
};

type Deps = {
  song: Song;
  /**
   * Who the session is listening to right now, from the mixer.
   *
   * Only ever used when the user picked "Şu anda duyduklarım": passing it in
   * rather than computing it here keeps one owner for the mute/solo rules,
   * and makes it structurally impossible for the "Tüm track'ler" path to
   * consult the audition by accident.
   */
  audibleTrackIds: readonly string[];
  /** Stop the transport before rendering. Never rewinds, never resumes. */
  pausePlayback(): void;
  /** Injected so a test can render without Tone; the app passes nothing. */
  render?: (song: Song, options: RenderOptions) => Promise<{
    channels: readonly Float32Array[];
    sampleRate: number;
  }>;
};

export function useExport(deps: Deps): ExportHandle {
  const { song, audibleTrackIds, pausePlayback } = deps;

  const [phase, setPhase] = useState<ExportPhase>("idle");
  const [statusText, setStatusText] = useState<string | null>(null);
  const [ready, setReady] = useState<ExportReady | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<WavScope>("all");

  /*
   * The URL of the file currently on offer, and the guard that stops a second
   * export starting. A ref rather than state for both: they are read inside
   * async work that must see the value as it is *now*, not as it was when the
   * closure was made.
   */
  const currentUrl = useRef<string | null>(null);
  const running = useRef(false);

  const revoke = useCallback(() => {
    if (currentUrl.current !== null) {
      URL.revokeObjectURL(currentUrl.current);
      currentUrl.current = null;
    }
  }, []);

  // A file left on offer when the screen goes away is a leak with nobody to
  // click it; the last URL is revoked on unmount.
  useEffect(() => revoke, [revoke]);

  const reset = useCallback(() => {
    revoke();
    setReady(null);
    setError(null);
    setStatusText(null);
    setPhase("idle");
  }, [revoke]);

  const fail = useCallback(
    (code: ExportErrorCode) => {
      /*
       * The previous file goes with the failure. Leaving it on offer would
       * mean a "Dışa aktarma tamamlanamadı" message sitting above a download
       * button that hands over last time's audio — the exact stale-file trap
       * this state machine exists to prevent.
       */
      revoke();
      setReady(null);
      setStatusText(null);
      setError(EXPORT_MESSAGES[code]);
      setPhase("error");
    },
    [revoke],
  );

  /** Hand a finished byte array to the browser as a downloadable URL. */
  const offer = useCallback(
    (
      format: ExportFormat,
      fileName: string,
      bytes: BlobPart,
      mime: string,
      seconds: number | null,
    ) => {
      revoke();
      const blob = new Blob([bytes], { type: mime });
      const url = URL.createObjectURL(blob);
      currentUrl.current = url;
      setReady({
        format,
        fileName,
        url,
        bytes: blob.size,
        seconds,
        sizeText: formatBytes(blob.size),
        durationText: seconds === null ? null : formatDuration(seconds),
      });
      setError(null);
      setStatusText(EXPORT_STATUS_TEXT.ready);
      setPhase("ready");
    },
    [revoke],
  );

  /** The one-job-at-a-time gate, shared by all three formats. */
  const claim = useCallback((): boolean => {
    if (running.current) {
      setError(EXPORT_MESSAGES.busy);
      return false;
    }
    running.current = true;
    return true;
  }, []);

  const exportProjectFile = useCallback(async () => {
    if (!claim()) return;
    try {
      setPhase("encoding");
      setStatusText(EXPORT_STATUS_TEXT.encodingProject);
      const result = exportProject(song);
      if (!result.ok) {
        fail("project_failed");
        return;
      }
      offer(
        "project",
        projectFileName(song.title),
        result.text,
        PROJECT_FILE_MIME,
        null,
      );
    } finally {
      running.current = false;
    }
  }, [claim, fail, offer, song]);

  const exportWav = useCallback(async () => {
    if (!claim()) return;
    try {
      // Visible, deliberate, and not undone afterwards: the playhead stays
      // where it was and nothing starts playing again by itself.
      pausePlayback();

      setPhase("preparing");
      setStatusText(EXPORT_STATUS_TEXT.preparing);

      const options: RenderOptions =
        scope === "audible" ? { audibleTrackIds } : {};

      setPhase("rendering");
      setStatusText(EXPORT_STATUS_TEXT.renderingWav);

      const rendered = deps.render
        ? await deps.render(song, options)
        : await renderSongToBuffer(song, options);

      setPhase("encoding");
      setStatusText(EXPORT_STATUS_TEXT.encodingWav);

      const encoded = encodeWav({
        channels: rendered.channels,
        sampleRate: rendered.sampleRate,
      });
      if (!encoded.ok) {
        fail("encode_failed");
        return;
      }

      const frames = rendered.channels[0]?.length ?? 0;
      offer(
        "wav",
        wavFileName(song.title),
        encoded.bytes,
        WAV_MIME,
        rendered.sampleRate > 0 ? frames / rendered.sampleRate : 0,
      );
    } catch {
      // Whatever Tone or the browser threw stays here: the reader gets a
      // sentence, not a stack.
      fail("render_failed");
    } finally {
      running.current = false;
    }
  }, [audibleTrackIds, claim, deps, fail, offer, pausePlayback, scope, song]);

  const exportMidi = useCallback(async () => {
    if (!claim()) return;
    try {
      setPhase("encoding");
      setStatusText(EXPORT_STATUS_TEXT.encodingMidi);

      // MIDI is the song. The session audition is not consulted here and
      // there is no scope choice for it (§3).
      const plan = buildMidiPlan(song);
      if (!plan.ok) {
        fail("midi_failed");
        return;
      }
      const written = writeMidiFile(plan.plan);
      if (!written.ok) {
        fail("midi_failed");
        return;
      }
      offer("midi", midiFileName(song.title), written.bytes, MIDI_MIME, null);
    } catch {
      fail("midi_failed");
    } finally {
      running.current = false;
    }
  }, [claim, fail, offer, song]);

  /*
   * The credit file is not an "export" in the state-machine sense: it takes
   * no render, cannot fail, and must stay available while a WAV is on offer —
   * which is exactly when someone needs it. So it mints its own short-lived
   * URL and does not touch `currentUrl`.
   */
  const downloadAttribution = useCallback(() => {
    const blob = new Blob([attributionText()], { type: ATTRIBUTION_MIME });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = ATTRIBUTION_FILE_NAME;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, []);

  const wavEstimate = estimateWav(song);
  const midiPlan = buildMidiPlan(song);

  return {
    phase,
    statusText,
    ready,
    error,
    busy: phase === "preparing" || phase === "rendering" || phase === "encoding",
    wavEstimate,
    wavEstimateText: `${formatDuration(wavEstimate.seconds)} · ${formatBytes(
      wavEstimate.bytes,
    )}`,
    midiEventEstimate: midiPlan.ok ? midiPlan.plan.eventCount : 0,
    scope,
    setScope,
    auditionActive: audibleTrackIds.length !== song.tracks.length,
    exportProjectFile,
    exportWav,
    exportMidi,
    downloadAttribution,
    reset,
  };
}

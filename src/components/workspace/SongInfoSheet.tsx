"use client";

/**
 * The four facts a song states about itself (spec 13.17, 2L-B §5).
 *
 * Title, tonic, mode, base tempo — drafted here, applied as one commit
 * through the lifecycle controller. The tonic and mode are music words, not
 * a technical tonality id; the tempo bounds come from the central limits and
 * are printed, not re-invented. A no-op apply closes the sheet and leaves no
 * history behind; a validation error rejects atomically and says why;
 * warnings are shown and do not block.
 */
import { useState } from "react";

import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import { bpmRange } from "@/lib/limits";
import {
  KEY_MODE_LABELS,
  TONIC_OPTIONS,
  parseKey,
  type KeyMode,
} from "@/lib/song/song-lifecycle";
import type { Song } from "@/lib/song/schema";
import type { LifecycleHandle } from "@/lib/workspace/use-lifecycle";
import type { ValidationIssue } from "@/lib/validators";

const FIELD =
  "border-line bg-raised min-h-11 w-full rounded-lg border px-3 text-sm";

export function SongInfoSheet({
  open,
  onClose,
  song,
  lifecycle,
}: {
  open: boolean;
  onClose: () => void;
  song: Song;
  lifecycle: LifecycleHandle;
}) {
  const parsed = parseKey(song.key);
  const [title, setTitle] = useState(song.title);
  const [tonic, setTonic] = useState(parsed?.tonic ?? "E");
  const [mode, setMode] = useState<KeyMode>(parsed?.mode ?? "minor");
  const [bpm, setBpm] = useState(String(song.bpm));
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<readonly ValidationIssue[]>([]);

  if (!open) return null;

  const apply = () => {
    const outcome = lifecycle.runSong({
      kind: "update_song_info",
      info: { title, tonic, mode, bpm: Number(bpm) },
    });
    if (outcome.status === "rejected" || outcome.status === "blocked") {
      setError(outcome.message);
      return;
    }
    setError(null);
    if (outcome.status === "applied" && outcome.warnings.length > 0) {
      // Applied — the warnings are information, and worth a look before the
      // sheet goes away on the reader's own close.
      setWarnings(outcome.warnings);
      return;
    }
    onClose();
  };

  return (
    <Sheet
      open={open}
      title="Şarkı bilgileri"
      onClose={onClose}
      labelledBy="song-info-sheet-title"
      footer={
        <div className="flex gap-2">
          <SheetButton onClick={onClose}>Vazgeç</SheetButton>
          <SheetButton
            data-song-info-apply
            tone="primary"
            onClick={apply}
            disabled={!lifecycle.canApply}
          >
            Uygula
          </SheetButton>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className="text-muted mb-1 block text-xs">Şarkı adı</span>
          <input
            type="text"
            data-song-info-title
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={FIELD}
          />
        </label>

        <div className="flex gap-2">
          <label className="block flex-1">
            <span className="text-muted mb-1 block text-xs">Tonik</span>
            <select
              data-song-info-tonic
              value={tonic}
              onChange={(event) => setTonic(event.target.value)}
              className={FIELD}
            >
              {TONIC_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="block flex-1">
            <span className="text-muted mb-1 block text-xs">Mod</span>
            <select
              data-song-info-mode
              value={mode}
              onChange={(event) => setMode(event.target.value as KeyMode)}
              className={FIELD}
            >
              {(Object.keys(KEY_MODE_LABELS) as KeyMode[]).map((option) => (
                <option key={option} value={option}>
                  {KEY_MODE_LABELS[option]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="text-muted mb-1 block text-xs">
            Temel tempo (BPM, {bpmRange.min}–{bpmRange.max})
          </span>
          <input
            type="number"
            data-song-info-bpm
            inputMode="numeric"
            min={bpmRange.min}
            max={bpmRange.max}
            value={bpm}
            onChange={(event) => setBpm(event.target.value)}
            className={FIELD}
          />
        </label>
        <p className="text-muted text-xs">
          Bölümlerin kendi tempoları varsa korunur.
        </p>

        {error ? (
          <p role="alert" data-lifecycle-error className="text-reject text-xs">
            {error}
          </p>
        ) : null}
        {warnings.length > 0 ? (
          <div data-lifecycle-warning className="border-line border-t pt-2">
            <p className="text-muted pb-1 text-xs tracking-wide uppercase">
              Uyarılar — engellemez
            </p>
            <ul className="text-muted space-y-1 text-xs">
              {warnings.slice(0, 6).map((issue, index) => (
                <li key={index}>{issue.message}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

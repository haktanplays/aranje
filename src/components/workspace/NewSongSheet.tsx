"use client";

/**
 * Starting a new song (spec 13.17, 2L-B §3).
 *
 * The sheet says plainly that the current song is being replaced, offers the
 * 2L-A backup on the spot — the same export path, not a second serializer —
 * and only then the three templates. Creating goes through the lifecycle
 * controller as one commit; undo brings the old song back whole.
 */
import { useState } from "react";

import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import { NEW_SONG_WARNING } from "@/lib/song/lifecycle-messages";
import { SONG_TEMPLATES, type SongTemplateId } from "@/lib/song/song-templates";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type { LifecycleHandle } from "@/lib/workspace/use-lifecycle";

export function NewSongSheet({
  open,
  onClose,
  lifecycle,
  onBackup,
  backupError,
}: {
  open: boolean;
  onClose: () => void;
  lifecycle: LifecycleHandle;
  /** The 2L-A download, unchanged (spec 13.15). */
  onBackup: () => void;
  backupError: string | null;
}) {
  const [templateId, setTemplateId] = useState<SongTemplateId>("empty");
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const create = () => {
    const outcome = lifecycle.runSong({ kind: "create_song", templateId });
    if (outcome.status === "rejected" || outcome.status === "blocked") {
      setError(outcome.message);
      return;
    }
    setError(null);
    onClose();
  };

  return (
    <Sheet
      open={open}
      title="Yeni şarkı"
      onClose={onClose}
      labelledBy="new-song-sheet-title"
      footer={
        <div className="flex gap-2">
          <SheetButton data-new-song-cancel onClick={onClose}>
            Vazgeç
          </SheetButton>
          <SheetButton
            data-new-song-create
            tone="primary"
            onClick={create}
            disabled={!lifecycle.canApply}
          >
            Yeni şarkı oluştur
          </SheetButton>
        </div>
      }
    >
      <p className="text-sm">{NEW_SONG_WARNING}</p>

      <button
        type="button"
        data-new-song-backup
        onClick={onBackup}
        className="border-line mt-3 w-full rounded-lg border text-sm"
        style={{ minHeight: MIN_TOUCH_TARGET_PX }}
      >
        Mevcut şarkıyı yedekle
      </button>
      {backupError ? (
        <p role="alert" className="text-reject mt-2 text-xs">
          {backupError}
        </p>
      ) : null}

      <div
        role="radiogroup"
        aria-label="Şablon seç"
        className="mt-4 flex flex-col gap-1"
      >
        {SONG_TEMPLATES.map((template) => {
          const selected = template.id === templateId;
          return (
            <button
              key={template.id}
              type="button"
              role="radio"
              aria-checked={selected}
              data-new-song-template={template.id}
              onClick={() => setTemplateId(template.id)}
              className={`rounded-lg border px-3 py-2 text-left ${
                selected
                  ? "border-bronze/60 bg-raised text-bronze"
                  : "border-line text-muted"
              }`}
              style={{ minHeight: MIN_TOUCH_TARGET_PX }}
            >
              <span className="block text-sm">{template.label}</span>
              <span className="block text-xs opacity-70">
                {template.description}
              </span>
            </button>
          );
        })}
      </div>

      {!lifecycle.canApply ? (
        <p className="text-muted mt-3 text-xs">
          Değişiklikler kaydedilemediği için yeni şarkı oluşturma kapalı.
          Dinleme ve yedekleme çalışmaya devam eder.
        </p>
      ) : null}
      {error ? (
        <p role="alert" data-lifecycle-error className="text-reject mt-3 text-xs">
          {error}
        </p>
      ) : null}
    </Sheet>
  );
}

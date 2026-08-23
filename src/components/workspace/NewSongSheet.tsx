"use client";

/**
 * Starting a new song (spec 13.17, 2L-B §3; retargeted in 2O-A §18).
 *
 * It no longer replaces anything. A new song is a **new project** beside the
 * one that is open, so the sentence about losing the current song is gone and
 * so is the undo that used to bring it back — there is nothing to bring back,
 * because nothing was taken. The old project is one tap away in the library.
 *
 * The backup is still offered on the spot, through the same export path and
 * not a second serializer: someone about to start something new is exactly
 * who wants a copy of what they have.
 */
import { useState } from "react";

import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import { SONG_TEMPLATES, type SongTemplateId } from "@/lib/song/song-templates";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";

export function NewSongSheet({
  open,
  onClose,
  onCreate,
  createError,
  canCreate,
  onBackup,
  backupError,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * Make a project out of this template (2O-A §18).
   *
   * It used to replace the open song. It does not any more: a new song is a
   * new project beside the one the reader has, and the old one is still there
   * when they go back to it. Returns false when the library refused, so the
   * sheet stays open with the reason.
   */
  onCreate: (templateId: SongTemplateId) => boolean;
  createError: string | null;
  /** False while writing is closed: a new project cannot be persisted. */
  canCreate: boolean;
  /** The 2L-A download, unchanged (spec 13.15). */
  onBackup: () => void;
  backupError: string | null;
}) {
  const [templateId, setTemplateId] = useState<SongTemplateId>("empty");

  if (!open) return null;

  const create = () => {
    if (!onCreate(templateId)) return;
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
            disabled={!canCreate}
          >
            Yeni şarkı oluştur
          </SheetButton>
        </div>
      }
    >
      <p className="text-sm">
        Yeni proje, mevcut projenin yanına eklenir. Şu an açık olan şarkın
        olduğu gibi kalır ve Projeler listesinden geri açabilirsin.
      </p>

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

      {!canCreate ? (
        <p className="text-muted mt-3 text-xs">
          Değişiklikler kaydedilemediği için yeni şarkı oluşturma kapalı.
          Dinleme ve yedekleme çalışmaya devam eder.
        </p>
      ) : null}
      {createError ? (
        <p role="alert" data-lifecycle-error className="text-reject mt-3 text-xs">
          {createError}
        </p>
      ) : null}
    </Sheet>
  );
}

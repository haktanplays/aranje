"use client";

import { SAMPLE_LICENSE, totalSampleBytes } from "@/lib/audio/packs";
import { BRAND_NAME } from "@/lib/brand";

/**
 * Where the sample attribution lives in the running app. CC BY requires the
 * credit to travel with the work, so it has to be reachable from the interface,
 * not only from a file in the repository.
 */
export function InfoSheet({
  open,
  onClose,
  onProjectBackup,
  onExport,
  projectBackupError,
  onOpenProjectFile,
  onNewSong,
  onSongInfo,
  onProjects,
}: {
  open: boolean;
  onClose: () => void;
  /** Downloads the current song as a project file, right here (spec 13.15). */
  onProjectBackup: () => void;
  onExport: () => void;
  /** Set when the last backup attempt was refused; shown under the button. */
  projectBackupError: string | null;
  /** Hands over to the project-file sheet, where a backup can be opened. */
  onOpenProjectFile: () => void;
  /** Hands over to the new-song sheet (spec 13.17). */
  onNewSong: () => void;
  /** Hands over to the song-info sheet (spec 13.17). */
  onSongInfo: () => void;
  /** The project library — the second door onto it, beside the header title. */
  onProjects: () => void;
}) {
  if (!open) return null;

  const kib = Math.round(totalSampleBytes() / 1024);

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Kapat"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <section className="bg-panel relative max-h-[80dvh] overflow-y-auto rounded-t-2xl border-t border-line px-4 pt-3 pb-6">
        <div className="bg-line mx-auto mb-3 h-1 w-10 rounded-full" />
        <h2 className="font-display mb-1 text-lg">{BRAND_NAME}</h2>
        <p className="text-muted mb-4 text-xs">Ses kaynakları ve lisans</p>

        {/* The project file lives behind the info control on purpose: it is
            something done a few times a project, not something worth a
            permanent slice of a phone screen (spec 13.15). */}
        <section className="border-line mb-4 border-b pb-4">
          <h3 className="text-muted mb-2 text-xs">Proje</h3>
          {/*
            The library, first: since 2O-A "yeni şarkı" makes a new project
            beside the current one, so the place they all live is the thing a
            reader most often wants from here.
          */}
          <button
            type="button"
            data-info-projects
            onClick={onProjects}
            className="border-line mb-2 min-h-11 w-full rounded-lg border text-sm"
          >
            Projeler
          </button>
          <div className="mb-2 flex gap-2">
            <button
              type="button"
              data-info-new-song
              onClick={onNewSong}
              className="border-line min-h-11 flex-1 rounded-lg border text-sm"
            >
              Yeni şarkı
            </button>
            <button
              type="button"
              data-info-song-info
              onClick={onSongInfo}
              className="border-line min-h-11 flex-1 rounded-lg border text-sm"
            >
              Şarkı bilgileri
            </button>
          </div>
          {/* The export surface (2M-A): the one visible place a song leaves
              the app, whichever format it leaves as. The one-tap backup
              beside it stays because backing up is a habit, not a decision. */}
          <button
            type="button"
            data-info-export
            onClick={onExport}
            className="border-line mb-2 min-h-11 w-full rounded-lg border text-sm"
          >
            Dışa aktar
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              data-info-project-backup
              onClick={onProjectBackup}
              className="border-line min-h-11 flex-1 rounded-lg border text-sm"
            >
              Projeyi yedekle
            </button>
            <button
              type="button"
              data-info-project-open
              onClick={onOpenProjectFile}
              className="border-line min-h-11 flex-1 rounded-lg border text-sm"
            >
              Yedekten aç
            </button>
          </div>
          {projectBackupError ? (
            <p role="alert" className="text-reject mt-2 text-xs">
              {projectBackupError}
            </p>
          ) : null}
        </section>

        <dl className="divide-y divide-line text-sm">
          <div className="py-2">
            <dt className="text-muted text-xs">Atıf</dt>
            <dd className="mt-1">{SAMPLE_LICENSE.attribution}</dd>
          </div>
          <div className="py-2">
            <dt className="text-muted text-xs">Lisans</dt>
            <dd className="mt-1">
              {SAMPLE_LICENSE.name} ({SAMPLE_LICENSE.spdx})
            </dd>
          </div>
          <div className="py-2">
            <dt className="text-muted text-xs">Lisans metni</dt>
            <dd className="mt-1 break-all">
              <a
                href={SAMPLE_LICENSE.url}
                target="_blank"
                rel="noreferrer"
                className="text-bronze underline"
              >
                {SAMPLE_LICENSE.url}
              </a>
            </dd>
          </div>
          <div className="py-2">
            <dt className="text-muted text-xs">Kaynak</dt>
            <dd className="mt-1 break-all">
              <a
                href={SAMPLE_LICENSE.sourceRepository}
                target="_blank"
                rel="noreferrer"
                className="text-bronze underline"
              >
                {SAMPLE_LICENSE.sourceRepository}
              </a>
            </dd>
          </div>
          <div className="py-2">
            <dt className="text-muted text-xs">Soundfont</dt>
            <dd className="mt-1">{SAMPLE_LICENSE.soundfont}</dd>
          </div>
          <div className="py-2">
            <dt className="text-muted text-xs">Paket boyutu</dt>
            <dd className="mt-1">{kib} KiB</dd>
          </div>
          <div className="py-2">
            <dt className="text-muted text-xs">Çıkış</dt>
            <dd className="text-muted mt-1">
              Stereo. Her track kendi ses seviyesi ve stereo konumuyla çalınır
              (Mikser).
            </dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={onClose}
          className="text-muted mt-4 min-h-11 w-full rounded-lg border border-line text-sm"
        >
          Kapat
        </button>
      </section>
    </div>
  );
}

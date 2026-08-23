"use client";

/**
 * The project-file surface: back the song up, or open a backup (spec 13.15).
 *
 * View only. Everything it shows comes out of `useProjectFile`'s state, and
 * everything it does is one of that handle's five calls — no file is read
 * here, no JSON is parsed here, no URL is minted here, and no error sentence
 * is assembled here. The reader-facing words never say "export" or "import":
 * a musician backs a project up and opens it again.
 */
import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import { instrumentLabel } from "@/lib/instruments/registry";
import type { ProjectFileHandle } from "@/lib/project/use-project-file";
import type { Song } from "@/lib/song/schema";
import { PROJECT_FILE_MESSAGES } from "@/lib/project/project-file-errors";

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-muted shrink-0 text-xs">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm">{value}</dd>
    </div>
  );
}

export function ProjectFileSheet({
  open,
  onClose,
  handle,
  canPersist,
  onAddAsNew,
}: {
  open: boolean;
  onClose: () => void;
  handle: ProjectFileHandle;
  canPersist: boolean;
  /**
   * Add the previewed song as a project of its own (2O-A §19).
   *
   * Injected rather than reached for: the library owns creating projects, and
   * a sheet that could make one would be a second door onto the same command
   * with its own idea of what to do first.
   */
  onAddAsNew: (song: Song) => void;
}) {
  const { state, exportError } = handle;

  const close = () => {
    // Leaving the sheet is leaving the flow: no half-imported file lingers.
    handle.cancel();
    onClose();
  };

  return (
    <Sheet
      open={open}
      title="Proje dosyası"
      onClose={close}
      labelledBy="project-sheet-title"
    >
      <div data-project-sheet className="pb-2">
        <p className="text-muted mb-3 text-xs">
          Şarkını tek bir proje dosyası olarak cihazına indirebilir, daha sonra
          buradan yeniden açabilirsin.
        </p>

        <div className="flex flex-col gap-2">
          <SheetButton data-project-backup onClick={handle.downloadBackup}>
            Projeyi yedekle
          </SheetButton>
          {exportError ? (
            <p data-project-export-error role="alert" className="text-reject text-xs">
              {exportError}
            </p>
          ) : null}

          {/*
            A label around a hidden input, so the native picker opens from the
            same element the reader pressed — no script-opened dialog, and the
            gesture stays theirs.
          */}
          <label
            data-project-open-picker
            className="border-line text-text flex min-h-11 items-center justify-center rounded-lg border px-3 text-sm"
          >
            Yedekten aç
            <input
              data-project-file-input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                // Reset so picking the same file again still fires a change.
                event.target.value = "";
                if (file) handle.openFile(file);
              }}
            />
          </label>
        </div>

        {state.status === "error" ? (
          <p
            data-project-error
            role="alert"
            className="text-reject mt-3 text-sm"
          >
            {state.message}
          </p>
        ) : null}

        {state.status === "preview" ? (
          <div data-project-preview className="mt-4">
            <p className="text-muted truncate text-xs" data-project-file-name>
              {state.fileName}
            </p>

            <dl className="divide-line mt-1 divide-y">
              <PreviewRow label="Şarkı" value={state.preview.title} />
              <PreviewRow label="Tonalite" value={state.preview.songKey} />
              <PreviewRow
                label="Tempo"
                value={
                  state.preview.hasTempoChanges
                    ? `${state.preview.bpm} BPM • bölümlere göre değişiyor`
                    : `${state.preview.bpm} BPM`
                }
              />
              <PreviewRow
                label="Bölümler"
                value={`${state.preview.sectionCount} bölüm · ${state.preview.totalBars} ölçü`}
              />
              <PreviewRow
                label="Track'ler"
                value={`${state.preview.trackCount}`}
              />
              <PreviewRow
                label="Enstrümanlar"
                value={state.preview.instrumentIds.map(instrumentLabel).join(", ")}
              />
            </dl>

            {state.preview.warningCount > 0 ? (
              <p data-project-warning className="text-bronze mt-2 text-xs">
                {state.preview.warningCount} uyarı var; proje yine de açılabilir.
              </p>
            ) : null}

            {/*
              Two destinations, and they are not the same act (2O-A §19).
              Adding is offered first and carries the primary weight, because
              it is the one that cannot cost the reader anything: it leaves
              every project they have exactly where it is. Replacing is still
              here, still one history step, and still says out loud which song
              it is about to stand in for.
            */}
            <p className="text-muted mt-3 text-xs">
              Mevcut projen henüz değişmedi. Bu dosyayı yeni bir proje olarak
              ekleyebilir ya da açık projenin yerine koyabilirsin.
            </p>
            {canPersist ? null : (
              <p data-project-persist-note role="alert" className="text-reject mt-2 text-xs">
                {PROJECT_FILE_MESSAGES.storage_unavailable}
              </p>
            )}

            <div className="mt-3 flex flex-col gap-2">
              <SheetButton
                data-project-add-new
                tone="primary"
                onClick={() => onAddAsNew(state.song)}
                disabled={!canPersist}
              >
                Yeni proje olarak ekle
              </SheetButton>
              <SheetButton
                data-project-backup-current
                onClick={handle.downloadBackup}
              >
                Mevcut projeyi yedekle
              </SheetButton>
              <div className="flex gap-2">
                <SheetButton data-project-cancel onClick={handle.cancel}>
                  Vazgeç
                </SheetButton>
                <SheetButton
                  data-project-apply
                  onClick={handle.apply}
                  disabled={!canPersist}
                >
                  Mevcut projeyi değiştir
                </SheetButton>
              </div>
            </div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={close}
          className="text-muted border-line mt-4 min-h-11 w-full rounded-lg border text-sm"
        >
          Kapat
        </button>
      </div>
    </Sheet>
  );
}

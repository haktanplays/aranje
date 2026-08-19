"use client";

import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import type { DiffSummary } from "@/lib/copilot/preview";
import type { PreviewSource, PreviewStatus } from "@/lib/copilot/preview-machine";
import type { ValidationIssue } from "@/lib/validators/types";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-muted text-sm">{label}</dt>
      <dd className="text-right text-sm tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * The candidate, before it is anybody's song (spec 11.4/6-7).
 *
 * Everything here says the same thing in more than one way: the heading, the
 * word "aday", and the state of the buttons. Spec 13.6 asks for states that do
 * not rely on colour alone, and "this is not saved yet" is the state it would
 * be worst to miss.
 */
export function PreviewSheet({
  open,
  status,
  source,
  diff,
  warnings,
  error,
  stale,
  onPlay,
  onStop,
  onApply,
  onReject,
}: {
  open: boolean;
  status: PreviewStatus;
  source: PreviewSource | null;
  diff: DiffSummary | null;
  warnings: readonly ValidationIssue[];
  error: string | null;
  /** The song moved since the request was sent, so this cannot be applied. */
  stale: boolean;
  onPlay: () => void;
  onStop: () => void;
  onApply: () => void;
  onReject: () => void;
}) {
  const playing = status === "preview_playing";
  const applying = status === "applying";

  return (
    <Sheet
      open={open}
      title="Öneri — henüz kaydedilmedi"
      onClose={onReject}
      labelledBy="preview-sheet-title"
      footer={
        <div className="flex gap-2">
          <SheetButton tone="danger" onClick={onReject} disabled={applying}>
            Reddet
          </SheetButton>
          <SheetButton
            onClick={playing ? onStop : onPlay}
            disabled={applying || diff === null}
          >
            {playing ? "Durdur" : "Dinle"}
          </SheetButton>
          <SheetButton
            tone="primary"
            onClick={onApply}
            disabled={applying || stale || diff === null}
          >
            {applying ? "Uygulanıyor…" : "Uygula"}
          </SheetButton>
        </div>
      }
    >
      <p className="border-bronze/60 bg-bronze/10 text-bronze mb-3 rounded-lg border px-3 py-2 text-xs">
        Bu bir <span className="font-semibold">aday</span>. Dinleyebilirsin;
        &quot;Uygula&quot; demeden şarkına yazılmaz.
        {source === "demo" ? (
          <>
            {" "}
            <span className="font-semibold">Demo</span> — deterministik örnek,
            yapay zekâ üretimi değil.
          </>
        ) : null}
      </p>

      {stale ? (
        <p role="alert" className="text-reject pb-3 text-sm">
          Bu öneri istendikten sonra şarkı değişti, bu yüzden uygulanamaz. Yeni
          bir öneri iste.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-reject pb-3 text-sm">
          {error}
        </p>
      ) : null}

      {diff ? (
        <dl className="divide-y divide-line">
          <Row label="Değişen track" value={diff.trackName} />
          <Row label="Bölüm" value={diff.sectionName} />
          <Row label="Değişen ölçü" value={String(diff.changedBars)} />
          <Row label="Eklenen nota" value={String(diff.addedOnsets)} />
          <Row label="Kaldırılan nota" value={String(diff.removedOnsets)} />
          <Row label="Uyarı" value={String(diff.warningCount)} />
          <Row label="Hata" value={String(diff.errorCount)} />
        </dl>
      ) : null}

      {warnings.length > 0 ? (
        <div className="border-line mt-3 border-t pt-3">
          <p className="text-muted pb-2 text-xs tracking-wide uppercase">
            Uyarılar — engellemez
          </p>
          <ul className="space-y-2">
            {warnings.slice(0, 6).map((issue, index) => (
              <li key={index} className="text-muted text-xs leading-relaxed">
                {issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Sheet>
  );
}

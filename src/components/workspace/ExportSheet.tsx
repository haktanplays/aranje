"use client";

/**
 * Getting the song out of the app (spec 13.19, 2M-A §2, §12, §14).
 *
 * View only. Every number shown comes from the handle, every action is one of
 * its calls, and nothing here encodes, renders, serialises or mints a URL.
 * The component does not import Tone, the scheduler, the project serializer,
 * the WAV encoder or the MIDI writer — a boundary test holds that.
 *
 * The three formats are laid out as a choice a musician can actually make:
 * each says what it is *for*, not what it is technically. The one place that
 * needs a warning gets a warning rather than a footnote — MIDI genuinely does
 * not carry how a bend sounds, and a file that arrives sounding wrong with no
 * explanation is worse than one that said so first.
 */
import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import {
  EXPORT_FORMAT_TEXT,
  EXPORT_PLAYBACK_NOTE,
  EXPORT_READ_ONLY_NOTE,
  MIDI_ARTICULATION_NOTE,
  MIDI_LICENSE_NOTE,
  WAV_LICENSE_NOTE,
  WAV_SCOPE_TEXT,
} from "@/lib/export/export-messages";
import {
  attributionLine,
  LICENSE_DISPLAY,
  LICENSE_TEXT_VENDORED,
} from "@/lib/export/attribution";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type { ExportHandle, WavScope } from "@/lib/workspace/use-export";

function FormatBlock({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-line border-t py-3">
      <h3 className="text-sm">{label}</h3>
      <p className="text-muted mt-1 mb-2 text-xs leading-relaxed">{hint}</p>
      {children}
    </section>
  );
}

function ScopeChoice({
  scope,
  onChange,
  disabled,
}: {
  scope: WavScope;
  onChange: (next: WavScope) => void;
  disabled: boolean;
}) {
  return (
    <fieldset className="mb-2" disabled={disabled}>
      <legend className="text-muted pb-1 text-xs">Neyi dışa aktar</legend>
      <div className="flex flex-col gap-1.5">
        {(["all", "audible"] as const).map((option) => (
          <label
            key={option}
            data-export-scope={option}
            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
              scope === option ? "border-bronze text-bronze" : "border-line text-muted"
            }`}
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
          >
            <input
              type="radio"
              name="wav-scope"
              className="mt-1 shrink-0"
              checked={scope === option}
              onChange={() => onChange(option)}
            />
            <span className="min-w-0">
              <span className="block">{WAV_SCOPE_TEXT[option].label}</span>
              <span className="text-muted block text-xs leading-relaxed">
                {WAV_SCOPE_TEXT[option].hint}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function ExportSheet({
  open,
  onClose,
  handle,
  canPersist,
}: {
  open: boolean;
  onClose: () => void;
  handle: ExportHandle;
  canPersist: boolean;
}) {
  const { ready, error, busy, phase } = handle;

  return (
    <Sheet open={open} title="Dışa aktar" onClose={onClose} labelledBy="export-sheet-title">
      <div data-export-sheet className="pb-2">
        <p className="text-muted mb-1 text-xs leading-relaxed">
          {EXPORT_PLAYBACK_NOTE}
        </p>
        {!canPersist ? (
          <p data-export-read-only className="text-muted mb-1 text-xs">
            {EXPORT_READ_ONLY_NOTE}
          </p>
        ) : null}

        {/* One live region for the whole machine: a reader hears one sentence
            change rather than three regions competing. */}
        <p
          data-export-status
          role="status"
          aria-live="polite"
          className="text-muted min-h-5 py-1 text-xs"
        >
          {handle.statusText ?? ""}
        </p>

        {error !== null ? (
          <p data-export-error role="alert" className="text-reject py-1 text-sm">
            {error}
          </p>
        ) : null}

        {ready !== null ? (
          <div data-export-ready className="border-accept mb-2 rounded-lg border p-3">
            <p data-export-file-name className="truncate text-sm">
              {ready.fileName}
            </p>
            <p className="text-muted mt-1 text-xs">
              {ready.durationText !== null ? `${ready.durationText} · ` : ""}
              <span data-export-size>{ready.sizeText}</span>
            </p>
            <div className="mt-2 flex gap-2">
              <a
                data-export-download
                href={ready.url}
                download={ready.fileName}
                className="border-accept text-accept flex flex-1 items-center justify-center rounded-lg border px-3 text-sm"
                style={{ minHeight: MIN_TOUCH_TARGET_PX }}
              >
                İndir
              </a>
              <SheetButton data-export-new onClick={handle.reset}>
                Yeni export oluştur
              </SheetButton>
            </div>
          </div>
        ) : null}

        <FormatBlock
          label={EXPORT_FORMAT_TEXT.project.label}
          hint={EXPORT_FORMAT_TEXT.project.hint}
        >
          <SheetButton
            data-export-project
            disabled={busy}
            onClick={() => void handle.exportProjectFile()}
          >
            Proje dosyası oluştur
          </SheetButton>
        </FormatBlock>

        <FormatBlock label={EXPORT_FORMAT_TEXT.wav.label} hint={EXPORT_FORMAT_TEXT.wav.hint}>
          <ScopeChoice scope={handle.scope} onChange={handle.setScope} disabled={busy} />
          <p data-export-wav-estimate className="text-muted mb-2 text-xs">
            Tahmini: {handle.wavEstimateText}
          </p>
          <SheetButton
            data-export-wav
            disabled={busy}
            onClick={() => void handle.exportWav()}
          >
            {phase === "rendering" ? "Şarkı işleniyor…" : "WAV oluştur"}
          </SheetButton>
        </FormatBlock>

        <FormatBlock label={EXPORT_FORMAT_TEXT.midi.label} hint={EXPORT_FORMAT_TEXT.midi.hint}>
          <p data-export-midi-note className="text-muted mb-2 text-xs leading-relaxed">
            {MIDI_ARTICULATION_NOTE}
          </p>
          <p data-export-midi-estimate className="text-muted mb-2 text-xs">
            Tahmini {handle.midiEventEstimate} olay
          </p>
          <SheetButton
            data-export-midi
            disabled={busy}
            onClick={() => void handle.exportMidi()}
          >
            MIDI oluştur
          </SheetButton>
        </FormatBlock>

        <section className="border-line border-t py-3">
          <h3 className="text-sm">Ses örnekleri ve atıf</h3>
          <p className="text-muted mt-1 text-xs leading-relaxed">{WAV_LICENSE_NOTE}</p>
          <p data-export-midi-license className="text-muted mt-1 text-xs leading-relaxed">
            {MIDI_LICENSE_NOTE}
          </p>
          <p
            data-export-attribution-line
            className="border-line text-muted my-2 rounded-lg border p-2 text-xs leading-relaxed"
          >
            {attributionLine()}
          </p>
          <p className="text-muted mb-2 text-xs break-all">
            {LICENSE_DISPLAY.name} ({LICENSE_DISPLAY.spdx}) —{" "}
            <a
              href={LICENSE_DISPLAY.url}
              target="_blank"
              rel="noreferrer"
              className="text-bronze underline"
            >
              {LICENSE_DISPLAY.url}
            </a>
          </p>
          {!LICENSE_TEXT_VENDORED ? (
            /* Said plainly rather than hidden: the app links the licence
               because it does not carry a copy of the text, and claiming
               otherwise would be the one thing a licence notice may not do. */
            <p data-export-license-open className="text-muted mb-2 text-xs leading-relaxed">
              Lisansın tam metni uygulamayla birlikte gelmiyor; yukarıdaki
              bağlantıdan okunabilir.
            </p>
          ) : null}
          <div className="flex gap-2">
            <SheetButton
              data-export-attribution-copy
              onClick={() => void navigator.clipboard?.writeText(attributionLine())}
            >
              Atıf metnini kopyala
            </SheetButton>
            <SheetButton data-export-attribution-file onClick={handle.downloadAttribution}>
              Atıf dosyasını indir
            </SheetButton>
          </div>
        </section>
      </div>
    </Sheet>
  );
}

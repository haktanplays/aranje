"use client";

import { getInstrument, getPreset } from "@/lib/instruments/registry";
import type { Track } from "@/lib/song/schema";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-muted text-sm">{label}</dt>
      <dd className="text-right text-sm">{value}</dd>
    </div>
  );
}

/** Instrument and preset detail, kept off the main surface (spec 13.4). */
export function TrackSheet({
  track,
  open,
  onClose,
}: {
  track: Track;
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;

  const instrument = getInstrument(track.instrumentId);
  const preset = getPreset(track.instrumentId, track.presetId);

  return (
    <div className="fixed inset-0 z-30 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Kapat"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <section className="bg-panel relative rounded-t-2xl border-t border-line px-4 pt-3 pb-6">
        <div className="bg-line mx-auto mb-3 h-1 w-10 rounded-full" />
        <h2 className="font-display mb-2 text-lg">{track.name}</h2>
        <dl className="divide-y divide-line">
          <Row
            label="Enstrüman"
            value={instrument?.displayName ?? track.instrumentId}
          />
          <Row
            label="Varyasyon"
            value={`${preset?.displayName ?? track.presetId}${
              preset?.scope === "core" ? "" : " (Faz 2.5)"
            }`}
          />
          {track.fretboard ? (
            <>
              <Row label="Akort" value={track.fretboard.tuning.join(" ")} />
              <Row label="Capo" value={String(track.fretboard.capo)} />
            </>
          ) : null}
          <Row label="Ses" value={`${track.volumeDb} dB`} />
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

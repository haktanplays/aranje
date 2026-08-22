"use client";

/**
 * Managing the tracks of the song (spec 13.17, 2L-B §7, §8).
 *
 * The same shape as the section manager: a list, one selected row, an action
 * strip, and typed commands to the lifecycle controller. The setup form is
 * shared between "new track" and "change setup", and every option in it is
 * the registry's answer — core instruments, their core presets, the tuning
 * presets with the right string count — never a list of ids written here.
 *
 * The dangerous path is deliberately two roads (spec §8): a setup change on
 * a track that carries music first tries the safe update, and when the
 * combination is refused the sheet *offers* — never assumes — the separate,
 * explicitly destructive "Track içeriğini temizleyip değiştir", behind its
 * own confirmation sentence.
 */
import { useState } from "react";

import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import {
  coreInstruments,
  corePresets,
  instrumentLabel,
  presetLabel,
} from "@/lib/instruments/registry";
import { MAX_CAPO, TUNING_PRESETS } from "@/lib/music/fretboard";
import { dedupeName } from "@/lib/song/lifecycle-ids";
import {
  destructiveSetupConfirmation,
  trackDeleteConfirmation,
} from "@/lib/song/lifecycle-messages";
import {
  isFrettedInstrument,
  tuningOptionsFor,
  type TrackSetup,
} from "@/lib/song/track-lifecycle";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type { Song, Track } from "@/lib/song/schema";
import type {
  LifecycleHandle,
  LifecycleOutcome,
} from "@/lib/workspace/use-lifecycle";

const FIELD =
  "border-line bg-raised min-h-11 w-full rounded-lg border px-3 text-sm";

type Mode =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "rename" }
  | { kind: "setup" }
  | { kind: "confirmDelete" }
  | { kind: "confirmDestructive" };

type SetupDraft = {
  name: string;
  instrumentId: string;
  tuningPresetId: string;
  presetId: string;
  capo: string;
};

/** What the form should say for a track as it stands. */
function draftFor(track: Track): SetupDraft {
  const tuning = track.fretboard?.tuning.join(" ");
  const match = Object.values(TUNING_PRESETS).find(
    (preset) => preset.tuning.join(" ") === tuning,
  );
  return {
    name: track.name,
    instrumentId: track.instrumentId,
    presetId: track.presetId,
    tuningPresetId:
      match?.id ?? tuningOptionsFor(track.instrumentId)[0]?.id ?? "",
    capo: String(track.fretboard?.capo ?? 0),
  };
}

/** The typed setup a draft stands for. */
function setupFrom(draft: SetupDraft): TrackSetup {
  if (!isFrettedInstrument(draft.instrumentId)) {
    return {
      name: draft.name,
      instrumentId: draft.instrumentId,
      presetId: draft.presetId,
    };
  }
  const tuning =
    tuningOptionsFor(draft.instrumentId).find(
      (preset) => preset.id === draft.tuningPresetId,
    ) ?? tuningOptionsFor(draft.instrumentId)[0];
  return {
    name: draft.name,
    instrumentId: draft.instrumentId,
    presetId: draft.presetId,
    fretboard: {
      tuning: tuning ? [...tuning.tuning] : [],
      capo: Number(draft.capo),
    },
  };
}

export function TrackManagerSheet({
  open,
  onClose,
  song,
  selectedTrackId,
  lifecycle,
}: {
  open: boolean;
  onClose: () => void;
  song: Song;
  selectedTrackId: string | null;
  lifecycle: LifecycleHandle;
}) {
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [rowId, setRowId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SetupDraft | null>(null);
  const [name, setName] = useState("");

  if (!open) return null;

  const selected =
    song.tracks.find((entry) => entry.id === rowId) ??
    song.tracks.find((entry) => entry.id === selectedTrackId) ??
    song.tracks[0];
  if (!selected) return null;

  const handle = (outcome: LifecycleOutcome) => {
    if (outcome.status === "rejected" || outcome.status === "blocked") {
      setError(outcome.message);
      return false;
    }
    setError(null);
    setMode({ kind: "list" });
    return true;
  };

  const setDraftField = (patch: Partial<SetupDraft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  const openCreate = () => {
    const first = coreInstruments()[0];
    if (!first) return;
    setDraft({
      name: dedupeName(
        song.tracks.map((entry) => entry.name),
        instrumentLabel(first.id),
      ),
      instrumentId: first.id,
      presetId: corePresets(first.id)[0]?.id ?? "",
      tuningPresetId: tuningOptionsFor(first.id)[0]?.id ?? "",
      capo: "0",
    });
    setError(null);
    setMode({ kind: "create" });
  };

  const changeInstrument = (instrumentId: string) =>
    setDraft((current) =>
      current
        ? {
            ...current,
            instrumentId,
            presetId: corePresets(instrumentId)[0]?.id ?? "",
            tuningPresetId: tuningOptionsFor(instrumentId)[0]?.id ?? "",
            capo: "0",
          }
        : current,
    );

  const submitSetup = () => {
    if (!draft) return;
    const setup = setupFrom(draft);
    handle(
      mode.kind === "create"
        ? lifecycle.runTrack({ kind: "create_track", setup })
        : lifecycle.runTrack({
            kind: "update_track_setup",
            trackId: selected.id,
            setup,
          }),
    );
  };

  const back = () => {
    setError(null);
    setMode({ kind: "list" });
  };

  const setupForm = draft ? (
    <div className="flex flex-col gap-3">
      <label className="block">
        <span className="text-muted mb-1 block text-xs">Track adı</span>
        <input
          type="text"
          data-track-name
          value={draft.name}
          onChange={(event) => setDraftField({ name: event.target.value })}
          className={FIELD}
        />
      </label>
      <label className="block">
        <span className="text-muted mb-1 block text-xs">Enstrüman</span>
        <select
          data-track-instrument
          value={draft.instrumentId}
          onChange={(event) => changeInstrument(event.target.value)}
          className={FIELD}
        >
          {coreInstruments().map((instrument) => (
            <option key={instrument.id} value={instrument.id}>
              {instrumentLabel(instrument.id)}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="text-muted mb-1 block text-xs">Varyasyon</span>
        <select
          data-track-preset
          value={draft.presetId}
          onChange={(event) => setDraftField({ presetId: event.target.value })}
          className={FIELD}
        >
          {corePresets(draft.instrumentId).map((preset) => (
            <option key={preset.id} value={preset.id}>
              {presetLabel(draft.instrumentId, preset.id)}
            </option>
          ))}
        </select>
      </label>
      {isFrettedInstrument(draft.instrumentId) ? (
        <div className="flex gap-2">
          <label className="block flex-1">
            <span className="text-muted mb-1 block text-xs">Akort</span>
            <select
              data-track-tuning
              value={draft.tuningPresetId}
              onChange={(event) =>
                setDraftField({ tuningPresetId: event.target.value })
              }
              className={FIELD}
            >
              {tuningOptionsFor(draft.instrumentId).map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="block flex-1">
            <span className="text-muted mb-1 block text-xs">
              Capo (0–{MAX_CAPO})
            </span>
            <input
              type="number"
              data-track-capo
              inputMode="numeric"
              min={0}
              max={MAX_CAPO}
              value={draft.capo}
              onChange={(event) => setDraftField({ capo: event.target.value })}
              className={FIELD}
            />
          </label>
        </div>
      ) : null}
    </div>
  ) : null;

  const body =
    mode.kind === "create" || mode.kind === "setup" ? (
      setupForm
    ) : mode.kind === "rename" ? (
      <label className="block">
        <span className="text-muted mb-1 block text-xs">Track adı</span>
        <input
          type="text"
          data-track-name
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={FIELD}
        />
      </label>
    ) : mode.kind === "confirmDelete" ? (
      <p className="text-sm">{trackDeleteConfirmation(selected)}</p>
    ) : mode.kind === "confirmDestructive" ? (
      <p className="text-sm">{destructiveSetupConfirmation(selected)}</p>
    ) : (
      <>
        <div role="listbox" aria-label="Track seç" className="flex flex-col gap-1">
          {song.tracks.map((entry) => {
            const isSelected = entry.id === selected.id;
            return (
              <button
                key={entry.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-track-row={entry.id}
                onClick={() => setRowId(entry.id)}
                className={`flex items-baseline justify-between gap-3 rounded-lg border px-3 text-left ${
                  isSelected
                    ? "border-bronze/60 bg-raised text-bronze"
                    : "border-line text-muted"
                }`}
                style={{ minHeight: MIN_TOUCH_TARGET_PX }}
              >
                <span className="truncate text-sm">{entry.name}</span>
                <span className="shrink-0 text-[11px] opacity-70">
                  {instrumentLabel(entry.instrumentId)}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <SheetButton
            data-track-action="rename"
            onClick={() => {
              setName(selected.name);
              setError(null);
              setMode({ kind: "rename" });
            }}
          >
            Yeniden adlandır
          </SheetButton>
          <SheetButton
            data-track-action="setup"
            onClick={() => {
              setDraft(draftFor(selected));
              setError(null);
              setMode({ kind: "setup" });
            }}
          >
            Ayarları değiştir
          </SheetButton>
          <SheetButton
            data-track-action="duplicate"
            onClick={() =>
              handle(
                lifecycle.runTrack({
                  kind: "duplicate_track",
                  trackId: selected.id,
                }),
              )
            }
          >
            Çoğalt
          </SheetButton>
          <SheetButton
            data-track-action="up"
            onClick={() =>
              handle(
                lifecycle.runTrack({
                  kind: "move_track",
                  trackId: selected.id,
                  direction: "up",
                }),
              )
            }
          >
            Yukarı taşı
          </SheetButton>
          <SheetButton
            data-track-action="down"
            onClick={() =>
              handle(
                lifecycle.runTrack({
                  kind: "move_track",
                  trackId: selected.id,
                  direction: "down",
                }),
              )
            }
          >
            Aşağı taşı
          </SheetButton>
          <SheetButton
            data-track-action="delete"
            tone="danger"
            onClick={() => {
              setError(null);
              setMode({ kind: "confirmDelete" });
            }}
          >
            Sil
          </SheetButton>
        </div>
      </>
    );

  const footer =
    mode.kind === "create" || mode.kind === "setup" ? (
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <SheetButton onClick={back}>Vazgeç</SheetButton>
          <SheetButton
            data-track-apply
            tone="primary"
            onClick={submitSetup}
            disabled={!lifecycle.canApply}
          >
            Uygula
          </SheetButton>
        </div>
        {/* The separate destructive road, offered only where the safe one
            exists to be refused (spec §8) — never merged into one button. */}
        {mode.kind === "setup" ? (
          <SheetButton
            data-track-destructive
            tone="danger"
            onClick={() => {
              setError(null);
              setMode({ kind: "confirmDestructive" });
            }}
            disabled={!lifecycle.canApply}
          >
            Track içeriğini temizleyip değiştir
          </SheetButton>
        ) : null}
      </div>
    ) : mode.kind === "rename" ? (
      <div className="flex gap-2">
        <SheetButton onClick={back}>Vazgeç</SheetButton>
        <SheetButton
          data-track-apply
          tone="primary"
          onClick={() =>
            handle(
              lifecycle.runTrack({
                kind: "rename_track",
                trackId: selected.id,
                name,
              }),
            )
          }
          disabled={!lifecycle.canApply}
        >
          Uygula
        </SheetButton>
      </div>
    ) : mode.kind === "confirmDelete" ? (
      <div className="flex gap-2">
        <SheetButton onClick={back}>Vazgeç</SheetButton>
        <SheetButton
          data-track-confirm-delete
          tone="danger"
          onClick={() =>
            handle(
              lifecycle.runTrack({
                kind: "delete_track",
                trackId: selected.id,
              }),
            )
          }
          disabled={!lifecycle.canApply}
        >
          Sil
        </SheetButton>
      </div>
    ) : mode.kind === "confirmDestructive" ? (
      <div className="flex gap-2">
        <SheetButton
          onClick={() => {
            setError(null);
            setMode({ kind: "setup" });
          }}
        >
          Vazgeç
        </SheetButton>
        <SheetButton
          data-track-confirm-destructive
          tone="danger"
          onClick={() => {
            if (!draft) return;
            handle(
              lifecycle.runTrack({
                kind: "replace_track_setup_and_clear_content",
                trackId: selected.id,
                setup: setupFrom(draft),
              }),
            );
          }}
          disabled={!lifecycle.canApply}
        >
          Temizle ve değiştir
        </SheetButton>
      </div>
    ) : (
      <div className="flex gap-2">
        <SheetButton onClick={onClose}>Kapat</SheetButton>
        <SheetButton
          data-track-add
          tone="primary"
          onClick={openCreate}
          disabled={!lifecycle.canApply}
        >
          Yeni track
        </SheetButton>
      </div>
    );

  return (
    <Sheet
      open={open}
      title="Track'leri düzenle"
      onClose={onClose}
      labelledBy="track-manage-sheet-title"
      footer={
        <>
          {error ? (
            <p
              role="alert"
              data-lifecycle-error
              className="text-reject pb-2 text-xs"
            >
              {error}
            </p>
          ) : null}
          {footer}
        </>
      }
    >
      {body}
    </Sheet>
  );
}

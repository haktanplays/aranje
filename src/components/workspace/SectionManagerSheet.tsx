"use client";

/**
 * Managing the sections of the song (spec 13.17, 2L-B §6).
 *
 * A list, one selected row, and an action strip — every action is a typed
 * command handed to the lifecycle controller, which is the only road to a
 * commit. The sheet's own state is entirely draft: which row is selected,
 * which form is open, what is typed in it. Nothing here reads storage,
 * touches history or runs a validator.
 *
 * The create form offers only what the music can actually be written in:
 * the core meters, and for each meter only the grids `timing.ts` can state
 * exactly — labelled the way the product already labels them ("1/16",
 * "1/8 üçleme"), never as a bare "resolution".
 */
import { useState } from "react";

import { Sheet, SheetButton } from "@/components/workspace/Sheet";
import { bpmRange, songLimits } from "@/lib/limits";
import {
  CORE_TIME_SIGNATURES,
  RESOLUTIONS,
  formatTimeSignature,
  isRepresentableGrid,
  resolutionLabel,
} from "@/lib/music/timing";
import { dedupeName } from "@/lib/song/lifecycle-ids";
import { sectionDeleteConfirmation } from "@/lib/song/lifecycle-messages";
import { MIN_TOUCH_TARGET_PX } from "@/lib/ui/interaction";
import type { Resolution, Song, TimeSignature } from "@/lib/song/schema";
import type {
  LifecycleHandle,
  LifecycleOutcome,
} from "@/lib/workspace/use-lifecycle";
import type { SectionPosition } from "@/lib/song/section-lifecycle";

const FIELD =
  "border-line bg-raised min-h-11 w-full rounded-lg border px-3 text-sm";

type Mode =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "rename" }
  | { kind: "tempo" }
  | { kind: "confirmDelete" };

export function SectionManagerSheet({
  open,
  onClose,
  song,
  activeSectionId,
  lifecycle,
}: {
  open: boolean;
  onClose: () => void;
  song: Song;
  activeSectionId: string | null;
  lifecycle: LifecycleHandle;
}) {
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Create-form drafts.
  const [name, setName] = useState("");
  const [placement, setPlacement] = useState<"before" | "after" | "end">("end");
  const [barCount, setBarCount] = useState("4");
  const [meterIndex, setMeterIndex] = useState(0);
  const [gridText, setGridText] = useState("16");
  const [tempoText, setTempoText] = useState("");

  if (!open) return null;

  const selected =
    song.sections.find((entry) => entry.id === selectedId) ??
    song.sections.find((entry) => entry.id === activeSectionId) ??
    song.sections[0];
  if (!selected) return null;

  const meterOption = CORE_TIME_SIGNATURES[meterIndex] ?? CORE_TIME_SIGNATURES[0]!;
  const meter = [meterOption[0], meterOption[1]] as TimeSignature;
  const grids = RESOLUTIONS.filter((entry) =>
    isRepresentableGrid(meter, entry),
  );
  const grid = (grids.find((entry) => String(entry) === gridText) ??
    grids[0]) as Resolution;

  const handle = (outcome: LifecycleOutcome) => {
    if (outcome.status === "rejected" || outcome.status === "blocked") {
      setError(outcome.message);
      return false;
    }
    setError(null);
    setMode({ kind: "list" });
    return true;
  };

  const openCreate = () => {
    setName(
      dedupeName(
        song.sections.map((entry) => entry.name),
        `Bölüm ${song.sections.length + 1}`,
      ),
    );
    setPlacement("end");
    setBarCount("4");
    setMeterIndex(0);
    setGridText("16");
    setTempoText("");
    setError(null);
    setMode({ kind: "create" });
  };

  const submitCreate = () => {
    const position: SectionPosition =
      placement === "end"
        ? { kind: "end" }
        : { kind: placement, sectionId: selected.id };
    const tempo = tempoText.trim();
    handle(
      lifecycle.runSection({
        kind: "create_section",
        name,
        position,
        barCount: Number(barCount),
        timeSignature: meter,
        resolution: grid,
        ...(tempo ? { bpmOverride: Number(tempo) } : {}),
      }),
    );
  };

  const back = () => {
    setError(null);
    setMode({ kind: "list" });
  };

  const body =
    mode.kind === "create" ? (
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className="text-muted mb-1 block text-xs">Bölüm adı</span>
          <input
            type="text"
            data-section-name
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={FIELD}
          />
        </label>
        <label className="block">
          <span className="text-muted mb-1 block text-xs">Konum</span>
          <select
            data-section-position
            value={placement}
            onChange={(event) =>
              setPlacement(event.target.value as typeof placement)
            }
            className={FIELD}
          >
            <option value="end">Sona ekle</option>
            <option value="before">{`"${selected.name}" bölümünden önce`}</option>
            <option value="after">{`"${selected.name}" bölümünden sonra`}</option>
          </select>
        </label>
        <div className="flex gap-2">
          <label className="block flex-1">
            <span className="text-muted mb-1 block text-xs">
              Ölçü sayısı (1–{songLimits.barsPerSection})
            </span>
            <input
              type="number"
              data-section-bars
              inputMode="numeric"
              min={1}
              max={songLimits.barsPerSection}
              value={barCount}
              onChange={(event) => setBarCount(event.target.value)}
              className={FIELD}
            />
          </label>
          <label className="block flex-1">
            <span className="text-muted mb-1 block text-xs">Ölçü işareti</span>
            <select
              data-section-meter
              value={meterIndex}
              onChange={(event) => {
                setMeterIndex(Number(event.target.value));
              }}
              className={FIELD}
            >
              {CORE_TIME_SIGNATURES.map((entry, index) => (
                <option key={formatTimeSignature(entry)} value={index}>
                  {formatTimeSignature(entry)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex gap-2">
          <label className="block flex-1">
            <span className="text-muted mb-1 block text-xs">Ritim aralığı</span>
            <select
              data-section-grid
              value={String(grid)}
              onChange={(event) => setGridText(event.target.value)}
              className={FIELD}
            >
              {grids.map((entry) => (
                <option key={entry} value={String(entry)}>
                  {resolutionLabel(entry)}
                </option>
              ))}
            </select>
          </label>
          <label className="block flex-1">
            <span className="text-muted mb-1 block text-xs">
              Bölüm temposu (isteğe bağlı)
            </span>
            <input
              type="number"
              data-section-tempo
              inputMode="numeric"
              min={bpmRange.min}
              max={bpmRange.max}
              placeholder="Şarkı temposu"
              value={tempoText}
              onChange={(event) => setTempoText(event.target.value)}
              className={FIELD}
            />
          </label>
        </div>
      </div>
    ) : mode.kind === "rename" ? (
      <label className="block">
        <span className="text-muted mb-1 block text-xs">Bölüm adı</span>
        <input
          type="text"
          data-section-name
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={FIELD}
        />
      </label>
    ) : mode.kind === "tempo" ? (
      <div className="flex flex-col gap-2">
        <label className="block">
          <span className="text-muted mb-1 block text-xs">
            {`"${selected.name}" temposu (BPM, ${bpmRange.min}–${bpmRange.max})`}
          </span>
          <input
            type="number"
            data-section-tempo
            inputMode="numeric"
            min={bpmRange.min}
            max={bpmRange.max}
            placeholder="Şarkı temposu"
            value={tempoText}
            onChange={(event) => setTempoText(event.target.value)}
            className={FIELD}
          />
        </label>
        {selected.bpmOverride !== undefined ? (
          <button
            type="button"
            data-section-clear-tempo
            onClick={() =>
              handle(
                lifecycle.runSection({
                  kind: "clear_section_tempo_override",
                  sectionId: selected.id,
                }),
              )
            }
            className="border-line rounded-lg border text-sm"
            style={{ minHeight: MIN_TOUCH_TARGET_PX }}
          >
            Bölüm temposunu kaldır
          </button>
        ) : null}
      </div>
    ) : mode.kind === "confirmDelete" ? (
      <p className="text-sm">{sectionDeleteConfirmation(selected)}</p>
    ) : (
      <>
        <div
          role="listbox"
          aria-label="Bölüm seç"
          className="flex flex-col gap-1"
        >
          {song.sections.map((entry) => {
            const isSelected = entry.id === selected.id;
            return (
              <button
                key={entry.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-section-row={entry.id}
                onClick={() => setSelectedId(entry.id)}
                className={`flex items-baseline justify-between gap-3 rounded-lg border px-3 text-left ${
                  isSelected
                    ? "border-bronze/60 bg-raised text-bronze"
                    : "border-line text-muted"
                }`}
                style={{ minHeight: MIN_TOUCH_TARGET_PX }}
              >
                <span className="truncate text-sm">{entry.name}</span>
                <span className="shrink-0 text-[11px] tabular-nums opacity-70">
                  {entry.bars.length} ölçü
                  {entry.bpmOverride !== undefined
                    ? ` · ${entry.bpmOverride} BPM`
                    : ""}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <SheetButton
            data-section-action="rename"
            onClick={() => {
              setName(selected.name);
              setError(null);
              setMode({ kind: "rename" });
            }}
          >
            Yeniden adlandır
          </SheetButton>
          <SheetButton
            data-section-action="duplicate"
            onClick={() =>
              handle(
                lifecycle.runSection({
                  kind: "duplicate_section",
                  sectionId: selected.id,
                }),
              )
            }
          >
            Çoğalt
          </SheetButton>
          <SheetButton
            data-section-action="tempo"
            onClick={() => {
              setTempoText(
                selected.bpmOverride !== undefined
                  ? String(selected.bpmOverride)
                  : "",
              );
              setError(null);
              setMode({ kind: "tempo" });
            }}
          >
            Tempo
          </SheetButton>
          <SheetButton
            data-section-action="up"
            onClick={() =>
              handle(
                lifecycle.runSection({
                  kind: "move_section",
                  sectionId: selected.id,
                  direction: "up",
                }),
              )
            }
          >
            Yukarı taşı
          </SheetButton>
          <SheetButton
            data-section-action="down"
            onClick={() =>
              handle(
                lifecycle.runSection({
                  kind: "move_section",
                  sectionId: selected.id,
                  direction: "down",
                }),
              )
            }
          >
            Aşağı taşı
          </SheetButton>
          <SheetButton
            data-section-action="delete"
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
    mode.kind === "create" ? (
      <div className="flex gap-2">
        <SheetButton onClick={back}>Vazgeç</SheetButton>
        <SheetButton
          data-section-apply
          tone="primary"
          onClick={submitCreate}
          disabled={!lifecycle.canApply}
        >
          Uygula
        </SheetButton>
      </div>
    ) : mode.kind === "rename" ? (
      <div className="flex gap-2">
        <SheetButton onClick={back}>Vazgeç</SheetButton>
        <SheetButton
          data-section-apply
          tone="primary"
          onClick={() =>
            handle(
              lifecycle.runSection({
                kind: "rename_section",
                sectionId: selected.id,
                name,
              }),
            )
          }
          disabled={!lifecycle.canApply}
        >
          Uygula
        </SheetButton>
      </div>
    ) : mode.kind === "tempo" ? (
      <div className="flex gap-2">
        <SheetButton onClick={back}>Vazgeç</SheetButton>
        <SheetButton
          data-section-apply
          tone="primary"
          onClick={() =>
            handle(
              lifecycle.runSection({
                kind: "set_section_tempo_override",
                sectionId: selected.id,
                bpm: Number(tempoText),
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
          data-section-confirm-delete
          tone="danger"
          onClick={() =>
            handle(
              lifecycle.runSection({
                kind: "delete_section",
                sectionId: selected.id,
              }),
            )
          }
          disabled={!lifecycle.canApply}
        >
          Sil
        </SheetButton>
      </div>
    ) : (
      <div className="flex gap-2">
        <SheetButton onClick={onClose}>Kapat</SheetButton>
        <SheetButton
          data-section-add
          tone="primary"
          onClick={openCreate}
          disabled={!lifecycle.canApply}
        >
          Yeni bölüm
        </SheetButton>
      </div>
    );

  return (
    <Sheet
      open={open}
      title="Bölümleri düzenle"
      onClose={onClose}
      labelledBy="section-manage-sheet-title"
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
